import { expect, it, vi } from "vitest";
import { rules } from "@castellan/shared";
import { Room } from "../src/room";

it("restores queued production, reserved population and explored terrain without a second charge", async () => {
  // Archers trained without their unlock research: this test is about restoring production.
  const room = await Room.create({ ruleset: { ...rules, kinds: Object.fromEntries(Object.entries(rules.kinds).map(([k, s]) => [k, { ...s, requires: undefined }])), startMineral: 1000, map: { ...rules.map, deposits: [], sharedDeposits: [] } },
    players: [{ name: "one" }, { name: "two" }], seed: 42, tickRate: 10, sides: "fixed", prepMs: 0, botLatencyMs: 3000,
    chat: true, onFinish: () => {} });
  let restored: Room | undefined;
  vi.useFakeTimers();
  try {
    room.touch("p1"); room.touch("p2"); await vi.advanceTimersByTimeAsync(1);
    const initial = room.view("p1");
    const pending = room.act("p1", [
      { type: "train", building: initial.mine.find((e) => e.kind === "castle")!.id, kind: "worker" },
      { type: "train", building: initial.mine.find((e) => e.kind === "castle")!.id, kind: "archer" },
      { type: "move", unit: initial.mine.find((e) => e.kind === "king")!.id, x: 15, y: 15 },
    ]);
    await vi.advanceTimersByTimeAsync(2100); expect((await pending).results.every((r) => r.ok)).toBe(true);
    room.suspend();
    room.experiment.configure("p1", { model: "fixture", effort: "low", connector: "test", connectorVersion: "1", promptSha256: null, memoryPolicy: "isolated", contextPolicy: null });
    const before = room.view("p1", 0), saved = room.checkpoint();
    expect(before.players[0]).toMatchObject({ mineral: 1000 - 50 - rules.kinds.archer.cost, queuedPop: 2 });
    restored = await Room.restore(saved, () => {});
    expect(restored.spectatorToken).toBe(room.spectatorToken);
    expect(restored.checkpoint().experiment).toEqual(saved.experiment);
    const after = restored.view("p1", 0);
    expect(after.mine).toEqual(before.mine); expect(after.visibility).toEqual(before.visibility);
    expect(after.events).toEqual(before.events); expect(restored.checkpoint().hash).toBe(saved.hash);
    restored.touch("p1"); restored.touch("p2");
    await vi.advanceTimersByTimeAsync(3500);
    const completed = restored.view("p1");
    expect(completed.mine.filter((e) => e.kind === "worker")).toHaveLength(4);
    expect(completed.players[0]).toMatchObject({ mineral: 1000 - 50 - rules.kinds.archer.cost, queuedPop: 1 });
  } finally { room.close(); restored?.close(); vi.useRealTimers(); }
});
