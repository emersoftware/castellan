import { describe, expect, it } from "vitest";
import { rules, playerGuide, viewToText, type Order, type ReplayFile, type Ruleset } from "@castellan/shared";
import { createMatch, runReplay, type Match } from "../src";

const players = [{ id: "p1", name: "one" }, { id: "p2", name: "two" }];
const r = (): Ruleset => ({ ...rules, startMineral: 1200,
  // Pin the fixture's price and timer so economy tuning does not change these
  // construction, cancellation and replay scenarios.
  kinds: { ...rules.kinds, castle: { ...rules.kinds.castle, cost: 600, buildMs: 30000 } },
  map: { ...rules.map, deposits: [], sharedDeposits: [{ x: 10, y: 5, amount: 5000 }] },
});
const make = (ruleset = r()) => createMatch({ ruleset, players, seed: 42, tickRate: 10 });
const units = (m: Match, kind: string, player = "p1") => m.view(player).mine.filter((e) => e.kind === kind);
const stepTo = (m: Match, tick: number) => { while (m.tick < tick && !m.outcome) m.step([]); };
// Workers mine by script; holding them keeps these tests about the castle build.
const stopWorkers = (m: Match) => m.step(players.map((p) => ({ player: p.id, order: { type: "script", kind: "worker", code: "self.hold();" } as Order })));
const build = (m: Match, x = 7, y = 5) => m.step([{ player: "p1", order: { type: "build", unit: units(m, "worker")[0].id, kind: "castle", x, y } }]);

