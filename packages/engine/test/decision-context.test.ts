import { afterEach, expect, it } from "vitest";
import { rules, viewToText, type Ruleset } from "@aoa/shared";
import { createMatch, type Match } from "../src";

const matches: Match[] = [];
afterEach(() => matches.splice(0).forEach(m => m.dispose()));
async function setup(patch: Partial<Ruleset> = {}) {
  const ruleset = { ...rules, matchMs: 180_000, startMineral: 2000, defaultScripts: Object.fromEntries(Object.keys(rules.defaultScripts).map(k => [k, "self.hold();"])),
    map: { ...rules.map, width: 12, height: 12, start: [{ kind: "king", x: 0, y: 0 }, { kind: "castle", x: 3, y: 3 }], walls: [], deposits: [], sharedDeposits: [] }, ...patch };
  const m = await createMatch({ ruleset, players: Array.from({ length: ruleset.map.seats ?? 2 }, (_, i) => ({ id: String.fromCharCode(97 + i), name: String.fromCharCode(65 + i), side: i })), seed: 1, tickRate: 10 });
  matches.push(m); return m;
}

it("shows actual outcomes for scripts and orders without leaking them to opponents", async () => {
  const m = await setup();
  m.step([{ player: "a", order: { type: "script", kind: "king", code: "self.move('W');" } }]);
  const king = m.view("a").mine.find(e => e.kind === "king")!;
  expect(king.doing).toBe("step ←");
  expect(king.actionResult).toMatchObject({ source: "script", tick: 0, status: "blocked" });
  m.step([{ player: "a", order: { type: "move", unit: king.id, x: 2, y: 0 } }]);
  expect(m.view("a").mine.find(e => e.id === king.id)?.actionResult).toMatchObject({ source: "order", tick: 1, status: "acted", effect: "move" });
  m.step([]);
  expect(m.view("a").mine.find(e => e.id === king.id)?.actionResult).toMatchObject({ source: "order", status: "cooldown" });
  expect(m.view("b").enemy.every(e => !e.actionResult && !e.doing && !e.order)).toBe(true);
  expect(viewToText(m.view("a"))).toContain("result [2] order: cooldown");
});

it("uses command validation for queue, mineral, population and research blockers", async () => {
  const m = await setup({ popCap: 30 });
  const building = m.view("a").mine.find(e => e.kind === "castle")!.id;
  for (let i = 0; i < rules.trainingQueueLimit; i++) expect(m.step([{ player: "a", order: { type: "train", building, kind: "knight" } }]).results[0].ok).toBe(true);
  const availability = m.view("a").availableActions!.train.find(a => a.building === building && a.kind === "knight")!;
  expect(availability).toMatchObject({ cost: 100, queue: 5, queueLimit: 5, blockedBy: ["training queue full"] });
  expect(m.step([{ player: "a", order: { type: "train", building, kind: "knight" } }]).results[0]).toMatchObject({ ok: false, reason: availability.blockedBy[0] });
  const poor = await setup({ startMineral: 0, popCap: 1 });
  expect(poor.view("a").availableActions!.train[0].blockedBy).toEqual(["needs 50 mineral, you have 0", "population cap 1 reached"]);
  expect(poor.view("a").availableActions!.research.every(a => a.blockedBy.some(b => b.includes("mineral")))).toBe(true);
});

it("keeps damage and losses after the victim is gone and declares expired history", async () => {
  const map = { ...rules.map, width: 8, height: 9, walls: [], deposits: [], sharedDeposits: [],
    start: [{ kind: "king", x: 0, y: 0 }, { kind: "knight", x: 3, y: 4 }] };
  const m = await setup({ map, kinds: { ...rules.kinds, knight: { ...rules.kinds.knight, hp: 10, atk: 50, range: 1 } } });
  const a = m.view("a").mine.find(e => e.kind === "knight")!, b = m.view("b").mine.find(e => e.kind === "knight")!;
  m.step([{ player: "b", order: { type: "attack", unit: b.id, target: a.id } }]);
  expect(m.view("a").mine.some(e => e.id === a.id)).toBe(false);
  expect(m.view("a", 0).combat!.encounters).toContainEqual(expect.objectContaining({ damage: { a: 44 }, losses: [expect.objectContaining({ id: a.id, owner: "a", kind: "knight" })] }));
  expect(m.view("a", 1).combat!.encounters).toEqual([]);
  for (let i = 0; i < 1201; i++) m.step([]);
  expect(m.view("a", 0).combat).toMatchObject({ truncated: true, encounters: [] });
});

it("retains aged unit sightings without tracking hidden movement or hidden deaths", async () => {
  const map = { ...rules.map, width: 20, height: 20, walls: [], deposits: [], sharedDeposits: [],
    start: [{ kind: "king", x: 8, y: 8 }] };
  const m = await setup({ map, kinds: { ...rules.kinds, king: { ...rules.kinds.king, vision: 5 } } });
  const b = m.view("b").mine[0];
  expect(m.view("a").enemy).toHaveLength(1);
  m.step([{ player: "b", order: { type: "move", unit: b.id, x: 19, y: 19 } }]);
  for (let i = 0; i < 50; i++) m.step([]);
  const sighting = m.view("a").lastSeen.find(e => e.id === b.id)!;
  expect(sighting).toMatchObject({ entityType: "unit", positionCleared: true });
  expect(sighting.x).not.toBe(m.view("b").mine[0].x);
  for (let i = 0; i < 10; i++) m.step([]);
  expect(m.view("a").lastSeen.find(e => e.id === b.id)).toEqual(sighting);
  expect(m.view("a").enemy).toEqual([]);
});

it("does not reveal a remote fight or an unseen death through summaries", async () => {
  const m = await setup({ map: { ...rules.map, width: 30, height: 30, seats: 4, walls: [], deposits: [], sharedDeposits: [],
    start: [{ kind: "king", x: 0, y: 0 }] }, kinds: { ...rules.kinds, king: { ...rules.kinds.king, hp: 10, atk: 20, def: 0, range: 3, vision: 3, moveMs: 100 } } });
  const b = m.view("b").mine[0], c = m.view("c").mine[0];
  m.step([{ player: "b", order: { type: "move", unit: b.id, x: c.x, y: c.y + 2 } }]);
  for (let i = 0; i < 40; i++) m.step([]);
  expect(m.step([{ player: "b", order: { type: "attack", unit: b.id, target: c.id } }]).results[0].ok).toBe(true);
  for (let i = 0; i < 5; i++) m.step([]);
  expect(m.view("c").mine).toEqual([]);
  expect(m.view("b", 0).combat!.encounters.some(b => b.losses.some(e => e.id === c.id))).toBe(true);
  expect(m.view("a", 0).combat!.encounters).toEqual([]);
});
