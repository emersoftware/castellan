/**
 * Headless video capture of a replay (used by scripts/record.mjs). No
 * controls: the recorder drives a virtual clock through `window.__record`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useParams } from "@tanstack/react-router";
import type { GameEvent, ReplayFile, SpectatorView } from "@aoa/shared";
import { api, playerColors } from "../api";
import { EventFeed, OutcomeBanner, PlayerList } from "../components/Hud";
import { GameRenderer } from "../render/renderer";
import type { WorkerOut } from "../replay.worker";

declare global {
  interface Window {
    __record?: { ready: boolean; ticks: number; verified?: boolean; frame(gameMs: number): Promise<void> };
  }
}

export function Record() {
  const { id } = useParams({ from: "/record/$id" });
  const host = useRef<HTMLDivElement>(null);
  const [replay, setReplay] = useState<ReplayFile | null>(null);
  const [view, setView] = useState<SpectatorView | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);

  useEffect(() => {
    api.replay(id).then(setReplay);
  }, [id]);

  useEffect(() => {
    if (!replay || !host.current) return;
    const frames: SpectatorView[] = [];
    let renderer: GameRenderer | null = null;
    const w = new Worker(new URL("../replay.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = async (e: MessageEvent<WorkerOut>) => {
      if (e.data.type === "frames") frames.push(...e.data.frames);
      if (e.data.type !== "done") return;
      renderer = await GameRenderer.create(host.current!, replay.ruleset, playerColors(replay.players));
      const clock = renderer.manualClock();
      const tickMs = 1000 / replay.tickRate;
      let shown = -1;
      window.__record = {
        ready: true,
        ticks: frames.length,
        verified: e.data.verified,
        frame: async (gameMs) => {
          const i = Math.min(frames.length - 1, Math.floor(gameMs / tickMs));
          while (shown < i) {
            shown++;
            clock.setTime(shown * tickMs);
            renderer!.setFrame(frames[shown], tickMs);
            const f = frames[shown];
            flushSync(() => {
              setView(f);
              if (f.events.length) setEvents((old) => [...old, ...f.events.filter((x) => x.type !== "attack")].slice(-60));
            });
          }
          clock.setTime(gameMs);
          clock.draw();
        },
      };
    };
    w.postMessage(replay);
    return () => {
      w.terminate();
      renderer?.destroy();
    };
  }, [replay]);

  const names = useMemo(() => Object.fromEntries((replay?.players ?? []).map((p) => [p.id, p.name])), [replay]);
  const colors = useMemo(() => playerColors(replay?.players ?? []), [replay]);
  const last = !!replay && !!view && view.tick >= replay.finalTick;

  return (
    <div className="game">
      <div className="canvas-host" ref={host} />
      {view && <PlayerList colors={colors} view={view} names={names} />}
      <EventFeed events={events} names={names} colors={colors} tickMs={replay ? 1000 / replay.tickRate : 100} />
      {view && last && <OutcomeBanner view={view} names={names} colors={colors} />}
      <div className="corner brandmark">Age of Agents</div>
    </div>
  );
}
