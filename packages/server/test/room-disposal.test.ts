import { afterEach, expect, it, vi } from "vitest";
import { rules } from "@castellan/shared";
import { Room, type RoomOptions } from "../src/room";
import * as isolation from "../src/script-isolation";

const rooms: Room[] = [];
afterEach(() => {
  for (const room of rooms.splice(0)) room.close();
  vi.restoreAllMocks();
});

it("releases finished and restored sandboxes while retaining the final views and replay", async () => {
  const createHost = isolation.createIsolatedScriptHost;
  const disposals: ReturnType<typeof vi.fn>[] = [];
  vi.spyOn(isolation, "createIsolatedScriptHost").mockImplementation((...args) => {
    const host = createHost(...args);
    const dispose = vi.fn(() => host.dispose());
    disposals.push(dispose);
    return { ...host, dispose };
  });
  const finished = vi.fn();
  const options: RoomOptions = {
    ruleset: { ...rules, matchMs: 200 }, players: [{ name: "A" }, { name: "B" }],
    tickRate: 20, seed: 42, sides: "fixed", prepMs: 0,
    botLatencyMs: 3000, chat: true, onFinish: finished,
  };
  for (let i = 0; i < 3; i++) {
    const room = await Room.create(options);
    rooms.push(room);
    room.touch("p1"); room.touch("p2");
    await vi.waitFor(() => expect(room.state).toBe("finished"), { timeout: 5000, interval: 20 });
    expect(disposals).toHaveLength((i + 1) * 2);
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
    expect(room.view("p1").status).toBe("finished");
    expect(room.scripts("p1")).toBeDefined();
    expect(room.summary().outcome).toEqual(room.replay()!.outcome);
  }
  expect(finished).toHaveBeenCalledTimes(3);
  const original = rooms.at(-1)!;
  const restored = await Room.restore(original.checkpoint(), vi.fn());
  rooms.push(restored);
  expect(restored.state).toBe("finished");
  expect(restored.replay()!.hashes).toEqual(original.replay()!.hashes);
  expect(disposals).toHaveLength(8);
  for (const room of rooms) { room.close(); room.close(); }
  for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
});
