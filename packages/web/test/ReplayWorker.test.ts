import { afterEach, expect, it, vi } from "vitest";
import type { ReplayFile, SpectatorView } from "@aoa/shared";
import type { WorkerIn, WorkerOut } from "../src/replay.worker";

vi.mock("../src/replayPlayback", () => ({ playRecordedReplay: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it("delivers the opening and first casualty before simulation continues, then preserves every frame", async () => {
  const messages: WorkerOut[] = [];
  const deliveredAtBoundary: number[] = [];
  const worker = { onmessage: null as null | ((event: MessageEvent<WorkerIn>) => Promise<void>), postMessage: (message: WorkerOut) => messages.push(structuredClone(message)) };
  vi.stubGlobal("self", worker);
  const { playRecordedReplay } = await import("../src/replayPlayback");
  const replay = { experiment: { agentActivity: [] } } as unknown as ReplayFile;
  const options = { includePerspectives: false };
  vi.mocked(playRecordedReplay).mockImplementation(async (_, emit) => {
    for (let tick = 0; tick < 405; tick++) {
      emit({ tick, players: [], entities: [], events: tick === 73 || tick === 74 ? [{ type: "death" }] : [] } as unknown as SpectatorView);
      // Observe delivery while the simulation is still inside its producer callback.
      if (tick === 0 || tick === 73) {
        const last = messages.at(-1);
        deliveredAtBoundary.push(last?.type === "frames" ? last.frames.at(-1)!.tick : -1);
      }
    }
    return { verified: true };
  });
  await import("../src/replay.worker");
  await worker.onmessage!({ data: { replay, options } } as MessageEvent<WorkerIn>);
  expect(deliveredAtBoundary).toEqual([0, 73]);
  expect(vi.mocked(playRecordedReplay).mock.calls[0][2]).toEqual(options);
  const batches = messages.flatMap(m => m.type === "frames" ? [m.frames] : []);
  expect(batches.flat().map(f => f.tick)).toEqual(Array.from({ length: 405 }, (_, i) => i));
  expect(batches.every(batch => batch.length <= 200)).toBe(true);
  expect(messages.at(-1)).toEqual({ type: "done", verified: true });
});
