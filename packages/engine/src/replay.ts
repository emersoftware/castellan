import type { ReplayFile, SpectatorView } from "@aoa/shared";
import { createMatch } from "./index";
import type { PlayerOrder } from "./match";

export interface ReplayCheck {
  /** Every recorded state hash matched. */
  verified: boolean;
  /** First tick whose hash differed, if any. */
  desyncAt?: number;
}

/**
 * Re-simulates a replay from its orders, calling `onFrame` with the full state
 * after every tick (frame 0 is the initial state). Checks the recorded hashes.
 */
export async function runReplay(replay: ReplayFile, onFrame: (view: SpectatorView) => void): Promise<ReplayCheck> {
  const m = await createMatch({ ruleset: replay.ruleset, seed: replay.seed, tickRate: replay.tickRate, players: replay.players });
  const byTick = new Map<number, PlayerOrder[]>();
  for (const o of replay.orders) {
    const list = byTick.get(o.tick) ?? [];
    list.push({ player: o.player, order: o.order });
    byTick.set(o.tick, list);
  }
  let desyncAt: number | undefined;
  try {
    onFrame(m.spectate(-1, { includePrivateChat: true }));
    while (m.tick < replay.finalTick && !m.outcome) {
      const t = m.tick;
      m.step(byTick.get(t) ?? []);
      const expected = replay.hashes[t];
      if (expected !== undefined && desyncAt === undefined && expected !== m.hash()) desyncAt = t;
      onFrame(m.spectate(undefined, { includePrivateChat: true }));
    }
    const last = replay.hashes[m.tick];
    if (last !== undefined && desyncAt === undefined && last !== m.hash()) desyncAt = m.tick;
    return { verified: desyncAt === undefined, desyncAt };
  } finally {
    m.dispose();
  }
}
