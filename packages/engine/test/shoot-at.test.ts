import { afterEach, expect, it } from "vitest";
import { rules, type Ruleset, type ReplayFile } from "@aoa/shared";
import { createMatch, runReplay, type Match, type PlayerOrder } from "../src";

const live: Match[] = [];
afterEach(() => { for (const m of live.splice(0)) m.dispose(); });
const players = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
async function setup(start: Ruleset["map"]["start"] = [{ kind: "archer", x: 2, y: 4 }, { kind: "king", x: 0, y: 0 }], width = 9) {
  const ruleset: Ruleset = { ...rules, matchMs: 5000,
    defaultScripts: { ...rules.defaultScripts, knight: "self.hold();", archer: "self.hold();", tower: "self.hold();" },
    kinds: { ...rules.kinds, archer: { ...rules.kinds.archer, range: 8, def: 0, attackMs: 10000, moveMs: 100, aimMs: 0 } },
    map: { ...rules.map, width, height: 9, deposits: [], sharedDeposits: [], walls: [], start } };
  const m = await createMatch({ ruleset, players, seed: 1, tickRate: 10 });
  live.push(m);
  const own = (p: string, kind: string) => m.view(p).mine.find(e => e.kind === kind)!;
  return { m, ruleset, own };
}
const script = (player: string, kind: string, code: string): PlayerOrder => ({ player, order: { type: "script", kind, code } });
const hp = (m: Match, id: string) => m.spectate().entities.find(e => e.id === id)?.hp;
const advance = (m: Match, n: number) => Array.from({ length: n }, () => m.step([])).flatMap(s => s.events);
const result = (m: Match, id: string) => m.view("a").mine.find(e => e.id === id)?.actionResult;

it("launches toward a point and hits the first hostile on its path", async () => {
  const { m, own } = await setup();
  const b = own("b", "archer");
  const launch = m.step([script("a", "archer", `self.shootAt(${b.x}, ${b.y});`)]).events;
  expect(launch).toContainEqual(expect.objectContaining({ type: "attack", at: { x: b.x, y: b.y }, dmg: 0, projectile: "p1" }));
  expect(launch.find(e => e.type === "attack")).not.toHaveProperty("to");
  expect(advance(m, 6)).toContainEqual(expect.objectContaining({ type: "projectile_end", reason: "hit", target: b.id }));
  expect(hp(m, b.id)).toBeLessThan(b.hp);
});

it("leads a moving target: the point shot hits where an attack on the unit misses", async () => {
  for (const [code, hits] of [["self.shootAt(6, 2)", true], ["self.attack(self.nearestEnemy())", false]] as const) {
    const { m, own } = await setup();
    const a = own("a", "archer"), b = own("b", "archer");
    // b steps north to (6,2) while the shot flies; only the shot aimed ahead meets it there.
    m.step([script("a", "archer", `if (!self.memory.shot) { ${code}; self.memory.shot = 1; } else self.hold();`),
      { player: "b", order: { type: "move", unit: b.id, x: 6, y: 2 } }]);
    advance(m, 8);
    expect([b.x, b.y, a.x]).toEqual([6, 4, 2]);
    expect(hp(m, b.id) !== b.hp).toBe(hits);
  }
});

it("refuses what attack refuses: melee units, a tower's dead zone, points in fog or out of range", async () => {
  const { m, own } = await setup([{ kind: "archer", x: 2, y: 4 }, { kind: "knight", x: 2, y: 2 }, { kind: "tower", x: 2, y: 8 }, { kind: "king", x: 0, y: 0 }], 20);
  const archer = own("a", "archer"), knight = own("a", "knight"), tower = own("a", "tower");
  m.step([script("a", "knight", "self.shootAt(3, 2);"), script("a", "tower", "self.shootAt(3, 8);"),
    script("a", "archer", "self.shootAt(10, 4);")]);
  m.step([]);
  expect(result(m, knight.id)).toMatchObject({ status: "invalid", reason: "unit cannot shoot" });
  expect(result(m, tower.id)).toMatchObject({ status: "blocked" }); // inside its minimum range
  expect(m.view("a").visibility[4][10]).not.toBe("2"); // in range (8) but beyond sight
  expect(result(m, archer.id)).toMatchObject({ status: "blocked", reason: "point not visible or not in range" });
  m.step([script("a", "archer", "self.shootAt(12, 4);")]); // beyond range 8
  m.step([]);
  expect(result(m, archer.id)).toMatchObject({ status: "blocked", reason: "point not visible or not in range" });
});

it("never hits inside the shooter's blind spot: adjacent enemies survive point shots and interceptions", async () => {
  // Mirrored start: a's tower (2,4) ends up with b's knight adjacent at (3,4), inside minRange 2.
  const { m, own } = await setup([{ kind: "tower", x: 2, y: 4 }, { kind: "knight", x: 5, y: 4 }, { kind: "king", x: 0, y: 0 }]);
  const knight = m.view("a").enemy.find(e => e.kind === "knight")!;
  own("a", "tower");
  expect([knight.x, knight.y]).toEqual([3, 4]);
  // A point shot aimed just past the adjacent knight flies over it and lands empty.
  m.step([script("a", "tower", "self.shootAt(4, 4);")]);
  const flight = advance(m, 4);
  expect(flight).toContainEqual(expect.objectContaining({ type: "projectile_end", reason: "miss" }));
  expect(hp(m, knight.id)).toBe(knight.hp);
  // An attack on a target beyond also passes over the blind spot instead of letting it intercept.
  const enemyTower = m.view("a").enemy.find(e => e.kind === "tower")!;
  m.step([script("a", "tower", "const t = self.nearbyEnemies().find((e) => e.isBuilding); if (t) self.attack(t); else self.hold();")]);
  // The tower refires once its 1 s cooldown from the point shot clears.
  const impact = advance(m, 14).find(e => e.type === "projectile_end" && e.reason === "hit");
  expect(impact).toMatchObject({ target: enemyTower.id, dmg: 5 });
  expect(hp(m, knight.id)).toBe(knight.hp);
});

it("replays a match with point shots deterministically", async () => {
  const { m, ruleset, own } = await setup();
  const b = own("b", "archer");
  const orders = [script("a", "archer", `self.shootAt(${b.x - 0.5}, ${b.y + 0.25});`)];
  const hashes: Record<number, string> = {};
  while (!m.outcome) { const t = m.tick; m.step(t === 0 ? orders : []); hashes[t] = m.hash(); }
  const replay: ReplayFile = { format: 1, id: "shoot-at", createdAt: "", ruleset, seed: 1, tickRate: 10, players,
    orders: orders.map(o => ({ ...o, tick: 0 })), hashes, finalTick: m.tick, outcome: m.outcome! };
  expect(await runReplay(replay, () => {})).toMatchObject({ verified: true });
});
