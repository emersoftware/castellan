import { afterEach, expect, it } from "vitest";
import { rules, playerGuide, type Ruleset } from "@aoa/shared";
import { createMatch, dist, type Match } from "../src";

const live: Match[] = [];
afterEach(() => { for (const m of live.splice(0)) m.dispose(); });
const idle = Object.fromEntries(["worker", "knight", "ranger", "king", "turret", "castle"].map((k) => [k, "self.hold();"]));
async function duel(base: Ruleset, start: Ruleset["map"]["start"], rocks: { x: number; y: number }[] = [], rangerRange = 8) {
  const ruleset: Ruleset = { ...base, defaultScripts: { ...base.defaultScripts, ...idle },
    kinds: { ...base.kinds, ranger: { ...base.kinds.ranger, range: rangerRange, vision: 12 }, knight: { ...base.kinds.knight, vision: 12 } },
    map: { ...base.map, width: 12, height: 9, deposits: [], sharedDeposits: [], walls: rocks, start } };
  const m = await createMatch({ ruleset, players: [{ id: "a", name: "A" }, { id: "b", name: "B" }], seed: 1, tickRate: 10 });
  live.push(m);
  return m;
}
const unit = (m: Match, p: string, kind: string) => m.view(p).mine.find((e) => e.kind === kind)!;

// Steps the match, returning per tick (the tick each step simulated) the unit's tile and its attacks.
const trace = (m: Match, id: string, ticks: number) => Array.from({ length: ticks }, () => {
  const tick = m.tick, events = m.step([]).events, u = m.view("a").mine.find((e) => e.id === id)!;
  return { tick, at: `${u.x},${u.y}`, attacked: events.some((e) => e.type === "attack" && e.from === id) };
});
const moves = (t: ReturnType<typeof trace>) => t.filter((s, i) => i > 0 && s.at !== t[i - 1].at).map((s) => s.tick);

it("makes rangers aim after a step, but not between blows while standing", async () => {
  // A ranger walks into range of the enemy ranger at (9,4), then stands its aim time before shooting.
  const m = await duel(rules, [{ kind: "ranger", x: 2, y: 4 }, { kind: "king", x: 0, y: 0 }], [], 4);
  const [a, b] = [unit(m, "a", "ranger"), unit(m, "b", "ranger")];
  m.step([{ player: "a", order: { type: "attack", unit: a.id, target: b.id } }]);
  const t = trace(m, a.id, 30);
  const shots = t.filter((s) => s.attacked).map((s) => s.tick);
  expect(t.find((s) => s.tick === shots[0])!.at).toBe("5,4");
  expect(shots[0] - moves(t).at(-1)!).toBe(rules.kinds.ranger.aimMs! / 100);
  expect(shots[1] - shots[0]).toBe(10);

  // Two knights side by side strike at once and then every second: no aim while standing.
  const k = await duel(rules, [{ kind: "knight", x: 5, y: 4 }, { kind: "king", x: 0, y: 0 }]);
  const [ka, kb] = [unit(k, "a", "knight"), unit(k, "b", "knight")];
  const first = k.step([{ player: "a", order: { type: "attack", unit: ka.id, target: kb.id } }]).events;
  expect(first.some((e) => e.type === "attack" && e.from === ka.id)).toBe(true); // the order's own tick
  const blows = trace(k, ka.id, 25).filter((s) => s.attacked).map((s) => s.tick);
  expect(blows.slice(0, 2)).toEqual([10, 20]);
});

it("takes 1.4x as long for a diagonal step", async () => {
  const gap = async (ruleset: Ruleset, x: number, y: number) => {
    const m = await duel(ruleset, [{ kind: "knight", x: 2, y: 2 }, { kind: "king", x: 0, y: 0 }]);
    const a = unit(m, "a", "knight");
    m.step([{ player: "a", order: { type: "move", unit: a.id, x, y } }]);
    const [first, second] = moves(trace(m, a.id, 20));
    return second - first;
  };
  expect(await gap(rules, 7, 2)).toBe(5); // straight: 500 ms
  expect(await gap(rules, 6, 6)).toBe(7); // diagonal: 700 ms
  expect(playerGuide(rules)).toContain("a diagonal step takes 1.4× as long as a straight one");
});

it("flies arrows over rock: only castles and turrets stop them", async () => {
  const shot = async (ruleset: Ruleset) => {
    const m = await duel(ruleset, [{ kind: "ranger", x: 2, y: 4 }, { kind: "king", x: 0, y: 0 }], [{ x: 5, y: 4 }, { x: 6, y: 4 }]);
    const b = unit(m, "b", "ranger");
    m.step([{ player: "a", order: { type: "attack", unit: unit(m, "a", "ranger").id, target: b.id } }]);
    return Array.from({ length: 12 }, () => m.step([]).events).flat().find((e) => e.type === "projectile_end");
  };
  expect(await shot(rules)).toMatchObject({ reason: "hit" });
  expect(playerGuide(rules)).toContain("Shots fly over rock and over hostile walls and doors");
  expect(playerGuide(rules)).toContain("knight (K): hp 100, def 6, atk 14 range 1 every 1000ms, after moving must stand still 100ms before attacking");
});

