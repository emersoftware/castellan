import { expect, it } from "vitest";
import { LEGACY_MAPS as MAPS, playerGuide, v3, v4, type Ruleset } from "@aoa/shared";
import { createMatch } from "../src";

it.each(["duel", "ffa", "teams"])("draws at the limit despite unequal scores in %s", async (mode) => {
  const players = Array.from({ length: mode === "duel" ? 2 : 4 }, (_, i) => ({ id: `p${i+1}`, name: String(i), side: i,
    team: mode === "teams" ? Math.floor(i/2) : i }));
  const map = mode === "duel" ? v4.map : MAPS.quad;
  const ruleset: Ruleset = { ...v4, matchMs: 100, map: { ...map, deposits: [], sharedDeposits: [] } };
  const m = await createMatch({ ruleset, players, seed: 1, tickRate: 10 });
  try {
    const nexus = m.view("p1").mine.find((e) => e.kind === "nexus")!;
    m.step([{ player: "p1", order: { type: "train", building: nexus.id, kind: "worker" } }]);
    expect(m.outcome).toMatchObject({ reason: "timeout", winner: null, winners: [] });
    expect(m.outcome!.scores.p1).toBeLessThan(m.outcome!.scores.p2);
    expect(playerGuide(ruleset, { teams: mode === "teams" })).toContain("Score is informational only");
    expect(playerGuide(ruleset, { teams: mode === "teams" })).not.toContain("score wins");
  } finally { m.dispose(); }
});

it("still awards victory for killing the Agent on the last tick", async () => {
  const ruleset: Ruleset = { ...v4, matchMs: 100, fogOfWar: undefined,
    kinds: { ...v4.kinds, worker: { ...v4.kinds.worker, atk: 1000, range: 32 } } };
  const m = await createMatch({ ruleset, players: [{ id: "p1", name: "one" }, { id: "p2", name: "two" }], seed: 1, tickRate: 10 });
  try {
    const worker = m.view("p1").mine.find((e) => e.kind === "worker")!;
    const agent = m.view("p2").mine.find((e) => e.kind === "agent")!;
    m.step([{ player: "p1", order: { type: "attack", unit: worker.id, target: agent.id } }]);
    expect(m.outcome).toMatchObject({ reason: "vital_lost", winner: "p1", winners: ["p1"] });
  } finally { m.dispose(); }
});

it("preserves the old ruleset's score victory", async () => {
  const m = await createMatch({ ruleset: { ...v3, matchMs: 100 }, players: [{ id: "p1", name: "one" }, { id: "p2", name: "two" }], seed: 1, tickRate: 10 });
  try {
    const nexus = m.view("p1").mine.find((e) => e.kind === "nexus")!;
    m.step([{ player: "p1", order: { type: "train", building: nexus.id, kind: "worker" } }]);
    expect(m.outcome).toMatchObject({ reason: "timeout", winner: "p2" });
  } finally { m.dispose(); }
});
