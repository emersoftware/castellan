import { expect, it } from "vitest";
import { rules, MAPS, playerGuide, playerResult, outcomeText, viewToText, type Ruleset, type Outcome } from "@aoa/shared";
import { createMatch, runReplay } from "../src";

it.each(["duel", "ffa", "teams"])("everyone loses at the limit despite unequal scores in %s", async (mode) => {
  const players = Array.from({ length: mode === "duel" ? 2 : 4 }, (_, i) => ({ id: `p${i+1}`, name: String(i), side: i,
    team: mode === "teams" ? Math.floor(i/2) : i }));
  const map = mode === "duel" ? rules.map : MAPS.quad;
  const ruleset: Ruleset = { ...rules, matchMs: 100, fourSeatMatchMs: 100, map: { ...map, deposits: [], sharedDeposits: [] } };
  const m = await createMatch({ ruleset, players, seed: 1, tickRate: 10 });
  try {
    expect(m.view("p1").drawsAreLosses).toBe(true);
    expect(viewToText(m.view("p1"))).toContain("0.1s left ·");
    const nexus = m.view("p1").mine.find((e) => e.kind === "castle")!;
    m.step([{ player: "p1", order: { type: "train", building: nexus.id, kind: "worker" } }]);
    expect(m.outcome).toMatchObject({ reason: "timeout", winner: null, winners: [], allDefeated: true });
    expect(m.spectate().players.every(p => p.alive)).toBe(true); // survival and victory are distinct
    for (const p of players) {
      expect(playerResult(m.outcome!, p.id)).toBe("loss");
      expect(viewToText(m.view(p.id))).toContain("OUTCOME result=loss winner=none · all defeated reason=timeout");
    }
    expect(m.outcome!.scores.p1).toBeLessThan(m.outcome!.scores.p2);
    expect(playerGuide(ruleset, { teams: mode === "teams" })).toContain("Score is informational only");
    expect(playerGuide(ruleset, { teams: mode === "teams" })).not.toContain("score wins");
    expect(playerGuide(ruleset, { teams: mode === "teams" })).toContain("If the match ends without a winning side, every player loses.");
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
    expect(m.outcome).not.toHaveProperty("allDefeated");
    expect(playerResult(m.outcome!, "p1")).toBe("win");
    expect(playerResult(m.outcome!, "p2")).toBe("loss");
  } finally { m.dispose(); }
});

it.each([true, false, undefined])("replays the recorded no-draw policy (%s), independent of today's default", async (drawsAreLosses) => {
  const ruleset: Ruleset = { ...rules, matchMs: 200 };
  if (drawsAreLosses === undefined) delete ruleset.drawsAreLosses;
  else ruleset.drawsAreLosses = drawsAreLosses;
  const players = [{ id: "p1", name: "one" }, { id: "p2", name: "two" }];
  const m = await createMatch({ ruleset, players, seed: 1, tickRate: 10 });
  try {
    expect(viewToText(m.view("p1"))).toContain("0.2s left ·");
    const hashes: Record<number, string> = {};
    while (!m.outcome) { const t = m.tick; m.step([]); hashes[t] = m.hash(); }
    hashes[m.tick] = m.hash();
    const expected: Outcome = { winner: null, winners: [], reason: "timeout", scores: m.outcome.scores,
      ...(drawsAreLosses ? { allDefeated: true as const } : {}) };
    expect(m.outcome).toEqual(expected);
    expect(playerResult(m.outcome, "p1")).toBe(drawsAreLosses ? "loss" : "draw");
    expect(outcomeText(m.outcome)).toBe(drawsAreLosses ? "all defeated" : "draw");
    expect(playerGuide(ruleset)).toContain(drawsAreLosses ? "If the match ends without a winning side, every player loses." : "If more than one side survives at the time limit, the match is a draw.");
    let final: Outcome | undefined;
    const check = await runReplay(JSON.parse(JSON.stringify({ format: 1, id: "policy", createdAt: "", ruleset,
      seed: 1, tickRate: 10, players, orders: [], hashes, finalTick: m.tick, outcome: m.outcome })), v => { final = v.outcome; });
    expect(check.verified).toBe(true);
    expect(final).toEqual(expected);
  } finally { m.dispose(); }
});

it.each([true, undefined])("handles mutual elimination using the recorded no-draw policy (%s)", async (drawsAreLosses) => {
  const ruleset: Ruleset = { ...rules, drawsAreLosses, matchMs: 5000,
    defaultScripts: {}, kinds: { ...rules.kinds, worker: { ...rules.kinds.worker, atk: 1000 } },
    map: { ...rules.map, deposits: [], sharedDeposits: [], start: [{ kind: "king", x: 15, y: 15 }, { kind: "worker", x: 15, y: 16 }] } };
  const m = await createMatch({ ruleset, players: [{ id: "p1", name: "one" }, { id: "p2", name: "two" }], seed: 1, tickRate: 10 });
  try {
    m.step(["p1", "p2"].map(player => ({ player, order: { type: "attack" as const,
      unit: m.view(player).mine.find(e => e.kind === "worker")!.id,
      target: m.view(player === "p1" ? "p2" : "p1").mine.find(e => e.kind === "king")!.id } })));
    expect(m.outcome).toMatchObject({ reason: "vital_lost", winner: null, winners: [] });
    expect(m.outcome?.allDefeated).toBe(drawsAreLosses);
    expect(playerResult(m.outcome!, "p1")).toBe(drawsAreLosses ? "loss" : "draw");
  } finally { m.dispose(); }
});

it("interprets team victories and historical score victories without treating null as a draw", () => {
  const team: Outcome = { winner: null, winners: ["p1", "p3"], reason: "vital_lost", scores: {} };
  expect(playerResult(team, "p1")).toBe("win");
  expect(playerResult(team, "p3")).toBe("win");
  expect(playerResult(team, "p2")).toBe("loss");
  expect(outcomeText(team)).toBe("winner p1+p3");
  const legacy: Outcome = { winner: "p2", reason: "timeout", scores: { p2: 100 } };
  expect(playerResult(legacy, "p2")).toBe("win");
  expect(playerResult(legacy, "p1")).toBe("loss");
});
