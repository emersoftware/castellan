import { afterEach, expect, it } from "vitest";
import { rules, viewToText, type Ruleset } from "@castellan/shared";
import { createMatch, type Match, type MatchConfig } from "../src";

const matches: Match[] = [];
afterEach(() => matches.splice(0).forEach(m => m.dispose()));
async function setup(patch: Partial<Ruleset> = {}, tickRate = 10, players?: MatchConfig["players"]) {
  const m = await createMatch({ players: players ?? [{ id: "a", name: "A" }, { id: "b", name: "B" }], seed: 9, tickRate,
    ruleset: { ...rules, matchMs: 20_000,
      map: { ...rules.map, width: 8, height: 8, walls: [], deposits: [], sharedDeposits: [],
        start: [{ kind: "king", x: 0, y: 0 }, { kind: "knight", x: 3, y: 3 }] },
      defaultScripts: Object.fromEntries(Object.keys(rules.defaultScripts).map(k => [k, "self.hold();"])), ...patch } });
  matches.push(m); return m;
}
const unit = (m: Match, owner = "a", kind = "knight") => m.view(owner).mine.find(e => e.kind === kind)!;
const script = (code: string, kind = "knight") => ({ player: "a", order: { type: "script" as const, kind, code } });

it("reveals a retreat suspended by repeated attacks, counting strikes rather than attempts", async () => {
  const m = await setup({ kinds: { ...rules.kinds, knight: { ...rules.kinds.knight, attackMs: 300 } } });
  const a = unit(m);
  m.step([script("self.suspendOrder(); self.attack(self.nearestEnemy());"),
    { player: "a", order: { type: "move", unit: a.id, x: 0, y: 3 } }]);
  for (let i = 1; i < 12; i++) m.step([]);
  expect(unit(m).orderProgress).toEqual({ ageMs: 1200, suspendedMs: 1200, currentSuspensionMs: 1200, suspensions: 1,
    movement: { steps: 0, netTiles: 0, stationaryMs: 1200, towardDestination: 0 }, scriptActions: { attack: 4 }, blockedMs: 0 });
  expect(viewToText(m.view("a"))).toContain("suspended 1.2s now/1.2s total (1 pause)");
  expect(viewToText(m.view("a"))).toContain("script actions attack=4");
  m.step([script("self.continueOrder(); self.hold();")]);
  expect(unit(m)).toMatchObject({ x: 2, y: 3, actionResult: { source: "order", effect: "move" }, orderProgress: {
    ageMs: 1300, currentSuspensionMs: 0, suspendedMs: 1200, suspensions: 1,
    movement: { steps: 1, netTiles: 1, towardDestination: 1, stationaryMs: 0 }, scriptActions: { attack: 4 },
  } });
  m.step([script("self.suspendOrder(); self.hold();")]);
  expect(unit(m).orderProgress).toMatchObject({ currentSuspensionMs: 100, suspendedMs: 1300, suspensions: 2 });
});

it("distinguishes back-and-forth motion from progress toward a destination", async () => {
  const m = await setup({ kinds: { ...rules.kinds, knight: { ...rules.kinds.knight, moveMs: 100 } } });
  const a = unit(m);
  m.step([script("self.suspendOrder(); self.move(self.tick % 2 ? 'W' : 'E');"),
    { player: "a", order: { type: "move", unit: a.id, x: 0, y: 3 } }]);
  expect(unit(m).orderProgress?.movement.towardDestination).toBe(-1);
  for (let i = 1; i < 4; i++) m.step([]);
  expect(unit(m)).toMatchObject({ x: 3, y: 3, orderProgress: {
    movement: { steps: 4, netTiles: 0, towardDestination: 0, stationaryMs: 0 }, scriptActions: { move: 4 },
  } });
  expect(viewToText(m.view("a"))).toContain("moved 4 steps, net 0 tiles, toward destination +0");
});

