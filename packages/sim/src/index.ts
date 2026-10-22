import { createMatch, type PlayerOrder } from "@castellan/engine";
import { MAPS, rules, type OrderResult, type Outcome, type Ruleset } from "@castellan/shared";
import type { Bot } from "@castellan/bots";

export interface SimSide {
  bot: Bot;
  /** The bot only decides every `latencyMs` (models LLM thinking time). */
  latencyMs: number;
}

export interface SimResult {
  outcome: Outcome;
  ticks: number;
  /** Recorded orders and state hashes, for writing a replay. */
  orders: { tick: number; player: string; order: PlayerOrder["order"] }[];
  hashes: Record<number, string>;
  /** Every rejected order, retained alongside the submitted replay inputs. */
  rejectedOrders: { tick: number; player: string; order: PlayerOrder["order"]; result: OrderResult }[];
}

/** Plays a whole match as fast as possible, without real time. */
export async function simulate(a: SimSide, b: SimSide, opts: { seed?: number; ruleset?: Ruleset; tickRate?: number; map?: string } = {}): Promise<SimResult> {
  const tickRate = opts.tickRate ?? 10;
  const base = opts.ruleset ?? rules;
  const m = await createMatch({
    ruleset: opts.map ? { ...base, map: MAPS[opts.map] } : base, seed: opts.seed ?? 1, tickRate,
    players: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }],
  });
  // Each side decides every `every` ticks, starting at a seeded random offset:
  // LLMs don't answer in lockstep, and this gives each seed a different game.
  let rnd = (opts.seed ?? 1) * 2654435761;
  const next = () => ((rnd = (Math.imul(rnd ^ (rnd >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296);
  const side = (id: string, s: SimSide) => {
    const every = Math.max(1, Math.round((s.latencyMs * tickRate) / 1000));
    return { id, ...s, every, offset: Math.floor(next() * every) };
  };
  const sides = [side("p1", a), side("p2", b)];
  const orders: SimResult["orders"] = [];
  const hashes: Record<number, string> = {};
  const rejectedOrders: SimResult["rejectedOrders"] = [];
  try {
    while (!m.outcome) {
      const input: PlayerOrder[] = [];
      for (const s of sides) {
        if (m.tick % s.every !== s.offset) continue;
        for (const order of s.bot(m.view(s.id, m.tick))) input.push({ player: s.id, order });
      }
      for (const o of input) orders.push({ tick: m.tick, ...o });
      const t = m.tick;
      const step = m.step(input);
      step.results.forEach((result, i) => { if (!result.ok) rejectedOrders.push({ tick: t, ...input[i], result }); });
      if (t % 100 === 0) hashes[t] = m.hash();
    }
    hashes[m.tick] = m.hash();
    return { outcome: m.outcome!, ticks: m.tick, orders, hashes, rejectedOrders };
  } finally {
    m.dispose();
  }
}
