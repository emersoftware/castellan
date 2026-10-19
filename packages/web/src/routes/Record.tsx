/**
 * Headless video capture of a replay (used by scripts/record.mjs). No
 * controls: the recorder drives a virtual clock through `window.__record`.
 * `?clean` leaves only the map (overlays are added in the video edit). Shots for edits:
 * `camera=auto` pans after the biggest fight, `camera=x,y` holds a tile (`dy` pixels below the centre); `zoom=k` is the game's zoom
 * buttons pressed k times (×1.25 each, from the whole map); `pov=p1` shows one player's view under fog;
 * `from`/`to` (game ms) bound the shot, and `fadeIn`/`fadeOut` (units) or `worldIn`/`worldOut` (everything)
 * dissolve it through the dither's screen door while the camera glides over the empty map.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useParams } from "@tanstack/react-router";
import { currentRuleset, pages, readMoment, type GameEvent, type RecordedKind, type ReplayFile, type SpectatorView } from "@aoa/shared";
import { api, playerColors } from "../api";
import { EventFeed, OutcomeBanner, PlayerList } from "../components/Hud";
import { playerPerspective } from "../perspective";
import { GameRenderer } from "../render/renderer";
import type { WorkerIn, WorkerOut } from "../replay.worker";

declare global {
  interface Window {
    __record?: { ready: boolean; ticks: number; verified?: boolean; frame(gameMs: number): Promise<void>; sounds: RecordedSound[] };
  }
}

/** A sound the board played (game ms, the renderer's pan and volume), for the video's soundtrack. */
interface RecordedSound { ms: number; name: string; pan: number; volume: number }

const query = new URLSearchParams(location.search);
const num = (k: string, d = 0) => (query.has(k) ? Number(query.get(k)) : d);
const CLEAN = query.has("clean"), AUTO_CAMERA = query.get("camera") === "auto";
const FIXED_CAMERA = query.get("camera")?.match(/^([\d.]+),([\d.]+)/)?.slice(1).map(Number);
const ZOOM = 1.25 ** num("zoom"), POV = readMoment(query).player, DY = num("dy");
const FROM = num("from"), TO = num("to", Infinity), FADE_IN = num("fadeIn"), FADE_OUT = num("fadeOut"), WORLD_IN = num("worldIn"), WORLD_OUT = num("worldOut");

/** 0 … 1 over `ms` from `a` (1 when there is no fade). */
const ramp = (t: number, a: number, ms: number) => (ms > 0 ? Math.min(1, Math.max(0, (t - a) / ms)) : 1);
const ease = (t: number) => t * t * (3 - 2 * t);
/** With nobody fighting, the camera looks at the armies. */
const ARMY = new Set<RecordedKind>(["knight", "archer"]);

/**
 * Where the camera looks, per tick: the middle of the biggest group that hit or was hit in the last 1.5 s
 * (or the armies when nobody fights), smoothed forwards and backwards so it moves ahead of fights.
 */
