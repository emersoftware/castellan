import { describe, expect, it } from "vitest";
import { createMatch, type MatchConfig, type PlayerOrder } from "@aoa/engine";
import { MAPS, rules, type ExperimentManifest, type Ruleset } from "@aoa/shared";
import { BOTS, simulate } from "../src";
import { assertBalanceReplay, replayContinuation, resumeBattle, runBattle, type Snapshot } from "../src/battles";
import { splitReplays } from "../src/experiment-split";
import { scenario } from "../src/synthetic";

const players = [{ id: "p1", name: "one" }, { id: "p2", name: "two" }];
function snapshot(config: MatchConfig, tick: number, hash: string, orders: (PlayerOrder & { tick: number })[]): Snapshot {
  return { format: "aoa-battle-v2", id: "replay#0", version: config.ruleset.version,
    map: { ...config.ruleset.map, seats: 2 }, players: players.map((p, team) => ({ id: p.id, team, upgrades: {} })),
    entities: [], scripts: {}, continuation: { config, tick, hash, orders } };
}

describe("reference bot production", () => {
  it.each(Object.keys(BOTS))("%s produces military with current costs, queues and optional unlocks", async (name) => {
    const r: Ruleset = structuredClone(rules);
    r.startMineral = 5000;
    r.trainingQueueLimit = 2;
    for (const [kind, cost] of Object.entries({ worker: 73, knight: 137, archer: 181, tower: 233 })) r.kinds[kind].cost = cost;
    for (const kind of ["knight", "archer", "tower"] as const) {
      r.kinds[kind].requires = `unlock_${kind}`;
      r.upgrades[`unlock_${kind}`] = { kind, stat: "unlock", levels: [{ cost: 107, researchMs: 500, value: 1 }] };
    }
    const m = await createMatch({ ruleset: r, players, seed: 1, tickRate: 10 });
    try {
      const bot = BOTS[name](r), rejected: unknown[] = [], built = new Set<string>();
      for (let t = 0; t < 900 && !m.outcome; t++) {
        const input = t % 10 === 0 ? bot(m.view("p1", t)).map((order) => ({ player: "p1", order })) : [];
        const result = m.step(input);
        result.results.forEach((res, i) => { if (!res.ok) rejected.push({ order: input[i].order, res }); });
        for (const e of result.events) if (e.type === "spawn" && e.owner === "p1") built.add(e.kind);
      }
      expect(rejected).toEqual([]);
      expect([...built].some((kind) => ["knight", "archer", "tower"].includes(kind))).toBe(true);
      expect(m.view("p1").mine.filter((e) => e.kind === "worker").length).toBeLessThanOrEqual(name === "rush" || name === "turtle" ? 6 : 9);
    } finally { m.dispose(); }
  });

  it("reports every rejected command with its original tick and player", async () => {
    const r = { ...rules, matchMs: 200 };
    const result = await simulate({ bot: () => [{ type: "train", building: "missing", kind: "worker" }], latencyMs: 100 },
      { bot: () => [], latencyMs: 100 }, { ruleset: r });
    expect(result.rejectedOrders).toHaveLength(2);
    expect(result.rejectedOrders[0]).toMatchObject({ tick: 0, player: "p1", result: { ok: false, reason: "no building missing of yours" } });
  });

  it.each([["open", "rush"], ["fortress", "rush"], ["open", "archers"], ["fortress", "archers"]])("on %s, %s scouts and engages without a visible enemy base", async (map, name) => {
    const r = structuredClone(rules);
    r.map = MAPS[map]; r.startMineral = 2000;
    r.kinds.worker.trainMs = 100; r.kinds.knight.trainMs = 100; r.kinds.archer.trainMs = 100;
    const m = await createMatch({ ruleset: r, players, seed: 7, tickRate: 10 });
    try {
      expect(m.view("p1").enemy).toEqual([]);
      const bot = BOTS[name](r), own = new Set(m.view("p1").mine.map((e) => e.id));
      let attacks = 0;
      for (let t = 0; t < 700 && !attacks && !m.outcome; t++) {
        const input = t % 10 === 0 ? bot(m.view("p1", t)).map((order) => ({ player: "p1", order })) : [];
        const result = m.step(input);
        expect(result.results.filter((res) => !res.ok)).toEqual([]);
        for (const e of result.events) {
          if (e.type === "spawn" && e.owner === "p1") own.add(e.id);
          if (e.type === "attack" && own.has(e.from)) attacks++;
        }
      }
      expect(attacks).toBeGreaterThan(0);
    } finally { m.dispose(); }
  });
});