it("counts blocked time but does not treat movement cooldown as blockage", async () => {
  const m = await setup({ kinds: { ...rules.kinds, knight: { ...rules.kinds.knight, moveMs: 500 } } });
  const a = unit(m), king = unit(m, "a", "king");
  m.step([{ player: "a", order: { type: "move", unit: a.id, x: 0, y: 3 } },
    script("self.suspendOrder(); self.move('W');", "king"),
    { player: "a", order: { type: "move", unit: king.id, x: 2, y: 0 } }]);
  for (let i = 1; i < 5; i++) m.step([]);
  expect(unit(m).orderProgress).toMatchObject({ ageMs: 500, blockedMs: 0,
    movement: { steps: 1, netTiles: 1, stationaryMs: 400 } });
  expect(unit(m, "a", "king").orderProgress).toMatchObject({ blockedMs: 500,
    movement: { steps: 0, stationaryMs: 500 }, scriptActions: {} });
});

it("resets on accepted orders, preserves history on rejection, and clears it on cancellation or arrival", async () => {
  const m = await setup(), a = unit(m);
  const move = { player: "a", order: { type: "move" as const, unit: a.id, x: 0, y: 3 } };
  m.step([script("self.suspendOrder(); self.hold();"), move]);
  m.step([]);
  expect(m.step([{ ...move, order: { ...move.order, x: -1 } }]).results[0].ok).toBe(false);
  expect(unit(m).orderProgress?.ageMs).toBe(300);
  m.step([move]); // Even an identical manual order is a fresh instruction.
  expect(unit(m).orderProgress).toMatchObject({ ageMs: 100, suspendedMs: 100, suspensions: 1 });
  m.step([script("self.cancelOrder(); self.hold();")]);
  expect(unit(m)).not.toHaveProperty("orderProgress");
  m.step([script("self.suspendOrder(); self.hold();"), move]);
  m.step([{ player: "a", order: { type: "stop", unit: a.id } }]);
  expect(unit(m)).not.toHaveProperty("orderProgress");
  m.step([script("self.continueOrder();"), { ...move, order: { ...move.order, x: a.x, y: a.y } }]);
  expect(unit(m)).not.toHaveProperty("orderProgress");
});

it("keeps history private from allies and enemies and returns detached, non-consuming observations", async () => {
  const m = await setup({}, 10, [{ id: "a", name: "A", team: 0 }, { id: "b", name: "B", team: 1 }, { id: "c", name: "C", side: 2, team: 0 }]);
  const a = unit(m);
  m.step([script("self.suspendOrder(); self.hold();"), { player: "a", order: { type: "move", unit: a.id, x: 0, y: 3 } }]);
  const before = structuredClone(unit(m).orderProgress), hash = m.hash();
  const progress = unit(m).orderProgress!;
  progress.suspendedMs = 9999; progress.movement.steps = 999; progress.scriptActions.attack = 999;
  expect(unit(m).orderProgress).toEqual(before);
  expect(m.view("a", 0).mine.find(e => e.id === a.id)?.orderProgress).toEqual(before);
  expect(m.view("b").enemy.find(e => e.id === a.id)).not.toHaveProperty("orderProgress");
  expect(m.view("c").allies.find(e => e.id === a.id)).not.toHaveProperty("orderProgress");
  const probe = m.testScript("a", "knight", "self.suspendOrder(); self.move('N'); self.log(typeof self.orderProgress);");
  expect(probe.ok && Object.values(probe.frames[0].runs)[0].log).toBe("undefined");
  expect(unit(m).orderProgress).toEqual(before);
  expect(m.hash()).toBe(hash);
});

it.each([10, 20])("reports suspension duration in real milliseconds at %i Hz", async tickRate => {
  const m = await setup({}, tickRate), a = unit(m);
  m.step([script("self.suspendOrder(); self.hold();"), { player: "a", order: { type: "move", unit: a.id, x: 0, y: 3 } }]);
  for (let i = 1; i < 10; i++) m.step([]);
  expect(unit(m).orderProgress).toMatchObject({ ageMs: 10_000 / tickRate, suspendedMs: 10_000 / tickRate,
    currentSuspensionMs: 10_000 / tickRate, movement: { stationaryMs: 10_000 / tickRate } });
});
