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

it("makes knights and rangers aim 300 ms after a step, but not between blows while standing", async () => {
  // A ranger walks into range (4) of the enemy ranger at (9,4), then stands 3 ticks before shooting.
  const m = await duel(rules, [{ kind: "ranger", x: 2, y: 4 }, { kind: "king", x: 0, y: 0 }], [], 4);
  const [a, b] = [unit(m, "a", "ranger"), unit(m, "b", "ranger")];
  m.step([{ player: "a", order: { type: "attack", unit: a.id, target: b.id } }]);
  const t = trace(m, a.id, 30);
  const shots = t.filter((s) => s.attacked).map((s) => s.tick);
  expect(t.find((s) => s.tick === shots[0])!.at).toBe("5,4");
  expect(shots[0] - moves(t).at(-1)!).toBe(3);
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
  expect(await gap(rules, 7, 2)).toBe(4); // straight: 400 ms
  expect(await gap(rules, 6, 6)).toBe(6); // diagonal: 560 ms, rounded to the tick
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
  expect(playerGuide(rules)).toContain("knight (K): hp 100, def 6, atk 12 range 1 every 1000ms, after moving must stand still 300ms before attacking");
});

it("lets castles and turrets outrange every ranger", () => {
  const rangerMax = Math.max(rules.kinds.ranger.range!, ...rules.upgrades!.ranger_range.levels.map((l) => l.value));
  expect(rangerMax).toBe(5);
  expect([rules.kinds.castle.range, rules.kinds.turret.range]).toEqual([6, 6]);
  expect(rules.kinds.castle.vision).toBe(7);
});

it("measures range and vision as discs: Euclidean distance rounded to the nearest tile", async () => {
  expect([dist(0, 0, 1, 1), dist(0, 0, 4, 2), dist(0, 0, 3, 3), dist(0, 0, 4, 3), dist(0, 0, 6, 0)]).toEqual([1, 4, 4, 5, 6]);
  const m = await createMatch({ ruleset: { ...rules, map: { ...rules.map, width: 20, height: 20, deposits: [], sharedDeposits: [], walls: [],
    start: [{ kind: "king", x: 0, y: 0 }, { kind: "ranger", x: 10, y: 10 }] } }, players: [{ id: "a", name: "A" }, { id: "b", name: "B" }], seed: 1, tickRate: 10 });
  live.push(m);
  const seen = m.view("a").visibility; // the ranger at (10,10) sees a disc of radius 6
  expect([seen[10][16], seen[16][10], seen[14][14]]).toEqual(["2", "2", "2"]); // 6 straight, 6 straight, (4,4) rounds to 6
  expect(seen[15][15]).not.toBe("2"); // (5,5) rounds to 7: outside the disc, inside the old square
  expect(playerGuide(rules)).toContain("Euclidean, rounded to the nearest whole tile");
});