describe("Castle expansion", () => {
  it("reserves the site against traffic and competing builders, then releases it on cancellation", async () => {
    const m = await make();
    try {
      stopWorkers(m); build(m);
      const [builder, other] = units(m, "worker");
      const conflict = m.step([{ player: "p1", order: { type: "build", unit: other.id, kind: "castle", x: 7, y: 5 } }]);
      expect(conflict.results[0]).toMatchObject({ ok: false });
      m.step([{ player: "p1", order: { type: "move", unit: other.id, x: 8, y: 5 } }]);
      while (m.tick < 150) {
        m.step([]);
        const moving = units(m, "worker").find((e) => e.id === other.id)!;
        expect([moving.x, moving.y]).not.toEqual([7, 5]);
      }
      expect(units(m, "worker").find((e) => e.id === builder.id)!.construction?.completesAtMs).toBe(30100);
      const trained = m.step(Array.from({ length: 6 }, () => ({ player: "p1", order: {
        type: "train", building: units(m, "castle")[0].id, kind: "worker",
      } as Order })));
      expect(trained.results.some((r) => r.ok)).toBe(true);
      expect(m.view("p1").mine.some((e) => e.x === 7 && e.y === 5)).toBe(false);
      expect(units(m, "worker").find((e) => e.id === builder.id)!.construction).toBeDefined();
      m.step([{ player: "p1", order: { type: "stop", unit: builder.id } },
        { player: "p1", order: { type: "move", unit: other.id, x: 7, y: 5 } }]);
      stepTo(m, 180);
      const arrived = units(m, "worker").find((e) => e.id === other.id)!;
      expect([arrived.x, arrived.y]).toEqual([7, 5]);
    } finally { m.dispose(); }
  });

  it("requires 30 seconds adjacent, charges 600 once, trains workers and receives their resources at the expansion", async () => {
    const m = await make();
    try {
      stopWorkers(m);
      expect(build(m).results[0]).toMatchObject({ ok: true, mineral: { spent: 0, remaining: 1200, pending: 600 } });
      expect(units(m, "worker")[0].construction).toMatchObject({ kind: "castle", x: 7, y: 5, completesAtMs: 30100 });
      expect(viewToText(m.view("p1"))).toContain("building castle (7,5)");
      // Reissuing the same build must not reset the timer.
      stepTo(m, 150); build(m); stepTo(m, 301);
      expect(units(m, "castle")).toHaveLength(1);
      const completed = m.step([]);
      const expansion = units(m, "castle").find((e) => e.x === 7 && e.y === 5)!;
      expect(expansion).toMatchObject({ hp: rules.kinds.castle.hp, vital: false });
      expect(completed.events).toContainEqual(expect.objectContaining({ type: "spawn", id: expansion.id, mineral: { spent: 600, remaining: 600 } }));
      expect(units(m, "worker")[0].construction).toBeUndefined();
      const trained = m.step([{ player: "p1", order: { type: "train", building: expansion.id, kind: "worker" } },
        { player: "p1", order: { type: "script", kind: "worker", code: "self.gather();" } }]);
      expect(trained.results[0]).toMatchObject({ ok: true, mineral: { spent: 50, remaining: 550 } });
      let workerId = "";
      let unloaded = false;
      for (let i = 0; i < 250; i++) {
        const result = m.step([]);
        const spawn = result.events.find((e) => e.type === "spawn" && e.owner === "p1" && e.kind === "worker");
        workerId ||= spawn?.type === "spawn" ? spawn.id : "";
        if (workerId && result.events.some((e) => e.type === "unload" && e.id === workerId)) {
          const worker = units(m, "worker").find((e) => e.id === workerId)!;
          expect(Math.max(Math.abs(worker.x - expansion.x), Math.abs(worker.y - expansion.y))).toBeLessThanOrEqual(1);
          unloaded = true; break;
        }
      }
      expect(unloaded).toBe(true);
    } finally { m.dispose(); }
  });

  it("cancels without charge on changed orders or insufficient mineral, and rejects unaffordable orders", async () => {
    const m = await make();
    try {
      stopWorkers(m); build(m); stepTo(m, 100);
      const worker = units(m, "worker")[0];
      m.step([{ player: "p1", order: { type: "stop", unit: worker.id } }]);
      stepTo(m, 350);
      expect(units(m, "castle")).toHaveLength(1);
      expect(m.view("p1").players[0].mineral).toBe(1200);
      build(m);
      expect(units(m, "worker")[0].construction!.completesAtMs).toBe(65000);
      // Spend below the castle's 600: five knights fill the queue, research takes the rest.
      m.step([...Array.from({ length: 5 }, () => ({ player: "p1", order: { type: "train", building: units(m, "castle")[0].id, kind: "knight" } as Order })),
        { player: "p1", order: { type: "upgrade", upgrade: "knight_damage" } }]);
      expect(units(m, "worker")[0].construction).toBeUndefined();
      stepTo(m, 660);
      expect(units(m, "castle")).toHaveLength(1);
    } finally { m.dispose(); }
    for (const ruleset of [{ ...r(), startMineral: 599 }]) {
      const invalid = await make(ruleset);
      try { expect(build(invalid).results[0]).toMatchObject({ ok: false, mineral: { spent: 0 } }); }
      finally { invalid.dispose(); }
    }
  });

  it("keeps players alive after losing their castle, updates base targeting, and ends only on King death", async () => {
    const ruleset = r();
    ruleset.kinds = { ...ruleset.kinds, worker: { ...ruleset.kinds.worker, atk: 1000, range: 32, attackMs: 100, vision: 40 },
      castle: { ...ruleset.kinds.castle, vision: 40 } };
    // One worker each, off the line of fire (shots stop at the first hostile in the way).
    ruleset.map = { ...ruleset.map, start: [...ruleset.map.start.filter((s) => s.kind !== "worker"), { kind: "worker", x: 0, y: 6 }] };
    const m = await make(ruleset);
    try {
      stopWorkers(m);
      const worker = units(m, "worker")[0];
      const enemyCastle = units(m, "castle", "p2")[0], king = units(m, "king", "p2")[0];
      // Base helpers must still point to a non-vital castle while it exists.
      m.step([{ player: "p1", order: { type: "script", kind: "castle", code: 'self.log(JSON.stringify(self.enemyBase())); self.hold();' } }]);
      expect(m.events("p1", 1)).toContainEqual(expect.objectContaining({ type: "log", message: JSON.stringify({ x: enemyCastle.x, y: enemyCastle.y }) }));
      m.step([{ player: "p1", order: { type: "attack", unit: worker.id, target: enemyCastle.id } }]);
      for (let i = 0; i < 40 && units(m, "castle", "p2").length; i++) m.step([]);
      expect(units(m, "castle", "p2")).toHaveLength(0);
      expect(m.outcome).toBeNull();
      expect(m.view("p2").players.find((p) => p.id === "p2")?.alive).toBe(true);
      const after = m.step([]);
      expect(after.events).toContainEqual(expect.objectContaining({ type: "log", message: JSON.stringify({ x: king.x, y: king.y }) }));
      m.step([{ player: "p1", order: { type: "attack", unit: worker.id, target: king.id } }]);
      for (let i = 0; i < 40 && !m.outcome; i++) m.step([]);
      expect(m.outcome).toMatchObject({ winner: "p1", reason: "vital_lost" });
      const guide = playerGuide(rules);
      expect(guide).toContain("Only the King is vital");
      expect(guide).toContain('"kind":"tower"|"wall"|"door"|"castle"');
    } finally { m.dispose(); }
  });

  it("records construction timers and reproduces completed expansions in a replay", async () => {
    const ruleset = { ...r(), matchMs: 35_000 };
    const m = await make(ruleset);
    try {
      const replay: ReplayFile = { format: 1, id: "expansion", createdAt: "", ruleset, seed: 42, tickRate: 10, players,
        orders: [], hashes: {}, finalTick: 0, outcome: { winner: null, reason: "timeout", scores: {} } };
      while (!m.outcome) {
        const tick = m.tick;
        const input = tick === 0 ? players.flatMap((p) => units(m, "worker", p.id).map((e) => ({ player: p.id, order: { type: "stop", unit: e.id } as Order })))
          : tick === 1 ? [{ player: "p1", order: { type: "build", unit: units(m, "worker")[0].id, kind: "castle", x: 7, y: 5 } as Order }] : [];
        replay.orders.push(...input.map((o) => ({ tick, ...o })));
        m.step(input); replay.hashes[tick] = m.hash();
      }
      replay.finalTick = m.tick; replay.hashes[m.tick] = m.hash(); replay.outcome = m.outcome!;
      let constructionSeen = false, expansionSeen = false;
      expect((await runReplay(replay, (frame) => {
        constructionSeen ||= frame.entities.some((e) => !!e.construction);
        expansionSeen ||= frame.entities.filter((e) => e.owner === "p1" && e.kind === "castle").length === 2;
      })).verified).toBe(true);
      expect(constructionSeen && expansionSeen).toBe(true);
    } finally { m.dispose(); }
  });
});
