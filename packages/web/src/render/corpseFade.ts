/** The same linear fade used by dead units and collapsed structures. */
export function corpseFade(elapsedMs: number, startMs: number, durationMs: number) {
  const progress = Math.min(1, Math.max(0, elapsedMs - startMs) / durationMs);
  return { alpha: 1 - progress };
}