function cameraTrack(frames: SpectatorView[], width: number, height: number) {
  const recent = new Map<string, number>();
  const target = frames.map((f, i) => {
    for (const e of f.events) if (e.type === "attack") { recent.set(e.from, i); if (e.to) recent.set(e.to, i); }
    const fighting = f.entities.filter((e) => (recent.get(e.id) ?? -99) >= i - 15);
    // With several fights at once (free-for-alls), follow the biggest: the fighters around the one with most neighbours.
    const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 10;
    const core = fighting.reduce<{ e?: (typeof fighting)[number]; n: number }>((best, e) => {
      const n = fighting.filter((o) => near(e, o)).length;
      return n > best.n ? { e, n } : best;
    }, { n: 0 }).e;
    const cluster = core ? fighting.filter((o) => near(core, o)) : [];
    const pool = cluster.length >= 2 ? cluster : f.entities.filter((e) => ARMY.has(e.kind));
    if (!pool.length) return { x: (width - 1) / 2, y: (height - 1) / 2 };
    const xs = pool.map((e) => e.x), ys = pool.map((e) => e.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  });
  // From a few seconds before a king falls, the camera goes to it and stays (where the game was decided).
  frames.forEach((f, i) => {
    const fall = f.events.find((e) => e.type === "death" && e.kind === "king");
    if (fall && fall.type === "death") for (let j = Math.max(0, i - 40); j < target.length; j++) target[j] = { x: fall.x, y: fall.y };
  });
  const smooth = (k: "x" | "y", a: number) => {
    const v = target.map((t) => t[k]);
    for (let i = 1; i < v.length; i++) v[i] = v[i - 1] + (v[i] - v[i - 1]) * a;
    for (let i = v.length - 2; i >= 0; i--) v[i] = v[i + 1] + (v[i] - v[i + 1]) * a;
    return v;
  };
  const [x, y] = [smooth("x", 0.04), smooth("y", 0.04)];
  return frames.map((_, i) => ({ x: x[i], y: y[i] }));
}

export function Record() {
  const { id } = useParams({ from: pages.record });
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
      renderer = await GameRenderer.create(host.current!, currentRuleset(replay.ruleset), playerColors(replay.players));
      const clock = renderer.manualClock();
      const tickMs = 1000 / replay.tickRate;
      let shown = -1;
      // A player's view follows only what that player sees.
      const track = AUTO_CAMERA ? cameraTrack(POV ? frames.map((f) => playerPerspective(f, POV)!) : frames, replay.ruleset.map.width, replay.ruleset.map.height) : null;
      // Sounds of the shot, as loud as its units are shown (none while they are dissolved).
      const sounds: RecordedSound[] = [];
      let soundMs = 0, shownUnits = 0;
      renderer.onSound((name, pan, volume) => { if (soundMs >= FROM) sounds.push({ ms: soundMs, name, pan, volume: volume * shownUnits }); });
      window.__record = {
        ready: true,
        ticks: frames.length,
        verified: e.data.verified,
        sounds,
        frame: async (gameMs) => {
          const i = Math.min(frames.length - 1, Math.floor(gameMs / tickMs));
          while (shown < i) {
            shown++;
            clock.setTime(shown * tickMs);
            soundMs = shown * tickMs;
            const f = POV ? playerPerspective(frames[shown], POV)! : frames[shown];
            renderer!.setFrame(f, tickMs);
            flushSync(() => {
              setView(f);
              if (f.events.length) setEvents((old) => [...old, ...f.events.filter((x) => x.type !== "attack")].slice(-60));
            });
          }
          clock.setTime(gameMs);
          // Units dissolve in and out at the ends of the shot (the whole world when the map changes), and the
          // camera glides from and to the middle of the map while they are gone.
          const end = Math.min(TO, (frames.length - 1) * tickMs);
          // The map comes in before the units and goes after them.
          const units = Math.min(ramp(gameMs, FROM + WORLD_IN, FADE_IN), ramp(end - WORLD_OUT, gameMs, FADE_OUT));
          const world = Math.min(ramp(gameMs, FROM, WORLD_IN), ramp(end, gameMs, WORLD_OUT));
          renderer!.dissolve(units, world, POV ? units : world);
          shownUnits = units;
          const mid = { x: (replay.ruleset.map.width - 1) / 2, y: (replay.ruleset.map.height - 1) / 2 };
          let look = mid;
          if (FIXED_CAMERA) look = { x: FIXED_CAMERA[0], y: FIXED_CAMERA[1] };
          else if (track) {
            // Between ticks, the camera moves on with the clock.
            const at = Math.min(track.length - 1, gameMs / tickMs), a = track[Math.floor(at)], b = track[Math.min(track.length - 1, Math.floor(at) + 1)], f = at % 1;
            look = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
          }
          const k = FADE_IN || FADE_OUT ? ease(units) : 1;
          renderer!.camera(mid.x + (look.x - mid.x) * k, mid.y + (look.y - mid.y) * k, ZOOM, DY);
          clock.draw();
        },
      };
    };
    w.postMessage({ replay } satisfies WorkerIn);
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
      {!CLEAN && <>
      {view && <PlayerList colors={colors} view={view} names={names} />}
      <EventFeed events={events} names={names} colors={colors} tickMs={replay ? 1000 / replay.tickRate : 100} />
      {view && last && <OutcomeBanner view={view} names={names} colors={colors} />}
      <div className="corner brandmark">Age of Agents</div>
      </>}
    </div>
  );
}