describe("recorded battle continuation", () => {
  it("excludes watchdog failures from extraction, prefix creation and battle restoration", async () => {
    const failures = [{ tick: 100, player: "p1", message: "sandbox wall-clock watchdog expired" }];
    const experiment: ExperimentManifest = { schema: 1,
      engine: { revision: null, sourceSha256: null, runtime: "test" }, rulesSha256: "rules", baseGuideSha256: "guide",
      mode: "independent", players: {}, calls: [], droppedCalls: 0, operationalFailures: failures };
    const replay = { id: "watchdog", experiment, ruleset: rules, seed: 1, tickRate: 10, players, orders: [] };
    expect(() => assertBalanceReplay(replay)).toThrow("operational sandbox failures");
    // Reject even a boundary before the emergency: the source replay is not benchmark evidence.
    expect(() => replayContinuation(replay, 0, "hash")).toThrow("wall-clock watchdog");
    const s = snapshot({ ruleset: rules, seed: 1, tickRate: 10, players }, 0, "hash", []);
    s.continuation!.operationalFailures = failures;
    await expect(resumeBattle(s)).rejects.toThrow("operational sandbox failures");
    expect(() => assertBalanceReplay({ id: "historical" })).not.toThrow();
    expect(replayContinuation({ ...replay, experiment: { ...experiment, operationalFailures: [] } }, 0, "hash").tick).toBe(0);
  });

  it("reproduces memory, timers, projectiles, production and first-tick events", async () => {
    const r: Ruleset = structuredClone(rules);
    r.startMineral = 2000;
    r.projectiles.speed = 2;
    r.map = { name: "continuation", description: "", width: 10, height: 7, walls: [], deposits: [], sharedDeposits: [],
      start: [{ kind: "castle", x: 0, y: 0 }, { kind: "king", x: 1, y: 0 }, { kind: "worker", x: 0, y: 1 },
        { kind: "knight", x: 4, y: 3 }, { kind: "archer", x: 3, y: 3 }] };
    r.defaultScripts.knight = "self.memory.n = (self.memory.n || 0) + 1; if (self.memory.n >= 10) self.attack(self.nearestEnemy()); else self.hold();";
    r.defaultScripts.king = "self.hold();";
    // Pin the shooter: the current archer default steps away from melee this close instead of firing.
    r.defaultScripts.archer = "const t = self.enemiesInRange(); if (t.length) self.attack(t[0]); else self.hold();";
    const config = { ruleset: r, players, seed: 2, tickRate: 10 };
    const m = await createMatch(config);
    let restored;
    try {
      const mine = m.view("p1").mine;
      const orders: (PlayerOrder & { tick: number })[] = [
        { tick: 0, player: "p1", order: { type: "train", building: mine.find((e) => e.kind === "castle")!.id, kind: "worker" } },
        { tick: 0, player: "p1", order: { type: "build", unit: mine.find((e) => e.kind === "worker")!.id, kind: "wall", x: 1, y: 1 } },
      ];
      m.step(orders);
      while (m.tick < 3) m.step([]);
      expect(m.spectate().projectiles.length).toBeGreaterThan(0);
      const s = snapshot(config, m.tick, m.hash(), orders);
      restored = await resumeBattle(s, r);
      expect(restored.spectate()).toEqual(m.spectate());
      let attacks = 0;
      for (let i = 0; i < 65 && !m.outcome; i++) {
        const expected = m.step([]);
        attacks += expected.events.filter((e) => e.type === "attack").length;
        expect(restored.step([])).toEqual(expected);
        expect(restored.spectate()).toEqual(m.spectate());
        expect(restored.hash()).toBe(m.hash());
      }
      expect(attacks).toBeGreaterThan(0);
    } finally { m.dispose(); restored?.dispose(); }
  });

  it("rejects lossy and desynchronized recorded snapshots", async () => {
    const config = { ruleset: rules, players, seed: 1, tickRate: 10 };
    const s = snapshot(config, 0, "wrong", []);
    await expect(resumeBattle(s)).rejects.toThrow("does not reproduce");
    delete s.continuation;
    await expect(runBattle(s)).rejects.toThrow("lossy legacy snapshot");
  });

  it("scores a death on the very first tick and accepts restored attack orders with current vision", async () => {
    const s: Snapshot = { format: "aoa-battle-v2", synthetic: true, id: "fixture", version: rules.version,
      map: { name: "fixture", width: 8, height: 8, seats: 2, walls: [] },
      players: players.map((p, team) => ({ id: p.id, team, upgrades: {} })), scripts: {},
      entities: [{ id: "e1", kind: "knight", owner: "p1", x: 3, y: 3, hp: rules.kinds.knight.hp, maxHp: rules.kinds.knight.hp, order: "attack e2" },
        { id: "e2", kind: "knight", owner: "p2", x: 4, y: 3, hp: 1, maxHp: rules.kinds.knight.hp }] };
    const result = await runBattle(s, rules, {}, 1);
    expect(result.ticks).toBe(1);
    expect(result.lost.p2).toBe(rules.kinds.knight.cost);
    expect(result.destroyedBy.knight).toBe(rules.kinds.knight.cost);
    expect(result.rejectedOrders).toBe(0);
  });

  it("runs explicitly marked designed scenarios", async () => {
    const fixture = scenario(0, rules);
    expect(fixture.synthetic).toBe(true);
    expect((await runBattle(fixture, rules, {}, 5)).errors).toBe(0);
  });
});

describe("optimizer dataset partitions", () => {
  it("keeps all fights from a replay together in three deterministic disjoint groups", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `game-${i}#0`);
    const split = splitReplays([...ids, "game-0#1", "game-0#2"]);
    expect(splitReplays([...ids].reverse())).toEqual(split);
    expect([...split.values()].filter((p) => p === "search")).toHaveLength(6);
    expect([...split.values()].filter((p) => p === "validation")).toHaveLength(2);
    expect([...split.values()].filter((p) => p === "test")).toHaveLength(2);
    expect(split.size).toBe(10);
    expect(() => splitReplays(["one#0", "one#1", "two#0"])).toThrow("3 independent replays");
  });
});
