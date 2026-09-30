import { afterEach, expect, it } from "vitest";
import { MAPS, v11, v12, playerGuide, viewToText, type Ruleset } from "@aoa/shared";
import { createMatch, type Match } from "../src";

const live: Match[] = [];
afterEach(() => { for (const m of live.splice(0)) m.dispose(); });
const idle = { worker: "self.hold();", king: "self.hold();", knight: "self.hold();", ranger: "self.hold();", turret: "self.hold();", castle: "self.hold();" };
const ffa = [0, 1, 2, 3].map((i) => ({ id: `p${i + 1}`, name: `p${i + 1}`, side: i, team: i }));
const start = async (ruleset: Ruleset, players: typeof ffa) => { const m = await createMatch({ ruleset, players, seed: 1, tickRate: 10 }); live.push(m); return m; };
const run = (m: Match) => { while (!m.outcome) m.step([]); return m.outcome!; };
const castle = (m: Match, p: string) => m.view(p).mine.find((e) => e.kind === "castle")!.id;

it("ends a free-for-all at the limit with the surviving player who has the highest score", async () => {
  const ruleset: Ruleset = { ...v12, matchMs: 3000, map: MAPS.quad, defaultScripts: { ...v12.defaultScripts, ...idle } };
  const m = await start(ruleset, ffa);
  expect(viewToText(m.view("p1"))).toContain("s left, then the surviving player with the highest score wins");
  m.forfeit("p1"); // out: it can no longer win at the limit
  // Training trades 50 capital for a 10-point unit, so p2 and p3 end below p4.
  m.step([{ player: "p2", order: { type: "train", building: castle(m, "p2"), kind: "worker" } }, { player: "p3", order: { type: "train", building: castle(m, "p3"), kind: "worker" } }]);
  const outcome = run(m);
  expect(outcome).toMatchObject({ reason: "timeout", winner: "p4", winners: ["p4"] });
  expect(outcome.scores.p4).toBeGreaterThan(Math.max(outcome.scores.p2, outcome.scores.p3));
});

it("draws a free-for-all tied at the top, and keeps the draw rule for duels", async () => {
  const tied = await start({ ...v12, matchMs: 2000, map: MAPS.quad, defaultScripts: { ...v12.defaultScripts, ...idle } }, ffa);
  expect(run(tied)).toMatchObject({ reason: "timeout", winner: null, winners: [] });
  const duel = await start({ ...v12, matchMs: 2000, defaultScripts: { ...v12.defaultScripts, ...idle } }, ffa.slice(0, 2).map((p, i) => ({ ...p, side: i })));
  expect(run(duel)).toMatchObject({ reason: "timeout", winners: [] });
  expect(viewToText(duel.view("p1"))).not.toContain("surviving player");
});

it("makes rangers and mobility cheaper and explains the free-for-all rule", () => {
  expect(v12.kinds.ranger.cost).toBe(100);
  expect(v11.kinds.ranger.cost).toBe(120);
  expect(v12.upgrades!.knight_mobility.levels[0].cost).toBe(150);
  expect(v12.upgrades!.ranger_mobility.levels[0].cost).toBe(150);
  const ffaGuide = playerGuide({ ...v12, map: MAPS.quad }, { teams: false });
  expect(ffaGuide).toContain("the SURVIVING player with the highest score wins; eliminated players cannot win");
  expect(playerGuide(v12)).toContain("ends in a DRAW");
});