it("lets turrets outrange every ranger, and castles reach as far as a researched one", () => {
  const rangerMax = Math.max(rules.kinds.ranger.range!, ...rules.upgrades!.ranger_range.levels.map((l) => l.value));
  expect(rangerMax).toBe(6);
  expect(rules.kinds.turret.range).toBeGreaterThan(rangerMax);
  expect(rules.kinds.castle.range).toBeGreaterThanOrEqual(rangerMax);
});

it("measures range and vision as discs: Euclidean distance rounded to the nearest tile", async () => {
  expect([dist(0, 0, 1, 1), dist(0, 0, 4, 2), dist(0, 0, 3, 3), dist(0, 0, 4, 3), dist(0, 0, 6, 0)]).toEqual([1, 4, 4, 5, 6]);
  const m = await createMatch({ ruleset: { ...rules, map: { ...rules.map, width: 20, height: 20, deposits: [], sharedDeposits: [], walls: [],
    start: [{ kind: "king", x: 0, y: 0 }, { kind: "ranger", x: 10, y: 10 }] } }, players: [{ id: "a", name: "A" }, { id: "b", name: "B" }], seed: 1, tickRate: 10 });
  live.push(m);
  const seen = m.view("a").visibility; // the ranger at (10,10) sees a disc of radius 7
  expect([seen[10][17], seen[17][10], seen[15][15]]).toEqual(["2", "2", "2"]); // 7 straight, 7 straight, (5,5) rounds to 7
  expect(seen[16][16]).not.toBe("2"); // (6,6) rounds to 8: outside the disc, inside the old square
  expect(playerGuide(rules)).toContain("Euclidean, rounded to the nearest whole tile");
});

it("gives turrets a blind spot: an adjacent unit is safe, one tile further is not", async () => {
  const shots = async (x: number) => {
    const m = await createMatch({ ruleset: { ...rules, defaultScripts: { ...rules.defaultScripts, knight: "self.hold();" },
      map: { ...rules.map, width: 20, height: 20, deposits: [], sharedDeposits: [], walls: [],
        start: [{ kind: "king", x: 0, y: 0 }, { kind: "turret", x: 8, y: 8 }, { kind: "knight", x: 19 - x, y: 11 }] } },
      players: [{ id: "a", name: "A" }, { id: "b", name: "B" }], seed: 1, tickRate: 10 });
    live.push(m);
    // a's turret at (8,8); b's knight lands at (x, 8) after the 180° rotation.
    const knight = m.spectate().entities.find((e) => e.kind === "knight" && e.owner === "b")!.id;
    return Array.from({ length: 30 }, () => m.step([]).events).flat().filter((e) => e.type === "attack" && e.to === knight).length;
  };
  expect(await shots(9)).toBe(0); // adjacent: inside the blind spot
  expect(await shots(10)).toBeGreaterThan(0); // two tiles away: in range
  expect(playerGuide(rules)).toContain("can't attack anything closer than 2");
});

it("reveals an enemy that damages you from beyond your sight, for revealAttackerMs", async () => {
  // Mirrored: a's ranger (1,4) can hit b's knight (6,7); nothing of b's sees (1,4) (knights see 2 tiles here).
  const ruleset: Ruleset = { ...rules, defaultScripts: { ...rules.defaultScripts, ...idle },
    kinds: { ...rules.kinds, ranger: { ...rules.kinds.ranger, range: 7, vision: 8 }, knight: { ...rules.kinds.knight, vision: 2 } },
    map: { ...rules.map, width: 12, height: 9, deposits: [], sharedDeposits: [], walls: [],
      start: [{ kind: "king", x: 0, y: 0 }, { kind: "ranger", x: 1, y: 4 }, { kind: "knight", x: 5, y: 1 }] } };
  const m = await createMatch({ ruleset, players: [{ id: "a", name: "A" }, { id: "b", name: "B" }], seed: 1, tickRate: 10 });
  live.push(m);
  const shooter = unit(m, "a", "ranger"), target = unit(m, "b", "knight");
  const seen = () => m.view("b").enemy.some((e) => e.id === shooter.id);
  expect(seen()).toBe(false);
  m.step([{ player: "a", order: { type: "attack", unit: shooter.id, target: target.id } }]);
  let hit = false;
  for (let i = 0; i < 30 && !hit; i++) hit = m.step([]).events.some((e) => e.type === "projectile_end" && e.target === target.id && e.dmg > 0);
  expect(hit).toBe(true);
  expect(seen()).toBe(true);
  m.step([{ player: "a", order: { type: "move", unit: shooter.id, x: shooter.x, y: shooter.y } }]); // stop shooting
  for (let i = 0; i < rules.revealAttackerMs / 100; i++) m.step([]);
  expect(seen()).toBe(false);
  expect(playerGuide(rules)).toContain(`stays visible for ${rules.revealAttackerMs / 1000} s wherever it is`);
});
