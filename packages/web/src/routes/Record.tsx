/**
 * Headless video capture of a replay (used by scripts/record.mjs). No
 * controls: the recorder drives a virtual clock through `window.__record`.
 * `?clean` leaves only the map (overlays are added in the video edit). Shots for edits:
 * `camera=auto` pans after the biggest fight, `camera=x,y` holds a tile (`dy` pixels below the centre); `zoom=k` is the game's zoom
 * buttons pressed k times (×1.25 each, from the whole map); `pov=p1` shows one player's view under fog;
 * `from`/`to` (game ms) bound the shot, and `fadeIn`/`fadeOut` (units) or `worldIn`/`worldOut` (everything)
 * dissolve it through the dither's screen door while the camera glides over the empty map.
 * `ui` records the replay viewer instead: the side panel and the timeline (no other controls), a camera that
 * follows each battle under the fog of its bigger army, and every script upload opened as if a unit of its kind
 * were clicked, held a few seconds of video at the recorder's `speed`.
 * `og` draws the replay's link preview: its biggest battle, with the title and the players by team (not the winner).
 */
import { Fragment, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { useParams } from "@tanstack/react-router";
import { pages, readMoment, teamsOf, type GameEvent, type EntityKind, type EntityView, type ReplayFile, type Ruleset, type SpectatorView } from "@castellan/shared";
import { api, fmtTime, playerColors } from "../api";
import { Agents } from "../components/Agent";
import { EventFeed, OutcomeBanner, PerspectiveBadge, PlayerList, SidePanel, UnitPanel } from "../components/Hud";
import { Timeline, marksOf } from "../components/Timeline";
import { upTo, useEventIndex } from "../replayEvents";
import { scriptAt, type ScriptLoad } from "../scripts";
import { biggestBattle, planScriptReveals, planVideoShots, storyStart, withReveals, type ScriptReveal, type VideoShot } from "../videoDirector";
import { playerPerspective } from "../perspective";
import { GameRenderer } from "../render/renderer";
import { useReplayFrames } from "../useReplay";

/** What the recorder drives: a ready virtual clock, or why the shot cannot be recorded. */
type RecordClock =
  | { ready: true; ticks: number; tickMs: number; verified: boolean; frame(gameMs: number): Promise<void>; sounds: RecordedSound[];
      /** With `ui`: game ms where the camera first leaves the whole map (the first march or fight). */
      storyMs?: number;
      /** With `og`: game ms of the picture (the biggest battle, else the middle of the match). */
      stillMs?: number }
  | { ready: false; error: string };

declare global {
  interface Window {
    __record?: RecordClock;
  }
}

/** A sound the board played (game ms, the renderer's pan and volume), for the video's soundtrack. */
interface RecordedSound { ms: number; name: string; pan: number; volume: number }

const query = new URLSearchParams(location.search);
const num = (k: string, d = 0) => (query.has(k) ? Number(query.get(k)) : d);
const CLEAN = query.has("clean"), AUTO_CAMERA = query.get("camera") === "auto";
const FIXED_CAMERA = query.get("camera")?.match(/^([\d.]+),([\d.]+)/)?.slice(1).map(Number);
const ZOOM = 1.25 ** num("zoom"), POV = readMoment(query).player, DY = num("dy");
const UI = query.has("ui"), OG = query.has("og"), SPEED = num("speed", 2);
const FROM = num("from"), TO = num("to", Infinity), FADE_IN = num("fadeIn"), FADE_OUT = num("fadeOut"), WORLD_IN = num("worldIn"), WORLD_OUT = num("worldOut");

/** 0 … 1 over `ms` from `a` (1 when there is no fade). */
const ramp = (t: number, a: number, ms: number) => (ms > 0 ? Math.min(1, Math.max(0, (t - a) / ms)) : 1);
const ease = (t: number) => t * t * (3 - 2 * t);
/** With nobody fighting, the camera looks at the armies. */
const ARMY = new Set<EntityKind>(["knight", "archer", "wizard"]);

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
  const [failure, setFailure] = useState<string | null>(null);
  const [view, setView] = useState<SpectatorView | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const { frames, scripts, ruleset, check, error } = useReplayFrames(replay);
  // The viewer recording: the tick on screen, its shot and the unit opened in the panel.
  const [index, setIndex] = useState(0);
  const [shot, setShot] = useState<VideoShot>({ box: null, pov: null });
  const [revealed, setRevealed] = useState<string | null>(null);

  useEffect(() => {
    api.replay(id).then(setReplay, (e: unknown) => setFailure(`replay ${id} could not be loaded: ${String((e as Error)?.message ?? e)}`));
  }, [id]);

  // The recorder waits for a ready clock or for the reason there is none.
  useEffect(() => {
    const reason = failure ?? error;
    if (reason) window.__record = { ready: false, error: reason };
  }, [failure, error]);

  useEffect(() => {
    if (!replay || !check || !host.current) return;
    const shot = frames.current;
    let renderer: GameRenderer | null = null, cancelled = false;
    GameRenderer.create(host.current, replay.ruleset, playerColors(replay.players)).then((created) => {
      if (cancelled) { created.destroy(); return; }
      renderer = created;
      const clock = renderer.manualClock();
      const tickMs = 1000 / replay.tickRate;
      let shown = -1;
      // A player's view follows only what that player sees.
      const battles = UI ? planVideoShots(shot, replay.tickRate, (kind) => ARMY.has(kind as EntityKind), (kind) => !!replay.ruleset.kinds[kind]?.building) : null;
      // The story starts with the first march or fight; opened scripts come on top of it.
      const story = battles && storyStart(battles);
      const reveals: ScriptReveal[] = battles ? planScriptReveals(scripts.current, shot, battles, Math.round(4 * SPEED * replay.tickRate), 30 * replay.tickRate) : [];
      const still = OG ? biggestBattle(shot, replay.tickRate) : null;
      const shots = battles ? withReveals(battles, reveals, shot) : OG ? shot.map(() => ({ box: still?.box ?? null, pov: null })) : null;
      // Battles are framed in the map's free area, left of the side panel and above the timeline.
      const stage = host.current?.closest(".stage")?.getBoundingClientRect(), canvas = host.current?.getBoundingClientRect();
      if (shots && stage && canvas) created.camera.setFocusArea({ x: Math.round(stage.left - canvas.left), y: Math.round(stage.top - canvas.top), w: Math.round(stage.width), h: Math.round(stage.height) });
      const track = AUTO_CAMERA ? cameraTrack(POV ? shot.map((f) => playerPerspective(f, POV)!) : shot, replay.ruleset.map.width, replay.ruleset.map.height) : null;
      // Sounds of the shot, as loud as its units are shown (none while they are dissolved).
      const sounds: RecordedSound[] = [];
      let soundMs = 0, shownUnits = 0;
      renderer.onSound((name, pan, volume) => { if (soundMs >= FROM) sounds.push({ ms: soundMs, name, pan, volume: volume * shownUnits }); });
      window.__record = {
        ready: true,
        ticks: shot.length,
        tickMs,
        verified: check.verified,
        ...(story !== null && story !== undefined ? { storyMs: story * tickMs } : {}),
        ...(OG ? { stillMs: (still?.tick ?? Math.floor(shot.length / 2)) * tickMs } : {}),
        sounds,
        frame: async (gameMs) => {
          const i = Math.min(shot.length - 1, Math.floor(gameMs / tickMs));
          while (shown < i) {
            shown++;
            clock.setTime(shown * tickMs);
            soundMs = shown * tickMs;
            const pov = shots ? shots[shown].pov : POV, switched = shots && shown > 0 && shots[shown - 1].pov !== pov;
            const f = pov ? playerPerspective(shot[shown], pov)! : shot[shown];
            // Another army's fog: its view appears at once, without animating from the last one.
            if (switched) created.seek(f, tickMs); else created.setFrame(f, tickMs);
            if (shots) {
              created.select(unit(reveals, shown));
              created.camera.focus(shots[shown].box);
            }
            flushSync(() => {
              if (shots) { setIndex(shown); setShot(shots[shown]); setRevealed(unit(reveals, shown)); }
              setView(f);
              if (f.events.length) setEvents((old) => [...old, ...f.events.filter((x) => x.type !== "attack")].slice(-60));
            });
          }
          clock.setTime(gameMs);
          // Units dissolve in and out at the ends of the shot (the whole world when the map changes), and the
          // camera glides from and to the middle of the map while they are gone.
          const end = Math.min(TO, (shot.length - 1) * tickMs);
          // The map comes in before the units and goes after them.
          const units = Math.min(ramp(gameMs, FROM + WORLD_IN, FADE_IN), ramp(end - WORLD_OUT, gameMs, FADE_OUT));
          const world = Math.min(ramp(gameMs, FROM, WORLD_IN), ramp(end, gameMs, WORLD_OUT));
          created.scene.dissolve(units, world, POV ? units : world);
          shownUnits = units;
          const mid = { x: (replay.ruleset.map.width - 1) / 2, y: (replay.ruleset.map.height - 1) / 2 };
          let look = mid;
          if (shots) { clock.draw(); return; }
          if (FIXED_CAMERA) look = { x: FIXED_CAMERA[0], y: FIXED_CAMERA[1] };
          else if (track) {
            // Between ticks, the camera moves on with the clock.
            const at = Math.min(track.length - 1, gameMs / tickMs), a = track[Math.floor(at)], b = track[Math.min(track.length - 1, Math.floor(at) + 1)], f = at % 1;
            look = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
          }
          const k = FADE_IN || FADE_OUT ? ease(units) : 1;
          created.camera.frame(mid.x + (look.x - mid.x) * k, mid.y + (look.y - mid.y) * k, ZOOM, DY);
          clock.draw();
        },
      };
    }, (e: unknown) => setFailure(`the board could not be drawn: ${String((e as Error)?.message ?? e)}`));
    return () => {
      cancelled = true;
      renderer?.destroy();
    };
  }, [replay, check, frames, scripts]);

  const names = useMemo(() => Object.fromEntries((replay?.players ?? []).map((p) => [p.id, p.name])), [replay]);
  const colors = useMemo(() => playerColors(replay?.players ?? []), [replay]);
  const last = !!replay && !!view && view.tick >= replay.finalTick;

  if (OG) return <LinkPreview host={host} replay={replay} />;
  if (UI) return <VideoViewer host={host} frames={frames} scripts={scripts} replay={replay} ruleset={ruleset} index={index} shot={shot} revealed={revealed} loaded={check ? frames.current.length : 0} />;

  return (
    <div className="game">
      <div className="canvas-host" ref={host} />
      {!CLEAN && <>
      {view && <PlayerList colors={colors} view={view} names={names} />}
      <EventFeed events={events} names={names} colors={colors} tickMs={replay ? 1000 / replay.tickRate : 100} />
      {view && last && <OutcomeBanner view={view} names={names} colors={colors} />}
      <div className="corner brandmark">Castellan</div>
      </>}
    </div>
  );
}

