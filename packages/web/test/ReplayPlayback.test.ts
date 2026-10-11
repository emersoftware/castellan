import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { runReplay } from "@aoa/engine";
import type { ReplayFile, SpectatorView } from "@aoa/shared";
import { playRecordedReplay } from "../src/replayPlayback";

// Actual four-model FFA: player VMs stopped at ticks 5167 and 5692.
const recording = (): ReplayFile => JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/9cf148fb.json.gz", import.meta.url))).toString());

it("recovers the recorded match, including both shutdowns, while strict evaluation still rejects it", async () => {
  const replay = recording();
  const before = JSON.stringify(replay);
  let last: SpectatorView | undefined;
  let frames = 0;
  expect(Object.keys(replay.hashes)).toHaveLength(73);
  await expect(runReplay(replay, () => {})).rejects.toThrow("operational failure");
  const check = await playRecordedReplay(replay, view => { last = view; frames++; });
  expect(check).toEqual({ verified: true, desyncAt: undefined });
  expect(frames).toBe(replay.finalTick + 1);
  expect(last?.tick).toBe(7187);
  expect(last?.outcome).toEqual(replay.outcome);
  expect(last?.outcome?.winner).toBe("p2");
  expect(JSON.stringify(replay)).toBe(before);
});

it("rejects interruptions whose effect is not recorded precisely enough", async () => {
  const replay = recording();
  replay.experiment!.operationalFailures![0].message = "sandbox worker failed";
  await expect(playRecordedReplay(replay, () => {})).rejects.toThrow("cannot be reconstructed safely");
});

it("does not guess whether a simultaneous upload or unit script triggered the shutdown", async () => {
  const replay = recording();
  const failure = replay.experiment!.operationalFailures![0];
  replay.orders.push({ tick: failure.tick, player: failure.player, order: { type: "script", kind: "king", code: "self.hold();" } });
  await expect(playRecordedReplay(replay, () => {})).rejects.toThrow("cannot be reconstructed safely");
});
