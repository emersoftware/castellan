/// <reference lib="webworker" />
/**
 * Re-simulates a replay off the main thread with the real engine and sandbox,
 * streaming frames back in batches and checking the recorded state hashes.
 */
import { playRecordedReplay } from "./replayPlayback";
import type { ReplayFile, SpectatorView } from "@aoa/shared";

export type WorkerOut =
  | { type: "frames"; frames: SpectatorView[] }
  | { type: "done"; verified: boolean; desyncAt?: number }
  | { type: "error"; message: string };

self.onmessage = async (e: MessageEvent<ReplayFile>) => {
  let batch: SpectatorView[] = [];
  const flush = () => {
    if (batch.length) (self as unknown as Worker).postMessage({ type: "frames", frames: batch } satisfies WorkerOut);
    batch = [];
  };
  let activityIndex = 0;
  const activity = e.data.experiment?.agentActivity ?? [];
  const currentActivity = new Map();
  try {
    const check = await playRecordedReplay(e.data, (v) => {
      while (activityIndex < activity.length && activity[activityIndex].tick <= v.tick) {
        const entry = activity[activityIndex++]; currentActivity.set(entry.player, entry.activity);
      }
      for (const p of v.players) if (currentActivity.has(p.id)) {
        p.agentActivity = currentActivity.get(p.id);
        const own = v.perspectives?.[p.id]?.players.find(q => q.id === p.id);
        if (own) own.agentActivity = currentActivity.get(p.id);
      }
      batch.push(v);
      if (batch.length >= 200) flush();
    });
    flush();
    (self as unknown as Worker).postMessage({ type: "done", ...check } satisfies WorkerOut);
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: "error", message: String((err as Error).message ?? err) } satisfies WorkerOut);
  }
};
