import type { GameEvent, Order, OrderResult, PlayerId, ReplayFile, SpectatorView } from "@castellan/shared";
import { createScriptHost, type ScriptHostFactory } from "@castellan/sandbox";
import { createMatch } from "./index";
import type { Match, MatchConfig, PlayerOrder } from "./match";

export interface ReplayCheck {
  /** Every recorded state hash matched, and the match stopped where the recording did. */
  verified: boolean;
  /** First tick whose state differed, if any. */
  desyncAt?: number;
}

export interface ReplayOptions {
  /** Decorative previews need only the board. Full observers keep every perspective by default. */
  includePerspectives?: boolean;
}

/** Recorded orders to apply again from a match's start: a replay, a room checkpoint or a battle's prefix. */
export interface Recording {
  config: MatchConfig;
  /** Orders in the tick they were applied, in application order. */
  orders: readonly { tick: number; player: PlayerId; order: Order }[];
  /** State hashes after the tick they are keyed by; each one recorded is checked. */
  hashes?: Readonly<Record<number, string>>;
  /** Where the recording ends: the re-simulation stops there, or earlier at an outcome. */
  until: number;
}

/** One re-simulated tick: the orders applied, their results and its events. */
export interface ResimulatedTick { tick: number; input: PlayerOrder[]; results: OrderResult[]; events: GameEvent[] }

export interface ResimulationHooks {
  /** Once, before the first tick. */
  start?(match: Match): void;
  /** Before each tick's orders apply. */
  before?(match: Match): void;
  /** After each tick. */
  after?(match: Match, tick: ResimulatedTick): void;
}

/**
 * Applies a recording's orders again, tick by tick, to a fresh match. The returned match is the caller's
 * to dispose; if a hook throws, it is disposed before the error propagates.
 */
export async function resimulate(recording: Recording, hooks: ResimulationHooks = {}): Promise<{ match: Match; check: ReplayCheck }> {
  const match = await createMatch(recording.config);
  try {
    const byTick = new Map<number, PlayerOrder[]>();
    for (const { tick, player, order } of recording.orders) {
      const list = byTick.get(tick) ?? [];
      list.push({ player, order });
      byTick.set(tick, list);
    }
    let desyncAt: number | undefined;
    const check = (tick: number) => {
      const expected = recording.hashes?.[tick];
      if (expected !== undefined && desyncAt === undefined && expected !== match.hash()) desyncAt = tick;
    };
    hooks.start?.(match);
    while (match.tick < recording.until && !match.outcome) {
      hooks.before?.(match);
      const tick = match.tick, input = byTick.get(tick) ?? [];
      const { results, events } = match.step(input);
      check(tick);
      hooks.after?.(match, { tick, input, results, events });
    }
    check(match.tick);
    if (desyncAt === undefined && match.tick !== recording.until) desyncAt = match.tick;
    return { match, check: { verified: desyncAt === undefined, desyncAt } };
  } catch (error) {
    match.dispose();
    throw error;
  }
}

/** A replay as a recording; `config` can replace parts of the match setup, such as its script host. */
export function recordingOf(replay: ReplayFile, config: Partial<MatchConfig> = {}): Recording {
  return { config: { ruleset: replay.ruleset, seed: replay.seed, tickRate: replay.tickRate, players: replay.players, ...config },
    orders: replay.orders, hashes: replay.hashes, until: replay.finalTick };
}

/**
 * A replay as a recording that also reproduces its recorded VM shutdowns, for viewers and series history:
 * never a balance sample, since a shutdown came from the wall clock. A /run request that timed out stopped
 * only its own disposable VM and changes nothing. Throws when a failure is not recorded precisely enough.
 */
export function recordingWithShutdowns(replay: ReplayFile): Recording {
  return recordingOf(replay, { scriptHostFactory: recordedShutdowns(replay) });
}

/** A recording with a sandbox operational failure depended on the wall clock, so it cannot be reproduced exactly. */
function assertReproducible(replay: Pick<ReplayFile, "experiment">): void {
  if (replay.experiment?.operationalFailures?.length) throw new Error("Replay has a sandbox operational failure; wall-clock termination cannot be reconstructed deterministically. Exclude it from balance evaluation.");
}

/**
 * Plays a recording for an observer: `onFrame` gets the full state at the start and after every tick,
 * `onTick` what each tick applied. Checks the recorded hashes.
 */
export async function playRecording(recording: Recording, onFrame: (view: SpectatorView) => void, options: ReplayOptions = {},
  onTick?: (tick: ResimulatedTick) => void): Promise<ReplayCheck> {
  const frame = (match: Match, since?: number) => onFrame(match.spectate(since, { ...options, includePrivateChat: true }));
  const { match, check } = await resimulate(recording, { start: (m) => frame(m, -1), after: (m, tick) => { onTick?.(tick); frame(m); } });
  match.dispose();
  return check;
}

/**
 * Re-simulates a replay from its orders, calling `onFrame` with the full state
 * after every tick (frame 0 is the initial state). Checks the recorded hashes.
 */
export async function runReplay(replay: ReplayFile, onFrame: (view: SpectatorView) => void, options: ReplayOptions = {}): Promise<ReplayCheck> {
  assertReproducible(replay);
  return playRecording(recordingOf(replay), onFrame, options);
}

/** Script hosts that stop each player's VM where the recording says it stopped; the default host without such failures. */
function recordedShutdowns(replay: ReplayFile): ScriptHostFactory | undefined {
  const failures = replay.experiment?.operationalFailures ?? [];
  if (!failures.length) return undefined;

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
  return (limits, seed) => {
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
  };
}
