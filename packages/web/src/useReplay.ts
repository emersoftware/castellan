import { useEffect, useRef, useState } from "react";
import type { ReplayFile, SpectatorView } from "@aoa/shared";
import type { WorkerIn, WorkerOut } from "./replay.worker";
import type { ReplayOptions } from "@aoa/engine";

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
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === "frames") {
        frames.current.push(...m.frames);
        setLoaded(frames.current.length);
      } else if (m.type === "done") setCheck({ verified: m.verified, desyncAt: m.desyncAt });
      else setError(m.message);
    };
    w.onerror = () => setError("Couldn’t prepare this replay.");
    w.postMessage({ replay, options: { includePerspectives } } satisfies WorkerIn);
    return () => w.terminate();
  }, [replay, attempt, includePerspectives]);
  return { frames, loaded, check, error };
}
