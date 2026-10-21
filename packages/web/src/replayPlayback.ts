import { createMatch, runReplay, type PlayerOrder, type ReplayCheck, type ReplayOptions } from "@castellan/engine";
import { createScriptHost } from "@castellan/sandbox";
import type { ReplayFile, SpectatorView } from "@castellan/shared";

/** Viewer-only recovery: reproduce recorded VM shutdowns without treating an
 * interrupted match as a clean balance experiment. The original replay and the
 * engine's strict runReplay entry point remain unchanged.
 */
export async function playRecordedReplay(replay: ReplayFile, onFrame: (view: SpectatorView) => void, options: ReplayOptions = {}): Promise<ReplayCheck> {
  const failures = replay.experiment?.operationalFailures ?? [];
  if (!failures.length) return runReplay(replay, onFrame, options);

  // /run uses a disposable VM. Its watchdog returns no orders and does not
  // terminate the player's persistent unit-script VM (runOnceIsolated).
  // Preserve the failure in the recording, but it requires no simulation action.
  const requestTimeout = (message: string) => /^sandbox watchdog timeout after \d+ms; request terminated$/.test(message);
  const shutdowns = failures.filter(failure => !requestTimeout(failure.message));
  const byPlayer = new Map(shutdowns.map(failure => [failure.player, failure]));
  if (failures.some(failure =>
    !Number.isInteger(failure.tick) || failure.tick < 0 || failure.tick > replay.finalTick
    || !replay.players.some(player => player.id === failure.player)
  ) || byPlayer.size !== shutdowns.length || shutdowns.some(failure =>
    !/^sandbox (watchdog|dispatch) timeout after \d+ms; player VM terminated$/.test(failure.message)
    || failure.tick >= replay.finalTick
    // A simultaneous upload could have timed out during compilation instead of
    // unit execution. Old recordings do not distinguish those two cases.
    || replay.orders.some(order => order.player === failure.player && order.tick === failure.tick && order.order.type === "script")
  )) throw new Error("This replay contains a sandbox interruption that cannot be reconstructed safely.");

  let nextPlayer = 0;
  const match = await createMatch({
    ruleset: replay.ruleset, seed: replay.seed, tickRate: replay.tickRate, players: replay.players,
    scriptHostFactory: (limits, seed) => {
      const failure = byPlayer.get(replay.players[nextPlayer++].id);
      const host = createScriptHost(limits, seed);
      let terminated = false;
      return {
        setScript: (kind, code) => terminated ? { ok: false, error: failure!.message } : host.setScript(kind, code),
        hasScript: kind => host.hasScript(kind),
        run(world, ids) {
          if (failure && world.tick >= failure.tick) terminated = true;
          if (!terminated) return host.run(world, ids);
          return Object.fromEntries(ids.map(id => [id, {
            action: { a: "hold" as const }, error: failure!.message, gasUsed: 0, operationalFailure: true as const,
          }]));
        },
        dispose: () => host.dispose(),
      };
    },
  });
  const byTick = new Map<number, PlayerOrder[]>();
  for (const order of replay.orders) {
    const orders = byTick.get(order.tick) ?? [];
    orders.push({ player: order.player, order: order.order });
    byTick.set(order.tick, orders);
  }
  let desyncAt: number | undefined;
  try {
    onFrame(match.spectate(-1, { ...options, includePrivateChat: true }));
    while (match.tick < replay.finalTick && !match.outcome) {
      const tick = match.tick;
      match.step(byTick.get(tick) ?? []);
      if (replay.hashes[tick] !== undefined && desyncAt === undefined && replay.hashes[tick] !== match.hash()) desyncAt = tick;
      onFrame(match.spectate(undefined, { ...options, includePrivateChat: true }));
    }
    if (desyncAt === undefined && (match.tick !== replay.finalTick
      || (replay.hashes[match.tick] !== undefined && replay.hashes[match.tick] !== match.hash()))) desyncAt = match.tick;
    return { verified: desyncAt === undefined, desyncAt };
  } finally {
    match.dispose();
  }
}
