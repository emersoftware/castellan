import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { playRecording, recordingWithShutdowns, runReplay } from "@castellan/engine";
import type { ReplayFile, SpectatorView } from "@castellan/shared";

// Actual four-model FFA: player VMs stopped at ticks 5167 and 5692.
const recording = (): ReplayFile => JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/9cf148fb.json.gz", import.meta.url))).toString());

// This fixture simulates 7,187 ticks with all spectator perspectives. Keep the
// full regression; shared CI CPUs can exceed the suite's 60-second default.
it("recovers the recorded match, including both shutdowns, while strict evaluation still rejects it", async () => {
  const replay = recording();
  // A one-shot failure by the same player must not count as another VM shutdown.
  replay.experiment!.operationalFailures!.push({
    tick: 0, player: replay.experiment!.operationalFailures![0].player,
    message: "sandbox watchdog timeout after 250ms; request terminated",
  });
  const before = JSON.stringify(replay);
  let last: SpectatorView | undefined;
  let frames = 0;
  expect(Object.keys(replay.hashes)).toHaveLength(73);
  await expect(runReplay(replay, () => {})).rejects.toThrow("operational failure");
  const check = await playRecording(recordingWithShutdowns(replay), view => { last = view; frames++; });
  expect(check).toEqual({ verified: true, desyncAt: undefined });
  expect(frames).toBe(replay.finalTick + 1);
  expect(last?.tick).toBe(7187);
  expect(last?.outcome).toEqual(replay.outcome);
  expect(last?.outcome?.winner).toBe("p2");
  expect(JSON.stringify(replay)).toBe(before);
}, 180_000);

// MiniMax vs DeepSeek: a /run timeout in prep did not change the match.
const requestTimeoutRecording = (): ReplayFile => JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/f7387e23.json.gz", import.meta.url))).toString());

it("plays a request-only timeout recording without disabling unit scripts or changing the replay", async () => {
  const replay = requestTimeoutRecording();
  const before = JSON.stringify(replay);
  let last: SpectatorView | undefined;
  let frames = 0;
  await expect(runReplay(replay, () => {})).rejects.toThrow("operational failure");
  const check = await playRecording(recordingWithShutdowns(replay), view => { last = view; frames++; }, { includePerspectives: false });
  expect(check).toEqual({ verified: true, desyncAt: undefined });
  expect(frames).toBe(replay.finalTick + 1);
  expect(last?.tick).toBe(4529);
  expect(last?.outcome).toEqual(replay.outcome);
  expect(JSON.stringify(replay)).toBe(before);
}, 120_000);

it.each([
  { tick: -1 },
  { tick: 4530 },
  { player: "unknown-player" },
  { message: "sandbox worker startup timed out" },
])("does not silently drop an unrecognized or invalid request failure: %j", async change => {
  const replay = requestTimeoutRecording();
  Object.assign(replay.experiment!.operationalFailures![0], change);
  expect(() => recordingWithShutdowns(replay)).toThrow("cannot be reconstructed safely");
});

it("rejects interruptions whose effect is not recorded precisely enough", async () => {
  const replay = recording();
  replay.experiment!.operationalFailures![0].message = "sandbox worker failed";
  expect(() => recordingWithShutdowns(replay)).toThrow("cannot be reconstructed safely");
});

it("does not guess whether a simultaneous upload or unit script triggered the shutdown", async () => {
  const replay = recording();
  const failure = replay.experiment!.operationalFailures![0];
  replay.orders.push({ tick: failure.tick, player: failure.player, order: { type: "script", kind: "king", code: "self.hold();" } });
  expect(() => recordingWithShutdowns(replay)).toThrow("cannot be reconstructed safely");
});
