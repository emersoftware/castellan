import { useMemo, useRef } from "react";
import type { GameEvent, SpectatorView } from "@castellan/shared";
import { playerPerspective } from "./perspective";
import { notableEvents } from "./components/Hud";

/** Notable events of every frame for one perspective, built once as frames stream in. */
export function useEventIndex(frames: { current: SpectatorView[] }, loaded: number, player: string | null) {
  const cache = useRef(new Map<string, { upTo: number; events: GameEvent[] }>());
  return useMemo(() => {
    const key = player ?? "";
    let c = cache.current.get(key);
    if (!c || c.upTo > frames.current.length) cache.current.set(key, (c = { upTo: 0, events: [] }));
    for (; c.upTo < frames.current.length; c.upTo++) {
      const events = playerPerspective(frames.current[c.upTo], player)?.events ?? [];
      if (events.length) c.events.push(...notableEvents(events).filter((e) => e.type !== "chat"));
    }
    return c.events.slice();
  }, [frames, loaded, player]);
}

/** Events up to `tick` (the list is in tick order). */
export function upTo<T extends { tick: number }>(list: T[], tick: number): T[] {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].tick <= tick) lo = mid + 1; else hi = mid;
  }
  return list.slice(0, lo);
}
