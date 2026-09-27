/// <reference lib="webworker" />
/**
 * Re-simulates a replay off the main thread with the real engine and sandbox,
 * streaming frames back in batches and checking the recorded state hashes.
 */
import { runReplay } from "@aoa/engine";
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
  try {
    const check = await runReplay(e.data, (v) => {
      batch.push(v);
      if (batch.length >= 200) flush();
    });
    flush();
    (self as unknown as Worker).postMessage({ type: "done", ...check } satisfies WorkerOut);
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: "error", message: String((err as Error).message ?? err) } satisfies WorkerOut);
  }
};
