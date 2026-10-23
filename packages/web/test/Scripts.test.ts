import { expect, it } from "vitest";
import { createMatch, playRecording, recordingOf } from "@castellan/engine";
import { rules, type ReplayFile } from "@castellan/shared";
import { acceptedScripts, scriptAt, type ScriptLoad } from "../src/scripts";

it("finds the script a unit runs at a given moment of a replay", () => {
  const loads: ScriptLoad[] = [
    { tick: 10, player: "p1", kind: "knight", code: "self.hold(); // v1" },
    { tick: 20, player: "p2", kind: "knight", code: "self.hold(); // rival" },
    { tick: 30, player: "p1", kind: "knight", code: null },
  ];
  expect(scriptAt(loads, rules, "p1", "knight", 5)).toEqual({ code: rules.defaultScripts.knight, custom: false });
  expect(scriptAt(loads, rules, "p1", "knight", 10)).toEqual({ code: "self.hold(); // v1", custom: true, sinceTick: 10 });
  expect(scriptAt(loads, rules, "p1", "knight", 29)?.code).toBe("self.hold(); // v1");
  expect(scriptAt(loads, rules, "p1", "knight", 30)).toEqual({ code: rules.defaultScripts.knight, custom: false }); // reset to default
  expect(scriptAt(loads, rules, "p2", "knight", 25)?.code).toBe("self.hold(); // rival");
  expect(scriptAt(loads, rules, "p1", "wall", 25)).toBeNull();
});


/** A real recording: orders applied by the engine, so its results decide what each player runs. */
async function record(orders: ReplayFile["orders"], finalTick: number): Promise<ReplayFile> {
  const players = [{ id: "p1", name: "a", side: 0, team: 0 }, { id: "p2", name: "b", side: 1, team: 1 }];
  const match = await createMatch({ ruleset: rules, seed: 1, tickRate: 10, players });
  try {
    while (match.tick < finalTick) match.step(orders.filter(o => o.tick === match.tick).map(({ player, order }) => ({ player, order })));
    return { format: 1, id: "rejected-upload", createdAt: new Date(0).toISOString(), ruleset: rules, seed: 1, tickRate: 10, players, orders,
      hashes: { [match.tick]: match.hash() }, finalTick: match.tick, outcome: { winner: null, reason: "timeout", scores: {} } };
  } finally { match.dispose(); }
}

it("shows the script the engine accepted, not a later upload it rejected", async () => {
  const replay = await record([
    { tick: 1, player: "p1", order: { type: "script", kind: "knight", code: "self.hold(); // v1" } },
    { tick: 3, player: "p1", order: { type: "script", kind: "knight", code: "self.hold( // does not compile" } },
  ], 6);
  const loads: ScriptLoad[] = [];
  const check = await playRecording(recordingOf(replay), () => {}, { includePerspectives: false }, (tick) => loads.push(...acceptedScripts(tick)));
  expect(check.verified).toBe(true);
  expect(scriptAt(loads, rules, "p1", "knight", 5)).toEqual({ code: "self.hold(); // v1", custom: true, sinceTick: 1 });
});
