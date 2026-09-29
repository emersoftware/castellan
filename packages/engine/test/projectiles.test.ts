import { afterEach, expect, it } from "vitest";
import { v4, v5, v6, playerGuide, viewToText, type Ruleset, type ReplayFile } from "@aoa/shared";
import { createMatch, runReplay, type Match, type PlayerOrder } from "../src";
import { segmentCircleHit } from "../src/projectiles";

const live: Match[] = [];
afterEach(() => { for (const m of live.splice(0)) m.dispose(); });
const players = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
async function setup(options: { legacy?: boolean; speed?: number; range?: number; fog?: boolean; wall?: boolean; rate?: number; start?: Ruleset["map"]["start"] } = {}) {
  const base = options.legacy ? v4 : v6;
  const ruleset: Ruleset = { ...base, matchMs: 5000, fogOfWar: options.fog ? base.fogOfWar : undefined,
    ...(options.speed ? { projectiles: { ...v6.projectiles!, speed: options.speed } } : {}),
    defaultScripts: { knight: "self.hold();", ranger: "self.hold();" },
    kinds: { ...base.kinds, ranger: { ...base.kinds.ranger, range: options.range ?? 8, def: 0, attackMs: 10000, moveMs: 100 } },
    map: { ...base.map, width: 9, height: 9, deposits: [], sharedDeposits: [], walls: options.wall ? [{ x: 4, y: 4 }] : [],
      start: options.start ?? [{ kind: "ranger", x: 2, y: 4 }, { kind: "agent", x: 0, y: 0 }] } };
  const m = await createMatch({ ruleset, players, seed: 1, tickRate: options.rate ?? 10 });
  live.push(m);
  const a = m.view("a").mine.find(e => e.kind === "ranger")!;
  const b = m.view("b").mine.find(e => e.kind === "ranger")!;
  const fire: PlayerOrder[] = [{ player: "a", order: { type: "attack", unit: a.id, target: b.id } }];
  return { m, a, b, fire, ruleset };
}
const hp = (m: Match, id: string) => m.spectate().entities.find(e => e.id === id)?.hp;
const advance = (m: Match, n: number) => Array.from({ length: n }, () => m.step([])).flatMap(s => s.events);

it("launches without damage, then damages on collision at the simulated location", async () => {
  const { m, a, b, fire } = await setup();
  expect(m.step(fire).events).toContainEqual(expect.objectContaining({ type: "attack", dmg: 0, projectile: "p1" }));
  expect(hp(m, b.id)).toBe(b.hp);
  expect(m.view("a").projectiles).toEqual([{ id: "p1", owner: "a", x: a.x, y: a.y, vx: 12, vy: 0, endX: b.x, endY: b.y }]);
  advance(m, 3);
  expect(hp(m, b.id)).toBe(b.hp);
  const impact = m.step([]).events.find(e => e.type === "projectile_end");
  expect(impact).toMatchObject({ reason: "hit", target: b.id, dmg: 12, x: 5.65, y: 4 });
  expect(hp(m, b.id)).toBe(b.hp - 12);
  expect(m.spectate().projectiles).toEqual([]);
});

it("misses a target that dodges after launch; the destination never tracks", async () => {
  const { m, b, fire } = await setup();
  m.step(fire);
  m.step([{ player: "b", order: { type: "move", unit: b.id, x: b.x, y: b.y - 1 } }]);
  expect(m.spectate().projectiles![0].endY).toBe(4);
  expect(advance(m, 8)).toContainEqual(expect.objectContaining({ type: "projectile_end", reason: "miss", dmg: 0 }));
  expect(hp(m, b.id)).toBe(b.hp);
});

it("lets a sandbox script perceive and dodge a real incoming shot", async () => {
  const { m, b, fire } = await setup({ fog: true });
  m.step([...fire, { player: "b", order: { type: "script", kind: "ranger", code:
    'if (self.projectiles().some(p => p.owner !== "b")) self.move("N"); else self.hold();' } }]);
  advance(m, 8);
  expect(hp(m, b.id)).toBe(b.hp);
  expect(m.view("b").mine.find(e => e.id === b.id)!.y).toBeLessThan(4);
});

it("intercepts the first hostile unit, even with a segment crossing several tiles", async () => {
  const { m, b, fire } = await setup({ speed: 100, start: [
    { kind: "ranger", x: 2, y: 4 }, { kind: "worker", x: 4, y: 3 }, { kind: "agent", x: 0, y: 0 },
  ] });
  m.step(fire);
  const worker = m.view("b").mine.find(e => e.kind === "worker")!;
  const events = m.step([{ player: "b", order: { type: "move", unit: worker.id, x: 4, y: 4 } }]).events;
  expect(events).toContainEqual(expect.objectContaining({ type: "projectile_end", target: worker.id, reason: "hit" }));
  expect(hp(m, b.id)).toBe(b.hp);
  expect(hp(m, worker.id)).toBeLessThan(worker.hp);
});

