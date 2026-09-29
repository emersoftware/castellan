import { describe, expect, it } from "vitest";
import { v0, type Order, type Ruleset } from "@aoa/shared";
import { createMatch, type Match, type PlayerOrder } from "../src";

const players = [{ id: "p1", name: "one" }, { id: "p2", name: "two" }];
const make = (ruleset: Ruleset = v0, seed = 1) => createMatch({ ruleset, players, seed, tickRate: 10 });
const run = (m: Match, n: number, orders: (m: Match) => PlayerOrder[] = () => []) => {
  for (let i = 0; i < n && !m.outcome; i++) m.step(orders(m));
};
const mine = (m: Match, p: string, kind: string) => m.view(p).mine.filter((e) => e.kind === kind);

describe("engine", () => {
  it("sets up a mirrored map", async () => {
    const m = await make();
    const v = m.view("p1");
    expect(v.grid).toHaveLength(32);
    expect(v.mine.map((e) => e.kind).sort()).toEqual(["agent", "nexus", "worker", "worker", "worker"]);
    const n1 = mine(m, "p1", "nexus")[0];
    const n2 = mine(m, "p2", "nexus")[0];
    expect([n2.x, n2.y]).toEqual([31 - n1.x, 31 - n1.y]);
    expect(v.grid[n1.y][n1.x]).toBe("N");
    expect(v.grid[n2.y][n2.x]).toBe("n");
  });

  it("workers gather capital on their own", async () => {
    const m = await make();
    run(m, 300);
    const p = m.view("p1").players.find((x) => x.id === "p1")!;
    expect(p.capital).toBeGreaterThan(v0.startCapital + 50);
  });

  it("trains units instantly and charges capital", async () => {
    const m = await make();
    const nexus = mine(m, "p1", "nexus")[0];
    const r = m.step([{ player: "p1", order: { type: "train", building: nexus.id, kind: "knight" } }]);
    expect(r.results[0]).toMatchObject({ ok: true });
    expect(r.results[0].capital).toEqual({ spent: 100, remaining: v0.startCapital - 100 });
    expect(mine(m, "p1", "knight")).toHaveLength(1);
    expect(m.view("p1").players[0].capital).toBe(v0.startCapital - 100);
    const r2 = m.step([
      { player: "p1", order: { type: "train", building: nexus.id, kind: "knight" } },
      { player: "p1", order: { type: "train", building: nexus.id, kind: "knight" } },
    ]);
    expect(r2.results[1]).toMatchObject({ ok: false });
    expect(r2.results[0].capital).toEqual({ spent: 100, remaining: 0 });
    expect(r2.results[1].capital).toEqual({ spent: 0, remaining: 0 });
  });

  it("rejects malformed and foreign orders without throwing", async () => {
    const m = await make();
    const enemyWorker = mine(m, "p2", "worker")[0];
    const r = m.step([
      { player: "p1", order: { type: "fly" } as unknown as Order },
      { player: "p1", order: { type: "move", unit: enemyWorker.id, x: 1, y: 1 } },
      { player: "p1", order: { type: "move", unit: "e999", x: 1, y: 1 } },
    ]);
    expect(r.results.every((x) => !x.ok)).toBe(true);
  });

  it("moves units along a path around obstacles", async () => {
    const m = await make();
    const agent = mine(m, "p1", "agent")[0];
    m.step([{ player: "p1", order: { type: "move", unit: agent.id, x: 12, y: 12 } }]);
    run(m, 200);
    const a = mine(m, "p1", "agent")[0];
    expect([a.x, a.y]).toEqual([12, 12]);
    expect(a.order).toBeUndefined();
  });

  it("scripted knights walk to the enemy base and the vital rule ends the match", async () => {
    const m = await make();
    const nexus = mine(m, "p1", "nexus")[0];
    const attack = `const e = self.nearestEnemy();
if (e && self.distanceTo(e) <= self.range) self.attack(e);
else { const b = self.enemyBase(); self.moveTo(b.x, b.y); }`;
    // Stop p2's economy so p1 wins decisively.
    const p2workers = mine(m, "p2", "worker").map((w) => ({ player: "p2", order: { type: "stop", unit: w.id } as Order }));
    m.step([{ player: "p1", order: { type: "script", kind: "knight", code: attack } }, ...p2workers]);
    run(m, 6000, (mm) => {
      const cap = mm.view("p1").players[0].capital;
      return (cap ?? 0) >= 100 ? [{ player: "p1", order: { type: "train", building: nexus.id, kind: "knight" } }] : [];
    });
    expect(m.outcome).toMatchObject({ winner: "p1", reason: "vital_lost" });
  });

  it("is deterministic: same orders, same hash", async () => {
    const play = async () => {
      const m = await make(v0, 42);
      const nexus = mine(m, "p1", "nexus")[0];
      const nexus2 = mine(m, "p2", "nexus")[0];
      m.step([{ player: "p1", order: { type: "script", kind: "knight", code: "const b=self.enemyBase(); if (self.random()<0.5) self.move('E'); else self.moveTo(b.x,b.y);" } }]);
      run(m, 1500, (mm) => mm.tick % 50 === 0 ? [
        { player: "p1", order: { type: "train", building: nexus.id, kind: "knight" } },
        { player: "p2", order: { type: "train", building: nexus2.id, kind: "knight" } },
      ] : []);
      return m.hash();
    };
    expect(await play()).toBe(await play());
  });

  it("builds instantly when the worker arrives", async () => {
    const m = await make();
    const w = mine(m, "p1", "worker")[0];
    const ordered = m.step([{ player: "p1", order: { type: "build", unit: w.id, kind: "turret", x: 7, y: 7 } }]);
    expect(ordered.results[0].capital).toEqual({ spent: 0, remaining: v0.startCapital, pending: v0.kinds.turret.cost });
    run(m, 60);
    expect(mine(m, "p1", "turret")).toHaveLength(1);
    expect(mine(m, "p1", "worker").find((x) => x.id === w.id)!.order).toMatch(/gather/);
    expect(m.events("p1", 0)).toContainEqual(expect.objectContaining({ type: "spawn", builder: w.id, capital: { spent: v0.kinds.turret.cost, remaining: expect.any(Number) } }));
  });

  it("reports one actual charge when repeated build orders complete in the same tick", async () => {
    const m = await make();
    const v = m.view("p1");
    const w = mine(m, "p1", "worker")[0];
    const places = [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => ({ x: w.x + dx, y: w.y + dy })));
    const pos = places.find(({ x, y }) => v.grid[y]?.[x] === "·")!;
    const order: Order = { type: "build", unit: w.id, kind: "wall", ...pos };
    const { results } = m.step([{ player: "p1", order }, { player: "p1", order }]);
    expect(mine(m, "p1", "wall")).toHaveLength(1);
    expect(results.reduce((sum, r) => sum + (r.capital?.spent ?? 0), 0)).toBe(v0.kinds.wall.cost);
    expect(results[1].capital).toEqual({ spent: v0.kinds.wall.cost, remaining: v0.startCapital - v0.kinds.wall.cost });
  });

  it("times out on score", async () => {
    const m = await make({ ...v0, matchMs: 5_000 });
    run(m, 100);
    expect(m.outcome?.reason).toBe("timeout");
  });
});

