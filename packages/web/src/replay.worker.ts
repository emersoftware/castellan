/// <reference lib="webworker" />
/**
 * Re-simulates a replay off the main thread with the real engine and sandbox,
 * streaming frames back in batches, under today's names, and checking the recorded state hashes.
 */
import { acceptedScripts, type ScriptLoad } from "./scripts";
import { currentFrame, type ReplayFile, type SpectatorView } from "@castellan/shared";
import { playRecording, recordingWithShutdowns, type ReplayOptions } from "@castellan/engine";

export type WorkerIn = { replay: ReplayFile; options?: ReplayOptions };

export type WorkerOut =
  /** `scripts`: uploads the engine installed during these frames. */
  | { type: "frames"; frames: SpectatorView[]; scripts: ScriptLoad[] }
  | { type: "done"; verified: boolean; desyncAt?: number }
  | { type: "error"; message: string };

/** This worker's port back to the page (the DOM lib types `self` as a window). */
const page = self as unknown as { postMessage(message: WorkerOut): void };

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const { replay, options } = e.data;
  let batch: SpectatorView[] = [], scripts: ScriptLoad[] = [];
  const flush = () => {
    if (batch.length) page.postMessage({ type: "frames", frames: batch, scripts });
    batch = []; scripts = [];
  };
  let activityIndex = 0;
  let sentFirstCasualty = false;
  const activity = replay.experiment?.agentActivity ?? [];
  const currentActivity = new Map();
  try {
    // Viewers reproduce recorded VM shutdowns; the strict runReplay refuses them for balance.
    const check = await playRecording(recordingWithShutdowns(replay), (v) => {
      while (activityIndex < activity.length && activity[activityIndex].tick <= v.tick) {
        const entry = activity[activityIndex++]; currentActivity.set(entry.player, entry.activity);
      }
      for (const p of v.players) if (currentActivity.has(p.id)) {
        p.agentActivity = currentActivity.get(p.id);
        const own = v.perspectives?.[p.id]?.players.find(q => q.id === p.id);
        if (own) own.agentActivity = currentActivity.get(p.id);
      }
      batch.push(currentFrame(v));
      // The viewer can start on frame zero. The landing needs the first death
      // to choose its opening; neither should wait for a full transport batch.
      const firstCasualty = !sentFirstCasualty && v.events.some(event => event.type === "death");
      if (firstCasualty) sentFirstCasualty = true;
      // Each batch is decoded and compacted on the main thread at once; small ones fit between animation frames.
      if (v.tick === 0 || firstCasualty || batch.length >= 25) flush();
    }, options, (tick) => scripts.push(...acceptedScripts(tick)));
    flush();
    page.postMessage({ type: "done", ...check });
  } catch (err) {
    page.postMessage({ type: "error", message: String((err as Error).message ?? err) });
  }
};
