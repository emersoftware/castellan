import { expect, it } from "vitest";
import { rules, type ReplayFile } from "@aoa/shared";
import { scriptAt } from "../src/scripts";

it("finds the script a unit runs at a given moment of a replay", () => {
  const replay = { orders: [
    { tick: 10, player: "p1", order: { type: "script", kind: "knight", code: "self.hold(); // v1" } },
    { tick: 20, player: "p2", order: { type: "script", kind: "knight", code: "self.hold(); // rival" } },
    { tick: 30, player: "p1", order: { type: "script", kind: "knight", code: null } },
  ] } as unknown as ReplayFile;
  expect(scriptAt(replay.orders, rules, "p1", "knight", 5)).toEqual({ code: rules.defaultScripts.knight, custom: false });
  expect(scriptAt(replay.orders, rules, "p1", "knight", 10)).toEqual({ code: "self.hold(); // v1", custom: true, sinceTick: 10 });
  expect(scriptAt(replay.orders, rules, "p1", "knight", 29)?.code).toBe("self.hold(); // v1");
  expect(scriptAt(replay.orders, rules, "p1", "knight", 30)).toEqual({ code: rules.defaultScripts.knight, custom: false }); // reset to default
  expect(scriptAt(replay.orders, rules, "p2", "knight", 25)?.code).toBe("self.hold(); // rival");
  expect(scriptAt(replay.orders, rules, "p1", "wall", 25)).toBeNull();
});

it("reads a script order recorded under a former kind name", () => {
  const orders = [{ tick: 10, player: "p1", order: { type: "script", kind: "ranger", code: "self.hold(); // old" } }] as unknown as ReplayFile["orders"];
  expect(scriptAt(orders, rules, "p1", "archer", 20)?.code).toBe("self.hold(); // old");
});
