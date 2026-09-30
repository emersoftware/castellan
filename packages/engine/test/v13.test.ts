import { afterEach, expect, it } from "vitest";
import { MAPS, matchLengthMs, v11, v12, v13, playerGuide, viewToText, type Ruleset } from "@aoa/shared";
import { createMatch, type Match } from "../src";

const live: Match[] = [];
afterEach(() => { for (const m of live.splice(0)) m.dispose(); });
const idle = { worker: "self.hold();", king: "self.hold();", knight: "self.hold();", ranger: "self.hold();", turret: "self.hold();", castle: "self.hold();" };
const ffa = [0, 1, 2, 3].map((i) => ({ id: `p${i + 1}`, name: `p${i + 1}`, side: i, team: i }));
const start = async (ruleset: Ruleset, players: typeof ffa) => { const m = await createMatch({ ruleset, players, seed: 1, tickRate: 10 }); live.push(m); return m; };

it("draws a free-for-all at the limit however much capital a survivor holds", async () => {
  const m = await start({ ...v13, fourSeatMatchMs: 2000, map: MAPS.quad, defaultScripts: { ...v13.defaultScripts, ...idle } }, ffa);
  expect(viewToText(m.view("p1"))).toContain("s left, then draw");
  const castle = m.view("p2").mine.find((e) => e.kind === "castle")!.id;
  m.step([{ player: "p2", order: { type: "train", building: castle, kind: "worker" } }]); // scores now differ
  while (!m.outcome) m.step([]);
  expect(m.outcome).toMatchObject({ reason: "timeout", winner: null, winners: [] });
  expect(new Set(Object.values(m.outcome!.scores)).size).toBeGreaterThan(1);
});

it("plays 15 minutes on four-seat maps and 10 on the rest", async () => {
  expect(matchLengthMs(v13)).toBe(600_000);
  expect(matchLengthMs({ ...v13, map: MAPS.quad })).toBe(900_000);
  expect(matchLengthMs({ ...v13, map: MAPS["fortress-quad"] })).toBe(900_000);
  expect(matchLengthMs({ ...v12, map: MAPS.quad })).toBe(600_000);
  const teams = await start({ ...v13, map: MAPS.quad }, ffa.map((p, i) => ({ ...p, team: i % 2 })));
  expect(teams.view("p1").matchMs).toBe(900_000);
  expect(teams.spectate().matchMs).toBe(900_000);
  expect(viewToText(teams.view("p1"))).toContain("0.0s/900.0s");
  expect(playerGuide({ ...v13, map: MAPS.quad }, { teams: false })).toContain("After 15 minutes, if multiple opposing sides survive, the game ends in a DRAW");
  expect(playerGuide(v13)).toContain("After 10 minutes");
});

it("prices rangers and mobility halfway between v11 and v12", () => {
  expect([v11, v13, v12].map((r) => r.kinds.ranger.cost)).toEqual([120, 110, 100]);
  for (const id of ["knight_mobility", "ranger_mobility"]) {
    expect([v11, v13, v12].map((r) => r.upgrades![id].levels.map((l) => l.cost))).toEqual([[250], [200], [150]]);
  }
  expect(v13.ffaTimeoutOutcome).toBeUndefined();
  expect(v13.upgrades!.ranger_range).toEqual(v11.upgrades!.ranger_range);
});

it("fits four corners on 44x44 with nothing overlapping", async () => {
  for (const name of ["quad", "fortress-quad"]) {
    const map = MAPS[name];
    expect([map.width, map.height]).toEqual([44, 44]);
    const m = await start({ ...v13, map }, ffa);
    const frame = m.spectate();
    const placed = [...frame.entities, ...frame.deposits];
    expect(placed.every((e) => e.x >= 0 && e.y >= 0 && e.x < 44 && e.y < 44)).toBe(true);
    expect(new Set(placed.map((e) => `${e.x},${e.y}`)).size).toBe(placed.length);
    expect(frame.deposits).toHaveLength(map.deposits.length * 4 + map.sharedDeposits.length);
    expect(frame.deposits.filter((d) => d.amount === 800).map((d) => `${d.x},${d.y}`).sort()).toEqual(["21,21", "21,22", "22,21", "22,22"]);
  }
});
