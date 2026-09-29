import { describe, expect, it } from "vitest";
import { v3, type Order, type Ruleset, type ReplayFile } from "@aoa/shared";
import { createMatch, runReplay, type Match } from "../src";

const players = [{ id: "p1", name: "one" }, { id: "p2", name: "two" }];
const rules = (): Ruleset => ({ ...v3, startCapital: 2000, fogOfWar: undefined,
  map: { ...v3.map, deposits: [], sharedDeposits: [] } });
const make = (r = rules()) => createMatch({ ruleset: r, players, seed: 7, tickRate: 10 });
const mine = (m: Match, kind: string, player = "p1") => m.view(player).mine.filter((e) => e.kind === kind);
const next = (m: Match, orders: Order[], player = "p1") => m.step(orders.map((order) => ({ player, order })));
const advance = (m: Match, tick: number) => { while (m.tick < tick && !m.outcome) m.step([]); };

describe("timed production", () => {
  it("charges once, reserves population, trains in sequence and exposes only the active deadline", async () => {
    const m = await make();
    try {
      const b = mine(m, "nexus")[0].id;
      const result = next(m, [{ type: "train", building: b, kind: "worker" }, { type: "train", building: b, kind: "knight" }]);
      expect(result.results).toMatchObject([{ ok: true, capital: { spent: 50, remaining: 1950 } }, { ok: true, capital: { spent: 100, remaining: 1850 } }]);
      expect(result.results[0]).not.toHaveProperty("id");
      expect(mine(m, "nexus")[0].training).toEqual([{ kind: "worker", completesAtMs: 5000 }, { kind: "knight" }]);
      expect(m.view("p1").players[0].queuedPop).toBe(2);
      advance(m, 50); expect(mine(m, "worker")).toHaveLength(3);
      m.step([]); expect(mine(m, "worker")).toHaveLength(4);
      expect(mine(m, "nexus")[0].training).toEqual([{ kind: "knight", completesAtMs: 13000 }]);
      advance(m, 130); expect(mine(m, "knight")).toHaveLength(0);
      m.step([]); expect(mine(m, "knight")).toHaveLength(1);
      expect(m.view("p1").players[0]).toMatchObject({ capital: 1850, pop: 6, queuedPop: 0 });
    } finally { m.dispose(); }
  });

  it("enforces queue and population limits without charging rejected orders", async () => {
    for (const popCap of [30, 6]) {
      const m = await make({ ...rules(), popCap });
      try {
        const b = mine(m, "nexus")[0].id;
        const results = next(m, Array.from({ length: 6 }, () => ({ type: "train", building: b, kind: "worker" }))).results;
        const accepted = popCap === 30 ? 5 : 2;
        expect(results.filter((r) => r.ok)).toHaveLength(accepted);
        expect(results.at(-1)).toMatchObject({ ok: false, capital: { spent: 0, remaining: 2000 - 50 * accepted } });
      } finally { m.dispose(); }
    }
  });

  it("keeps a completed unit paid and queued while exits are blocked, then starts the next timer after release", async () => {
    const r = rules();
    r.map = { ...r.map, walls: [{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }, { x: 3, y: 4 },
      { x: 5, y: 4 }, { x: 3, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 5 }] };
    const m = await make(r);
    try {
      const b = mine(m, "nexus")[0].id;
      next(m, [{ type: "train", building: b, kind: "worker" }, { type: "train", building: b, kind: "worker" }]);
      advance(m, 100);
      expect(mine(m, "worker")).toHaveLength(3);
      expect(mine(m, "nexus")[0].training).toEqual([{ kind: "worker", completesAtMs: 5000 }, { kind: "worker" }]);
      expect(m.view("p1").players[0].capital).toBe(1900);
    } finally { m.dispose(); }
    // A mobile blocker can leave, unlike the rock enclosure above.
    const open = rules();
    open.map = { ...open.map, walls: r.map.walls.filter((w) => !(w.x === 5 && w.y === 5)),
      start: open.map.start.map((e) => e.kind === "agent" ? { ...e, x: 5, y: 5 } : e.kind === "worker" ? { ...e, x: e.x + 4, y: e.y + 4 } : e) };
    const m2 = await make(open);
    try {
      const b = mine(m2, "nexus")[0].id;
      next(m2, [{ type: "train", building: b, kind: "worker" }, { type: "train", building: b, kind: "worker" }]);
      advance(m2, 100);
      next(m2, [{ type: "move", unit: mine(m2, "agent")[0].id, x: 8, y: 8 }]);
      m2.step([]);
      expect(mine(m2, "worker")).toHaveLength(4);
      expect(mine(m2, "nexus")[0].training?.[0].completesAtMs).toBe(15100);
      expect(m2.view("p1").players[0].capital).toBe(1900);
    } finally { m2.dispose(); }
  });

  it("loses destroyed producer queues without refund or eliminating the owner", async () => {
    const r = rules(); r.kinds = { ...r.kinds, worker: { ...r.kinds.worker, atk: 1000, range: 32 } };
    const m = await make(r);
    try {
      const nexus = mine(m, "nexus")[0];
      next(m, [{ type: "train", building: nexus.id, kind: "worker" }]);
      next(m, [{ type: "attack", unit: mine(m, "worker", "p2")[0].id, target: nexus.id }], "p2");
      expect(mine(m, "nexus")).toHaveLength(0);
      expect(m.view("p1").players[0]).toMatchObject({ alive: true, queuedPop: 0, capital: 1950 });
      advance(m, 100); expect(mine(m, "worker")).toHaveLength(3);
    } finally { m.dispose(); }
  });

  it("replays production queues deterministically", async () => {
    const r = { ...rules(), matchMs: 15000 };
    const m = await make(r);
    try {
      const replay: ReplayFile = { format: 1, id: "production", createdAt: "", ruleset: r, seed: 7, tickRate: 10, players,
        orders: [], hashes: {}, finalTick: 0, outcome: { winner: null, reason: "timeout", scores: {} } };
      const b = mine(m, "nexus")[0].id;
      while (!m.outcome) {
        const tick = m.tick;
        const input = tick === 0 ? [{ player: "p1", order: { type: "train", building: b, kind: "knight" } as Order }] : [];
        replay.orders.push(...input.map((o) => ({ tick, ...o })));
        m.step(input); replay.hashes[tick] = m.hash();
      }
      replay.finalTick = m.tick; replay.outcome = m.outcome!;
      expect((await runReplay(replay, () => {})).verified).toBe(true);
    } finally { m.dispose(); }
  });
});