describe("replay", () => {
  it("re-simulates a recorded match exactly", async () => {
    const { simulate, BOTS } = await import("@aoa/sim");
    const { runReplay } = await import("../src");
    const r = await simulate({ bot: BOTS.eco(), latencyMs: 2000 }, { bot: BOTS.rush(), latencyMs: 3000 }, { seed: 9, ruleset: v0 });
    let frames = 0;
    const check = await runReplay({
      format: 1, id: "t", createdAt: "", ruleset: v0, seed: 9, tickRate: 10, players,
      orders: r.orders, hashes: r.hashes, finalTick: r.ticks, outcome: r.outcome,
    }, () => frames++);
    expect(check).toEqual({ verified: true, desyncAt: undefined });
    expect(frames).toBe(r.ticks + 1);
  });
});

describe("building rules", () => {
  it("allows a tower rush to build and damage the enemy Nexus", async () => {
    const m = await make();
    const w = mine(m, "p1", "worker")[0];
    const enemyNexus = mine(m, "p2", "nexus")[0];
    const x = enemyNexus.x - v0.kinds.turret.range!;
    const r = m.step([{ player: "p1", order: { type: "build", unit: w.id, kind: "turret", x, y: enemyNexus.y } }]);
    expect(r.results[0]).toMatchObject({ ok: true });
    run(m, 300);
    expect(mine(m, "p1", "turret")).toHaveLength(1);
    expect(mine(m, "p2", "nexus")[0].hp).toBeLessThan(enemyNexus.hp);
  });

  it("preserves build exclusion when enabled by a saved ruleset", async () => {
    const m = await make({ ...v0, buildExclusion: 8 });
    const w = mine(m, "p1", "worker")[0];
    const enemyNexus = mine(m, "p2", "nexus")[0];
    const r = m.step([{ player: "p1", order: { type: "build", unit: w.id, kind: "turret", x: enemyNexus.x - 5, y: enemyNexus.y } }]);
    expect(r.results[0]).toMatchObject({ ok: false });
    expect((r.results[0] as { reason: string }).reason).toMatch(/too close/);
  });
});

describe("maps and sides", () => {
  it("rock walls block movement and building, and show as ^", async () => {
    const { LEGACY_MAPS: MAPS } = await import("@aoa/shared");
    const m = await make({ ...v0, map: MAPS.ridge });
    const wall = MAPS.ridge.walls[0];
    expect(m.view("p1").grid[wall.y][wall.x]).toBe("^");
    const w = mine(m, "p1", "worker")[0];
    const r = m.step([{ player: "p1", order: { type: "build", unit: w.id, kind: "wall", x: wall.x, y: wall.y } }]);
    expect(r.results[0]).toMatchObject({ ok: false });
    // A unit can still reach the far side through a pass.
    const agent = mine(m, "p1", "agent")[0];
    m.step([{ player: "p1", order: { type: "move", unit: agent.id, x: 20, y: 20 } }]);
    run(m, 400);
    expect(mine(m, "p1", "agent")[0]).toMatchObject({ x: 20, y: 20 });
  });

  it("puts a player on the rotated side when asked", async () => {
    const m = await createMatch({ ruleset: v0, seed: 1, tickRate: 10, players: [{ id: "p1", name: "a", side: 1 }, { id: "p2", name: "b", side: 0 }] });
    expect(mine(m, "p1", "nexus")[0]).toMatchObject({ x: 27, y: 27 });
    expect(mine(m, "p2", "nexus")[0]).toMatchObject({ x: 4, y: 4 });
  });

  it("rangers shoot from range", async () => {
    const m = await make();
    const nexus = mine(m, "p1", "nexus")[0];
    const r = m.step([{ player: "p1", order: { type: "train", building: nexus.id, kind: "ranger" } }]);
    expect(r.results[0]).toMatchObject({ ok: true });
    expect(mine(m, "p1", "ranger")[0].maxHp).toBe(v0.kinds.ranger.hp);
  });
});
