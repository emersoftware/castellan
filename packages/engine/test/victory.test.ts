import { expect, it } from "vitest";
import { rules, MAPS, playerGuide, type Ruleset } from "@aoa/shared";
import { createMatch } from "../src";

it.each(["duel", "ffa", "teams"])("draws at the limit despite unequal scores in %s", async (mode) => {
  const players = Array.from({ length: mode === "duel" ? 2 : 4 }, (_, i) => ({ id: `p${i+1}`, name: String(i), side: i,
    team: mode === "teams" ? Math.floor(i/2) : i }));
  const map = mode === "duel" ? rules.map : MAPS.quad;
  const ruleset: Ruleset = { ...rules, matchMs: 100, fourSeatMatchMs: 100, map: { ...map, deposits: [], sharedDeposits: [] } };
  const m = await createMatch({ ruleset, players, seed: 1, tickRate: 10 });
  try {
    const nexus = m.view("p1").mine.find((e) => e.kind === "castle")!;
    m.step([{ player: "p1", order: { type: "train", building: nexus.id, kind: "worker" } }]);
    expect(m.outcome).toMatchObject({ reason: "timeout", winner: null, winners: [] });
    expect(m.outcome!.scores.p1).toBeLessThan(m.outcome!.scores.p2);
    expect(playerGuide(ruleset, { teams: mode === "teams" })).toContain("Score is informational only");
    expect(playerGuide(ruleset, { teams: mode === "teams" })).not.toContain("score wins");
  } finally { m.dispose(); }
});

it("still awards victory for killing the King on the last tick", async () => {
  // Each worker starts next to the other side's King (p2's layout is p1's rotated 180°).
  const ruleset: Ruleset = { ...rules, matchMs: 100,
    kinds: { ...rules.kinds, worker: { ...rules.kinds.worker, atk: 1000 } },
    map: { ...rules.map, deposits: [], sharedDeposits: [], start: [{ kind: "king", x: 15, y: 15 }, { kind: "worker", x: 15, y: 16 }] } };
  const m = await createMatch({ ruleset, players: [{ id: "p1", name: "one" }, { id: "p2", name: "two" }], seed: 1, tickRate: 10 });
  try {
    const worker = m.view("p1").mine.find((e) => e.kind === "worker")!;
    const agent = m.view("p2").mine.find((e) => e.kind === "king")!;
    m.step([{ player: "p1", order: { type: "attack", unit: worker.id, target: agent.id } }]);
    expect(m.outcome).toMatchObject({ reason: "vital_lost", winner: "p1", winners: ["p1"] });
  } finally { m.dispose(); }
});