/** The unit whose script is open at `tick`. */
const unit = (reveals: ScriptReveal[], tick: number) => reveals.find((r) => r.tick <= tick && tick < r.until)?.unit ?? null;

/** The replay viewer as a recording shows it: the map, the opened unit, the side panel and the timeline only. */
function VideoViewer({ host, frames, scripts, replay, ruleset, index, shot, revealed, loaded }: {
  host: RefObject<HTMLDivElement | null>; frames: { current: SpectatorView[] }; scripts: { current: ScriptLoad[] };
  replay: ReplayFile | null; ruleset: Ruleset | null | undefined; index: number; shot: VideoShot; revealed: string | null; loaded: number;
}) {
  const names = useMemo(() => Object.fromEntries((replay?.players ?? []).map((p) => [p.id, p.name])), [replay]);
  const colors = useMemo(() => playerColors(replay?.players ?? []), [replay]);
  const tickMs = replay ? 1000 / replay.tickRate : 100, total = replay ? replay.finalTick + 1 : 0;
  const frame = frames.current[index] ?? null;
  // Only the map has the battle's fog: the log, the timeline and the panels stay the spectator's.
  const allEvents = useEventIndex(frames, loaded, null);
  const events = useMemo(() => upTo(allEvents, frame?.tick ?? index), [allEvents, frame, index]);
  const marks = useMemo(() => marksOf(allEvents, frames.current[loaded - 1]?.chat ?? [], total, colors, names), [allEvents, frames, loaded, total, colors, names]);
  const lastSeen = useRef<EntityView | null>(null);
  const seen = revealed ? frame?.entities.find((e) => e.id === revealed) : undefined;
  if (seen) lastSeen.current = seen;
  const opened = revealed && lastSeen.current?.id === revealed ? lastSeen.current : null;
  // The panel is the spectator's, as a click shows it: every player's script, whatever fog the map has.
  const entity = opened ? frame?.entities.find((e) => e.id === opened.id) ?? null : null;
  const atEnd = !!frame && frame.tick >= total - 1;
  return (
    <div className="game viewer video">
      <div className="stage">
        <div className="canvas-host" ref={host} />
        {opened && ruleset && !atEnd && <UnitPanel entity={entity} last={opened} tickMs={tickMs} names={names} colors={colors} reactiveOrders={ruleset.reactiveOrders}
          script={scriptAt(scripts.current, ruleset, opened.owner, opened.kind, frame?.tick ?? index)}
          scriptRuntime={frame?.players.find((p) => p.id === opened.owner)?.scriptRuntime} onClose={() => {}} />}
        {/* Above the map: the speed, then whose fog it shows. At the end, only the outcome. */}
        <div className="corner video-top">
          <span className="speeds"><button className="on">{SPEED}×</button></span>
          {shot.pov && !atEnd && <PerspectiveBadge player={shot.pov} names={names} colors={colors} />}
        </div>
        {frame && atEnd && <OutcomeBanner view={frame} names={names} colors={colors} />}
      </div>
      <div className="controls">
        <Timeline marks={marks} total={total} index={index} loaded={loaded} tickMs={tickMs} onSeek={() => {}} />
      </div>
      {/* The player list stays the spectator's; its title and the highlighted player are the replay's. */}
      <SidePanel players={frame && <PlayerList selectedPlayer={shot.pov} onSelectPlayer={() => {}} colors={colors} view={frame} names={names} />} seats={replay?.players.length}
        events={events} chat={frame?.chat ?? []} names={names} colors={colors} tickMs={tickMs} player={shot.pov} />
    </div>
  );
}

/** A replay's link preview: the board, the game's name and who played, team by team. */
function LinkPreview({ host, replay }: { host: RefObject<HTMLDivElement | null>; replay: ReplayFile | null }) {
  const names = useMemo(() => Object.fromEntries((replay?.players ?? []).map((p) => [p.id, p.name])), [replay]);
  const colors = useMemo(() => playerColors(replay?.players ?? []), [replay]);
  const teams = useMemo(() => teamsOf(replay?.players ?? []).map((team) => team.map((p) => p.id)), [replay]);
  return (
    <div className="game link-preview">
      <div className="canvas-host" ref={host} />
      <div className="corner brand-head">Castellan</div>
      {replay && <div className="link-preview-title">
        <div className="matchup">{teams.map((ids, i) => <Fragment key={ids[0]}>{i > 0 && <span className="vs"> vs. </span>}<span className="team"><Agents ids={ids} names={names} colors={colors} /></span></Fragment>)}</div>
        <div className="sub">{replay.ruleset.map.name ?? "Open field"} · {fmtTime(replay.finalTick * 1000 / replay.tickRate)}</div>
      </div>}
    </div>
  );
}
