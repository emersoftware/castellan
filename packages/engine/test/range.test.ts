import { afterEach, expect, it } from "vitest";
import { v11, playerGuide, type Ruleset } from "@aoa/shared";
import { createMatch, type Match } from "../src";

const live: Match[] = [];
afterEach(() => { for (const m of live.splice(0)) m.dispose(); });
const ruleset: Ruleset = { ...v11, startCapital: 2000, matchMs: 120_000,
  defaultScripts: { ...v11.defaultScripts, ranger: "self.hold();", turret: "self.hold();", castle: "self.hold();", worker: "self.hold();" },
  map: { ...v11.map, width: 24, height: 24, walls: [], deposits: [], sharedDeposits: [], start: [
    { kind: "castle", x: 1, y: 1 }, { kind: "king", x: 0, y: 0 }, { kind: "ranger", x: 8, y: 8 }, { kind: "turret", x: 4, y: 8 },
  ] } };

it("extends ranger and turret range together with the vision to use it", async () => {
  const m = await createMatch({ ruleset, players: [{ id: "p1", name: "a" }, { id: "p2", name: "b" }], seed: 1, tickRate: 10 });
  live.push(m);
  const mine = (kind: string) => m.view("p1").mine.find((e) => e.kind === kind)!;
  const ranger = mine("ranger");
  const sees = (dx: number) => m.view("p1").visibility![ranger.y][ranger.x + dx] === "2";
  expect(mine("ranger").stats?.range).toBe(4);
  expect(sees(6)).toBe(true);
  expect(sees(7)).toBe(false);
  const buy = (upgrade: string) => m.step([{ player: "p1", order: { type: "upgrade", upgrade } }]).results[0];
  expect(buy("ranger_range")).toMatchObject({ ok: true, capital: { spent: 200 } });
  for (let i = 0; i < 151; i++) m.step([]);
  expect(mine("ranger").stats?.range).toBe(5);
  expect(sees(7)).toBe(true);
  expect(buy("turret_range")).toMatchObject({ ok: true, capital: { spent: 200 } });
  for (let i = 0; i < 151; i++) m.step([]);
  expect(mine("turret").stats?.range).toBe(6);
  expect(m.view("p2").mine.find((e) => e.kind === "turret")!.stats?.range).toBe(5); // only the buyer's
  expect(buy("ranger_range")).toMatchObject({ ok: true, capital: { spent: 300 } });
  for (let i = 0; i < 201; i++) m.step([]);
  expect(mine("ranger").stats?.range).toBe(6);
  expect(sees(8)).toBe(true);
  expect(playerGuide(ruleset)).toContain("- ranger_range: ranger range; L1: range 5, vision 7, cost 200, research 15s; L2: range 6, vision 8, cost 300, research 20s");
});
