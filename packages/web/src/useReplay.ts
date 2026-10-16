import { useEffect, useRef, useState } from "react";
import type { ReplayFile, SpectatorView } from "@aoa/shared";
import type { WorkerIn, WorkerOut } from "./replay.worker";
import type { ReplayOptions } from "@aoa/engine";
import { frameCompactor } from "./compactFrames";

/**
 * Re-simulates a replay in a worker. `frames` fills progressively; `check`
 * arrives at the end (did the browser reproduce the recorded state hashes?).
 */
export function useReplayFrames(replay: ReplayFile | undefined | null, attempt = 0, { includePerspectives = true }: ReplayOptions = {}) {
  const frames = useRef<SpectatorView[]>([]);
  const [loaded, setLoaded] = useState(0);
  const [check, setCheck] = useState<{ verified: boolean; desyncAt?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!replay) return;
    frames.current = [];
    setLoaded(0);
    setCheck(null);
    setError(null);
    const w = new Worker(new URL("./replay.worker.ts", import.meta.url), { type: "module" });
    const compact = frameCompactor();
    // Every `loaded` change re-renders the page, so it follows the frames at most four times a second.
    let pending: ReturnType<typeof setTimeout> | undefined;
    const publish = () => { clearTimeout(pending); pending = undefined; setLoaded(frames.current.length); };
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === "frames") {
        const first = !frames.current.length;
        frames.current.push(...m.frames.map(compact));
        if (first) publish();
        else pending ??= setTimeout(publish, 250);
      } else if (m.type === "done") {
        publish();
        setCheck({ verified: m.verified, desyncAt: m.desyncAt });
      } else setError(m.message);
    };
    w.onerror = () => setError("Couldn’t prepare this replay.");
    w.postMessage({ replay, options: { includePerspectives } } satisfies WorkerIn);
    return () => { clearTimeout(pending); w.terminate(); };
  }, [replay, attempt, includePerspectives]);
  return { frames, loaded, check, error };
}
