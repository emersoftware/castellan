import { afterEach, expect, it } from "vitest";
import { rules, playerGuide, type Ruleset } from "@aoa/shared";
import { createMatch, type Match } from "../src";

const live: Match[] = [];
afterEach(() => { for (const m of live.splice(0)) m.dispose(); });
const ruleset: Ruleset = { ...rules, startMineral: 2000, matchMs: 120_000,
  kinds: Object.fromEntries(Object.entries(rules.kinds).map(([k, s]) => [k, { ...s, requires: undefined }])),
  defaultScripts: { ...rules.defaultScripts, archer: "self.hold();", tower: "self.hold();", castle: "self.hold();", worker: "self.hold();" },
  map: { ...rules.map, width: 24, height: 24, walls: [], deposits: [], sharedDeposits: [], start: [
    { kind: "castle", x: 1, y: 1 }, { kind: "king", x: 0, y: 0 }, { kind: "archer", x: 8, y: 8 }, { kind: "tower", x: 4, y: 8 },
  ] } };

it("extends archer range one tile and tower range two, always keeping towers ahead", async () => {
  const m = await createMatch({ ruleset, players: [{ id: "p1", name: "a" }, { id: "p2", name: "b" }], seed: 1, tickRate: 10 });
  live.push(m);
  const mine = (kind: string) => m.view("p1").mine.find((e) => e.kind === kind)!;
  const archer = mine("archer");
  const sees = (dx: number) => m.view("p1").visibility![archer.y][archer.x + dx] === "2";
  expect(mine("archer").stats?.range).toBe(5);
  expect(sees(7)).toBe(true);
  expect(sees(8)).toBe(false);
  const buy = (upgrade: string) => m.step([{ player: "p1", order: { type: "upgrade", upgrade } }]).results[0];
  expect(buy("archer_range")).toMatchObject({ ok: true, mineral: { spent: rules.upgrades.archer_range.levels[0].cost } });
  for (let i = 0; i < 151; i++) m.step([]);
  expect(mine("archer").stats?.range).toBe(6);
  expect(sees(8)).toBe(true);
  expect(buy("archer_range")).toMatchObject({ ok: false, reason: "archer_range is already at maximum level" });
  expect(mine("tower").stats?.range).toBe(7);
  expect(buy("tower_range")).toMatchObject({ ok: true, mineral: { spent: rules.upgrades.tower_range.levels[0].cost } });
  for (let i = 0; i < 151; i++) m.step([]);
  expect(mine("tower").stats?.range).toBe(8);
  expect(m.view("p2").mine.find((e) => e.kind === "tower")!.stats?.range).toBe(7); // only the buyer's
  expect(buy("tower_range")).toMatchObject({ ok: true, mineral: { spent: rules.upgrades.tower_range.levels[1].cost } });
  for (let i = 0; i < 201; i++) m.step([]);
  expect(mine("tower").stats?.range).toBe(9);
  expect(playerGuide(ruleset)).toContain(`- archer_range: archer range; L1: range 6, vision 8, cost ${rules.upgrades.archer_range.levels[0].cost}, research 15s\n`);
  expect(playerGuide(ruleset)).toContain(`- tower_range: tower range; L1: range 8, vision 9, cost ${rules.upgrades.tower_range.levels[0].cost}, research 15s; L2: range 9, vision 10, cost ${rules.upgrades.tower_range.levels[1].cost}, research 20s`);
});