it("ignores friendly units and blocks at rock terrain", async () => {
  const { m, b, fire } = await setup({ wall: true, speed: 100 });
  m.step(fire);
  expect(m.step([]).events).toContainEqual(expect.objectContaining({ type: "projectile_end", reason: "blocked", x: 3.5 }));
  expect(hp(m, b.id)).toBe(b.hp);
  const second = await setup({ speed: 100, start: [
    { kind: "ranger", x: 2, y: 4 }, { kind: "worker", x: 4, y: 3 }, { kind: "agent", x: 0, y: 0 },
  ] });
  second.m.step(second.fire);
  const worker = second.m.view("a").mine.find(e => e.kind === "worker")!;
  second.m.step([{ player: "a", order: { type: "move", unit: worker.id, x: 4, y: 4 } }]);
  expect(hp(second.m, worker.id)).toBe(worker.hp);
  expect(hp(second.m, second.b.id)).toBeLessThan(second.b.hp);
});

it("keeps shots alive after the shooter dies and records the owner of the kill", async () => {
  const { m, a, b, fire } = await setup({ start: [
    { kind: "ranger", x: 2, y: 4 }, { kind: "worker", x: 6, y: 5 }, { kind: "agent", x: 0, y: 0 },
  ] });
  const internals = m as unknown as { ents: Map<string, { hp: number }> };
  internals.ents.get(a.id)!.hp = 1;
  internals.ents.get(b.id)!.hp = 1;
  m.step(fire);
  const killer = m.view("b").mine.find(e => e.kind === "worker")!;
  m.step([{ player: "b", order: { type: "attack", unit: killer.id, target: a.id } }]);
  expect(hp(m, a.id)).toBeUndefined();
  expect(m.spectate().projectiles).toHaveLength(1);
  expect(advance(m, 8)).toContainEqual(expect.objectContaining({ type: "death", id: b.id, by: "a" }));
});

it("preserves instant ranged damage for legacy rules and immediate melee for v6", async () => {
  const old = await setup({ legacy: true });
  old.m.step(old.fire);
  expect(hp(old.m, old.b.id)).toBe(old.b.hp - 12);
  expect(old.m.spectate().projectiles).toBeUndefined();
  const melee = await setup({ range: 1, start: [{ kind: "ranger", x: 4, y: 3 }, { kind: "agent", x: 0, y: 0 }] });
  // Move within range, then attack in the next tick.
  melee.m.step([{ player: "a", order: { type: "move", unit: melee.a.id, x: 4, y: 4 } }]);
  melee.m.step(melee.fire);
  expect(hp(melee.m, melee.b.id)).toBe(melee.b.hp - 12);
  expect(melee.m.spectate().projectiles).toEqual([]);
});

it("filters projectile state by current team vision", async () => {
  const { m, fire } = await setup({ fog: true });
  m.step(fire);
  const internals = m as unknown as { visible: Map<string, Set<number>> };
  internals.visible.set("b", new Set());
  expect(m.view("b").projectiles).toEqual([]);
  expect(m.spectate().perspectives!.b.projectiles).toEqual([]);
  expect(m.spectate().projectiles).toHaveLength(1);
  expect(viewToText(m.view("a"))).toContain("velocity (12.00,0.00)");
  expect(playerGuide(m.ruleset)).toContain("self.projectiles()");
});

it("replays deterministically with projectile state in hashes", async () => {
  const { m, ruleset, fire } = await setup();
  const hashes: Record<number, string> = {};
  while (!m.outcome) { const t = m.tick; m.step(t === 0 ? fire : []); hashes[t] = m.hash(); }
  const replay: ReplayFile = { format: 1, id: "test", createdAt: "", ruleset, seed: 1, tickRate: 10, players,
    orders: fire.map(o => ({ ...o, tick: 0 })), hashes, finalTick: m.tick, outcome: m.outcome! };
  expect(await runReplay(replay, () => {})).toMatchObject({ verified: true });
});

it("uses swept collision rather than testing only the segment endpoint", () => {
  expect(segmentCircleHit(0, 0, 10, 0, 4, 0, 0.5)).toBeCloseTo(0.35);
  expect(segmentCircleHit(0, 0, 10, 0, 4, 1, 0.5)).toBeNull();
});

it("does not leak hidden impact events to the shooter", async () => {
  const { m, fire } = await setup({ fog: true });
  m.step(fire);
  const internals = m as unknown as { ents: Map<string, { owner: string; spec: { vision: number } }> };
  for (const e of internals.ents.values()) if (e.owner === "a") e.spec = { ...e.spec, vision: 0 };
  advance(m, 4);
  expect(m.spectate().events.some(e => e.type === "projectile_end")).toBe(true);
  expect(m.spectate().perspectives!.a.events.some(e => e.type === "projectile_end")).toBe(false);
  expect(m.spectate().perspectives!.b.events.some(e => e.type === "projectile_end")).toBe(true);
});

it.each([10, 20, 40].flatMap(rate => [v5, v6].map(rules => [rate, rules.projectiles!.speed])))("keeps flight speed independent of tick rate (%s Hz, %s tiles/s)", async (rate, speed) => {
  const { m, fire } = await setup({ rate, speed });
  m.step(fire);
  while (m.spectate().projectiles!.length) m.step([]);
  const end = m.spectate().events.find(e => e.type === "projectile_end")!;
  expect(end.tick / rate).toBeGreaterThanOrEqual(3.65 / speed);
  expect(end.tick / rate).toBeLessThan(3.65 / speed + 1 / rate);
});
