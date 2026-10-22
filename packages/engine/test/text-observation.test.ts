import { afterEach, expect, it } from "vitest";
import { observedSeat, rules, viewToText } from "@castellan/shared";
import { createMatch, type Match } from "../src";

const matches: Match[] = [];
afterEach(() => matches.splice(0).forEach(m => m.dispose()));

// Keepers decide when to send a turn from the header that viewToText writes.
it("reads back its seat from every text observation it writes", async () => {
  const m = await createMatch({ ruleset: rules, seed: 1, tickRate: 10, players: [{ id: "a", name: "A" }, { id: "b", name: "B" }] });
  matches.push(m);
  m.step([]); m.step([]);
  for (const status of ["waiting", "prep", "running", "finished"] as const) for (const alive of [true, false]) {
    const view = { ...m.view("a"), status, players: m.view("a").players.map(p => p.id === "a" ? { ...p, alive } : p) };
    expect(observedSeat(viewToText(view))).toEqual({ status, tick: view.tick, alive });
  }
});

it("counts idle units of every kind that moves, but not the vital king", async () => {
  const ruleset = { ...rules, map: { ...rules.map, start: [...rules.map.start, { kind: "knight" as const, x: 6, y: 6 }, { kind: "archer" as const, x: 7, y: 6 }] } };
  const m = await createMatch({ ruleset, seed: 1, tickRate: 10, players: [{ id: "a", name: "A" }, { id: "b", name: "B" }] });
  matches.push(m);
  m.step([]);
  const idle = viewToText(m.view("a")).split("\n").find(line => line.startsWith("idle now"));
  expect(idle).toMatch(/^idle now \(hold, no order\): workers \d+\/\d+.* · knights 1\/1 \(e\d+\) · archers 1\/1 \(e\d+\)$/);
  expect(idle).not.toContain("king");
});
