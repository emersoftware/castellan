import type { SpectatorView } from "@castellan/shared";

/**
 * A replay keeps every frame, and a long 4-player match outgrows what a phone
 * allows a tab. Most entities, deposits and fog rows are unchanged from one tick
 * to the next, and a player's units look the same in that player's perspective
 * as in the overview: an equal value reuses the object already kept. Frames are
 * read-only once received, so sharing is safe.
 */
export function frameCompactor(): (frame: SpectatorView) => SpectatorView {
  // Per id, the latest distinct views: the overview's, an opponent's (no orders), a remembered one.
  const views = new Map<string, object[]>();
  const rows = new Map<string, string>();
  const stats = new Map<string, NonNullable<SpectatorView["entities"][number]["stats"]>>();
  const share = <T extends { id: string; stats?: SpectatorView["entities"][number]["stats"] }>(v: T): T => {
    const kept = views.get(v.id);
    const found = kept?.find((k) => same(k, v));
    if (found) return found as T;
    // A moving unit is new every few ticks; its stats rarely are.
    if (v.stats) {
      const key = Object.values(v.stats).join();
      const s = stats.get(key);
      if (s && same(s, v.stats)) v.stats = s;
      else stats.set(key, v.stats);
    }
    if (kept) { kept.unshift(v); kept.length = Math.min(kept.length, 4); }
    else views.set(v.id, [v]);
    return v;
  };
  const row = (r: string) => {
    const kept = rows.get(r);
    if (kept !== undefined) return kept;
    rows.set(r, r);
    return r;
  };
  return (frame) => {
    frame.entities = frame.entities.map(share);
    frame.deposits = frame.deposits.map(share);
    if (frame.visibility) frame.visibility = frame.visibility.map(row);
    for (const p of Object.values(frame.perspectives ?? {})) {
      p.entities = p.entities.map(share);
      p.deposits = p.deposits.map(share);
      p.visibility = p.visibility.map(row);
    }
    return frame;
  };
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => k in b && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
