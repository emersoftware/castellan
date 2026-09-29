import { describe, expect, it } from "vitest";
import { v1, v2, playerGuide, viewToText, type Order, type ReplayFile, type Ruleset } from "@aoa/shared";
import { createMatch, runReplay, type Match } from "../src";

const players = [{ id: "p1", name: "one" }, { id: "p2", name: "two" }];
const r = (): Ruleset => ({ ...v2, startCapital: 1200,
  map: { ...v2.map, deposits: [], sharedDeposits: [{ x: 10, y: 5, amount: 5000 }] },
});
const make = (ruleset = r()) => createMatch({ ruleset, players, seed: 42, tickRate: 10 });
const units = (m: Match, kind: string, player = "p1") => m.view(player).mine.filter((e) => e.kind === kind);
const stepTo = (m: Match, tick: number) => { while (m.tick < tick && !m.outcome) m.step([]); };
const stopWorkers = (m: Match) => m.step(players.flatMap((p) => units(m, "worker", p.id).map((e) => ({ player: p.id, order: { type: "stop", unit: e.id } as Order }))));
const build = (m: Match, x = 7, y = 5) => m.step([{ player: "p1", order: { type: "build", unit: units(m, "worker")[0].id, kind: "nexus", x, y } }]);

describe("Nexus expansion", () => {
  it("reserves the site against traffic and competing builders, then releases it on cancellation", async () => {
    const m = await make();
    try {
      stopWorkers(m); build(m);
      const [builder, other] = units(m, "worker");
      const conflict = m.step([{ player: "p1", order: { type: "build", unit: other.id, kind: "nexus", x: 7, y: 5 } }]);
      expect(conflict.results[0]).toMatchObject({ ok: false });
      m.step([{ player: "p1", order: { type: "move", unit: other.id, x: 8, y: 5 } }]);
      while (m.tick < 150) {
        m.step([]);
        const moving = units(m, "worker").find((e) => e.id === other.id)!;
        expect([moving.x, moving.y]).not.toEqual([7, 5]);
      }
      expect(units(m, "worker").find((e) => e.id === builder.id)!.construction?.completesAtMs).toBe(30100);
      const trained = m.step(Array.from({ length: 6 }, () => ({ player: "p1", order: {
        type: "train", building: units(m, "nexus")[0].id, kind: "worker",
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
      expect(build(m).results[0]).toMatchObject({ ok: true, capital: { spent: 0, remaining: 1200, pending: 600 } });
      expect(units(m, "worker")[0].construction).toMatchObject({ kind: "nexus", x: 7, y: 5, completesAtMs: 30100 });
      expect(viewToText(m.view("p2"))).toContain("building nexus (7,5)");
      // Reissuing the same build must not reset the timer.
      stepTo(m, 150); build(m); stepTo(m, 301);
      expect(units(m, "nexus")).toHaveLength(1);
      const completed = m.step([]);
      const expansion = units(m, "nexus").find((e) => e.x === 7 && e.y === 5)!;
      expect(expansion).toMatchObject({ hp: 600, vital: false });
      expect(completed.events).toContainEqual(expect.objectContaining({ type: "spawn", id: expansion.id, capital: { spent: 600, remaining: 600 } }));
      expect(units(m, "worker")[0].construction).toBeUndefined();
      const trained = m.step([{ player: "p1", order: { type: "train", building: expansion.id, kind: "worker" } }]);
      expect(trained.results[0]).toMatchObject({ ok: true, capital: { spent: 50, remaining: 550 } });
      const workerId = trained.results[0].ok ? trained.results[0].id : "";
      let unloaded = false;
      for (let i = 0; i < 150; i++) {
        const result = m.step([]);
        if (result.events.some((e) => e.type === "unload" && e.id === workerId)) {
          const worker = units(m, "worker").find((e) => e.id === workerId)!;
          expect(Math.max(Math.abs(worker.x - expansion.x), Math.abs(worker.y - expansion.y))).toBeLessThanOrEqual(1);
          unloaded = true; break;
        }
      }
      expect(unloaded).toBe(true);
    } finally { m.dispose(); }
  });

  it("cancels without charge on changed orders or insufficient capital, rejects old rules and unaffordable orders", async () => {
    const m = await make();
    try {
      stopWorkers(m); build(m); stepTo(m, 100);
      const worker = units(m, "worker")[0];
      m.step([{ player: "p1", order: { type: "stop", unit: worker.id } }]);
      stepTo(m, 350);
      expect(units(m, "nexus")).toHaveLength(1);
      expect(m.view("p1").players[0].capital).toBe(1200);
      build(m);
      expect(units(m, "worker")[0].construction!.completesAtMs).toBe(65000);
      m.step(Array.from({ length: 7 }, () => ({ player: "p1", order: { type: "train", building: units(m, "nexus")[0].id, kind: "knight" } as Order })));
      expect(units(m, "worker")[0].construction).toBeUndefined();
      stepTo(m, 660);
      expect(units(m, "nexus")).toHaveLength(1);
    } finally { m.dispose(); }
    for (const ruleset of [v1, { ...r(), startCapital: 599 }]) {
      const invalid = await make(ruleset);
      try { expect(build(invalid).results[0]).toMatchObject({ ok: false, capital: { spent: 0 } }); }
      finally { invalid.dispose(); }
    }
  });

  it("keeps players alive after losing their Nexus, updates base targeting, and ends only on Agent death", async () => {
    const ruleset = r();
    ruleset.kinds = { ...ruleset.kinds, worker: { ...ruleset.kinds.worker, atk: 1000, range: 32, attackMs: 100 } };
    const m = await make(ruleset);
    try {
      stopWorkers(m);
      const worker = units(m, "worker")[0];
      const enemyNexus = units(m, "nexus", "p2")[0], agent = units(m, "agent", "p2")[0];
      // Base helpers must still point to a non-vital Nexus while it exists.
      m.step([{ player: "p1", order: { type: "script", kind: "nexus", code: 'self.log(JSON.stringify(self.enemyBase())); self.hold();' } }]);
      expect(m.events("p1", 1)).toContainEqual(expect.objectContaining({ type: "log", message: JSON.stringify({ x: enemyNexus.x, y: enemyNexus.y }) }));
      m.step([{ player: "p1", order: { type: "attack", unit: worker.id, target: enemyNexus.id } }]);
      expect(units(m, "nexus", "p2")).toHaveLength(0);
      expect(m.outcome).toBeNull();
      expect(m.view("p2").players.find((p) => p.id === "p2")?.alive).toBe(true);
      const after = m.step([]);
      expect(after.events).toContainEqual(expect.objectContaining({ type: "log", message: JSON.stringify({ x: agent.x, y: agent.y }) }));
      m.step([{ player: "p1", order: { type: "attack", unit: worker.id, target: agent.id } }]);
      expect(m.outcome).toMatchObject({ winner: "p1", reason: "vital_lost" });
      const guide = playerGuide(v2);
      expect(guide).toContain("Only the Agent is vital");
      expect(guide).toContain('"kind":"turret"|"wall"|"nexus"');
      expect(guide).not.toContain("your Agent (A) or your Nexus (N)");
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
          : tick === 1 ? [{ player: "p1", order: { type: "build", unit: units(m, "worker")[0].id, kind: "nexus", x: 7, y: 5 } as Order }] : [];
        replay.orders.push(...input.map((o) => ({ tick, ...o })));
        m.step(input); replay.hashes[tick] = m.hash();
      }
      replay.finalTick = m.tick; replay.hashes[m.tick] = m.hash(); replay.outcome = m.outcome!;
      let constructionSeen = false, expansionSeen = false;
      expect((await runReplay(replay, (frame) => {
        constructionSeen ||= frame.entities.some((e) => !!e.construction);
        expansionSeen ||= frame.entities.filter((e) => e.owner === "p1" && e.kind === "nexus").length === 2;
      })).verified).toBe(true);
      expect(constructionSeen && expansionSeen).toBe(true);
    } finally { m.dispose(); }
  });
});
