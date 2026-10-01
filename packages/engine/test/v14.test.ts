import { afterEach, expect, it } from "vitest";
import { v13, v14, playerGuide, type Ruleset } from "@aoa/shared";
import { createMatch, type Match } from "../src";

const live: Match[] = [];
afterEach(() => { for (const m of live.splice(0)) m.dispose(); });
const idle = Object.fromEntries(["worker", "knight", "ranger", "king", "turret", "castle"].map((k) => [k, "self.hold();"]));
// Two rangers face each other along y=4; each side has a wall in front (p2's at (5,4) after rotation).
async function duel(base: Ruleset) {
  const ruleset: Ruleset = { ...base, fogOfWar: undefined, defaultScripts: { ...base.defaultScripts, ...idle },
    kinds: { ...base.kinds, ranger: { ...base.kinds.ranger, range: 8 } },
    map: { ...base.map, width: 12, height: 9, deposits: [], sharedDeposits: [], walls: [],
      start: [{ kind: "ranger", x: 2, y: 4 }, { kind: "king", x: 0, y: 0 }, { kind: "wall", x: 6, y: 4 }] } };
  const m = await createMatch({ ruleset, players: [{ id: "a", name: "A" }, { id: "b", name: "B" }], seed: 1, tickRate: 10 });
  live.push(m);
  const find = (p: string, kind: string) => m.view(p).mine.find((e) => e.kind === kind)!;
  return { m, a: find("a", "ranger"), b: find("b", "ranger"), wall: find("b", "wall") };
}
const flight = (m: Match) => Array.from({ length: 12 }, () => m.step([]).events).flat().find((e) => e.type === "projectile_end");

it("flies arrows over enemy walls, which are hit only when aimed at", async () => {
  const now = await duel(v14);
  expect(now.wall).toMatchObject({ x: 5, y: 4 });
  now.m.step([{ player: "a", order: { type: "attack", unit: now.a.id, target: now.b.id } }]);
  expect(flight(now.m)).toMatchObject({ reason: "hit", target: now.b.id });
  now.m.step([{ player: "a", order: { type: "attack", unit: now.a.id, target: now.wall.id } }]);
  for (let i = 0; i < 12; i++) now.m.step([]); // the next shot, once the 1 s cooldown is over
  expect(now.m.spectate().entities.find((e) => e.id === now.wall.id)!.hp).toBe(now.wall.hp - 2);

  const before = await duel(v13);
  before.m.step([{ player: "a", order: { type: "attack", unit: before.a.id, target: before.b.id } }]);
  expect(flight(before.m)).toMatchObject({ reason: "hit", target: before.wall.id });
});

it("keeps a ranger still for 300 ms after each shot, even under a move order", async () => {
  const firstStep = async (ruleset: Ruleset) => {
    const { m, a, b } = await duel(ruleset);
    const shot = m.tick;
    m.step([{ player: "a", order: { type: "attack", unit: a.id, target: b.id } }]);
    m.step([{ player: "a", order: { type: "move", unit: a.id, x: 0, y: 4 } }]);
    while (m.view("a").mine.find((e) => e.id === a.id)!.x === a.x) m.step([]);
    return m.tick - 1 - shot;
  };
  expect(await firstStep(v14)).toBe(3);
  expect(await firstStep(v13)).toBe(1);
});

it("lets turrets outrange rangers at every research level, and says so in the guide", () => {
  const ranger = [v14.kinds.ranger.range!, ...v14.upgrades!.ranger_range.levels.map((l) => l.value)];
  const turret = [v14.kinds.turret.range!, ...v14.upgrades!.turret_range.levels.map((l) => l.value)];
  expect(ranger).toEqual([4, 5]);
  expect(turret).toEqual([6, 7, 8]);
  expect(Math.max(...ranger)).toBeLessThan(Math.min(...turret));
  const guide = playerGuide(v14);
  expect(guide).toContain("ranger (R): hp 50, def 2, atk 12 range 4 every 1000ms, stands still 300ms after each shot");
  expect(guide).toContain("Shots fly over hostile walls and doors");
  expect(guide).toContain("Walls and doors block movement, not shots");
  expect(playerGuide(v13)).not.toContain("fly over");
});
