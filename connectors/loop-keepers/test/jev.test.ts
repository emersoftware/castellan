import { expect, it } from "vitest";
// @ts-expect-error Plain Node launcher.
import { candidates, jevClient, parsePlan, summary } from "../jev/agent.mjs";

const row = () => "·".repeat(12);
const view = {
  you: "p1", tick: 900, timeMs: 90_000, matchMs: 600_000, status: "running",
  players: [{ id: "p1", mineral: 400, pop: 9, popCap: 30, alive: true, upgrades: {} }, { id: "p2", alive: true }],
  grid: Array.from({ length: 12 }, row), visibility: Array.from({ length: 12 }, () => "2".repeat(12)),
  mine: [
    { id: "e1", kind: "castle", x: 4, y: 4, hp: 600, maxHp: 600, training: [{ kind: "worker" }] },
    { id: "e3", kind: "king", x: 2, y: 2, hp: 400, maxHp: 400, vital: true },
    ...Array.from({ length: 7 }, (_, i) => ({ id: `w${i}`, kind: "worker", x: 6, y: i, hp: 40, maxHp: 40, doing: i ? "→ 10,2" : "hold" })),
    { id: "e11", kind: "knight", x: 5, y: 6, hp: 110, maxHp: 110 },
  ],
  enemy: [{ id: "e20", kind: "knight", owner: "p2", x: 9, y: 9, hp: 80, maxHp: 110 }],
  deposits: [{ id: "d1", x: 10, y: 2, amount: 150 }], lastSeen: [], events: [], underAttack: [], scripts: {},
  availableActions: {
    train: ["worker", "knight"].map(kind => ({ building: "e1", kind, cost: kind === "worker" ? 50 : 100, queue: 1, queueLimit: 5, blockedBy: [] })),
    build: [{ kind: "tower", cost: 150, blockedBy: [] }], research: [],
  },
  chat: { enabled: true, messages: [] },
};

it("offers only actions that send a new order and still move toward the plan's targets", () => {
  const plan = parsePlan(JSON.stringify({ objective: "army", targets: { worker: 8, knight: 3 }, waypoint: { x: 8, y: 8 }, notes: "" }));
  const keys = candidates(view, plan).map((o: { key: string }) => o.key);
  // 7 workers alive + 1 queued meet the worker target; knights do not.
  expect(keys).not.toContain("train:e1:worker");
  expect(keys).toEqual(expect.arrayContaining(["train:e1:knight", "attack:e20", "waypoint", "gather:d1"]));
  expect(keys.some((k: string) => k.startsWith("build:"))).toBe(false);
  // A rejected action rests until its time is up.
  expect(candidates(view, plan, new Map([["attack:e20", Date.now() + 10_000]])).map((o: { key: string }) => o.key)).not.toContain("attack:e20");
  expect(summary(view, plan, []).plan.stillNeeded).toEqual({ knight: 2 });
});

it("asks Jev one Choice over the options and returns the chosen one", async () => {
  const bodies: { questions: Record<string, { criteria: Record<string, string> }> }[] = [];
  const fetchImpl = async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ answers: { action: { choice: "a1", confidence: 0.8, probabilities: {} } }, usage: { cost: 0.0001 } }));
  };
  const choose = jevClient({ key: "k", model: "typesafe/jev-1.14", fetchImpl });
  const pick = await choose({ you: "p1" }, [{ key: "x", description: "first", orders: [] }, { key: "y", description: "second", orders: [] }]);
  expect(bodies).toHaveLength(1);
  expect(Object.keys(bodies[0].questions)).toEqual(["action"]);
  expect(bodies[0].questions.action.criteria).toEqual({ a0: "first", a1: "second" });
  expect(pick.selected.key).toBe("y");
});
