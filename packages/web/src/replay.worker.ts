/// <reference lib="webworker" />
/**
 * Re-simulates a replay off the main thread with the real engine and sandbox,
 * streaming frames back in batches and checking the recorded state hashes.
 */
import { playRecordedReplay } from "./replayPlayback";
import type { ReplayFile, SpectatorView } from "@aoa/shared";
import type { ReplayOptions } from "@aoa/engine";

export type WorkerIn = { replay: ReplayFile; options?: ReplayOptions };

export type WorkerOut =
  | { type: "frames"; frames: SpectatorView[] }
  | { type: "done"; verified: boolean; desyncAt?: number }
  | { type: "error"; message: string };

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const { replay, options } = e.data;
  let batch: SpectatorView[] = [];
  const flush = () => {
    if (batch.length) (self as unknown as Worker).postMessage({ type: "frames", frames: batch } satisfies WorkerOut);
    batch = [];
  };
  let activityIndex = 0;
  let sentFirstCasualty = false;
  const activity = replay.experiment?.agentActivity ?? [];
  const currentActivity = new Map();
  try {
    const check = await playRecordedReplay(replay, (v) => {
      while (activityIndex < activity.length && activity[activityIndex].tick <= v.tick) {
        const entry = activity[activityIndex++]; currentActivity.set(entry.player, entry.activity);
      }
      for (const p of v.players) if (currentActivity.has(p.id)) {
        p.agentActivity = currentActivity.get(p.id);
        const own = v.perspectives?.[p.id]?.players.find(q => q.id === p.id);
        if (own) own.agentActivity = currentActivity.get(p.id);
      }
      batch.push(v);
      // The viewer can start on frame zero. The landing needs the first death
      // to choose its opening; neither should wait for a full transport batch.
      const firstCasualty = !sentFirstCasualty && v.events.some(event => event.type === "death");
      if (firstCasualty) sentFirstCasualty = true;
      if (v.tick === 0 || firstCasualty || batch.length >= 200) flush();
    }, options);
    flush();
    (self as unknown as Worker).postMessage({ type: "done", ...check } satisfies WorkerOut);
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: "error", message: String((err as Error).message ?? err) } satisfies WorkerOut);
  }
};
