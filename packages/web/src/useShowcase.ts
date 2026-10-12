import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SpectatorView } from "@aoa/shared";
import { parseShowcaseManifest, readShowcaseChunk } from "./showcaseRecording";

/** Decorative playback reads verified frames. It never executes player code. */
export function useShowcase(id: string) {
  const base = `/showcase/${encodeURIComponent(id)}/`;
  const manifest = useQuery({
    queryKey: ["showcase-recording", id],
    queryFn: async ({ signal }) => {
      const response = await fetch(`${base}manifest.json`, { signal });
      if (!response.ok) throw new Error("Couldn’t load this battle.");
      const recording = parseShowcaseManifest(await response.json());
      if (recording.id !== id) throw new Error("Unexpected showcase recording.");
      return recording;
    },
    staleTime: Infinity,
    retry: false,
  });
  const [frame, setFrame] = useState<SpectatorView | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [jumpKey, setJumpKey] = useState(0);
  const ready = useRef(false);
  const onReady = useCallback(() => {
    performance.mark?.("aoa-hero-ready");
    ready.current = true;
  }, []);

  useEffect(() => {
    const recording = manifest.data;
    if (!recording) return;
    const abort = new AbortController();
    const chunks = new Map<number, SpectatorView[]>();
    const pending = new Map<number, Promise<void>>();
    let failed = false;
    let chunkIndex = 0;
    let frameIndex = 0;
    let started = false;
    ready.current = false;
    setFrame(null);
    setStreamError(null);
    const motion = matchMedia("(prefers-reduced-motion: reduce)");

    const load = (index: number): Promise<void> => {
      if (chunks.has(index)) return Promise.resolve();
      const existing = pending.get(index);
      if (existing) return existing;
      const part = recording.chunks[index];
      const request = (async () => {
        try {
          const response = await fetch(`${base}${part.url}`, { signal: abort.signal });
          if (!response.ok) throw new Error("Couldn’t load this battle.");
          const frames = await readShowcaseChunk(response);
          if (frames.length !== part.lastTick - part.firstTick + 1
            || frames.some((value, i) => value.tick !== part.firstTick + i)) {
            throw new Error("Incomplete showcase recording.");
          }
          if (abort.signal.aborted) return;
          chunks.set(index, frames);
        } catch (error) {
          if (abort.signal.aborted) return;
          failed = true;
          setStreamError(error instanceof Error ? error.message : "Couldn’t load this battle.");
        } finally {
          pending.delete(index);
        }
      })();
      pending.set(index, request);
      return request;
    };

    void load(0).then(() => {
      if (abort.signal.aborted || failed) return;
      setFrame(chunks.get(0)![0]);
      started = true;
    });
    const timer = setInterval(() => {
      if (!started || !ready.current || failed || document.hidden || motion.matches) return;
      const nextChunk = (chunkIndex + 1) % recording.chunks.length;
      // Only the current and following chunk live in memory. Begin prefetch
      // after the first paint, so it cannot compete with the opening's art.
      void load(nextChunk);
      const current = chunks.get(chunkIndex)!;
      if (frameIndex + 1 < current.length) {
        frameIndex++;
      } else {
        // A slow connection holds the last frame instead of skipping ticks or
        // looping a partial match. Resume when the next chunk has arrived.
        if (!chunks.has(nextChunk)) return;
        chunkIndex = nextChunk;
        frameIndex = 0;
        if (chunkIndex === 0) setJumpKey(key => key + 1);
        const following = (chunkIndex + 1) % recording.chunks.length;
        for (const index of chunks.keys()) if (index !== chunkIndex && index !== following) chunks.delete(index);
      }
      setFrame(chunks.get(chunkIndex)![frameIndex]);
    }, 1000 / recording.tickRate);
    return () => { abort.abort(); clearInterval(timer); };
  }, [manifest.data, base, attempt]);

  const retry = async () => {
    ready.current = false;
    // A deployment may replace the manifest and remove its old hashed chunks.
    // Retrying a stale chunk URL forever cannot recover that situation.
    const result = await manifest.refetch();
    if (!result.isError) setAttempt(value => value + 1);
  };
  return { manifest: manifest.data, frame, error: manifest.isError || !!streamError, retry, onReady, attempt, jumpKey };
}
