import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { track, trackError } from "../analytics";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ChatMessage, GameEvent, MomentChange, SoundName, SpectatorView } from "@aoa/shared";
import { NEUTRAL_OWNER, pagePath, pages, readMoment, writeMoment } from "@aoa/shared";
import { api, playerColors, fmtTime } from "../api";
import { playerPerspective } from "../perspective";
import { sfx } from "../audio/sfx";
import { GameCanvas } from "../components/GameCanvas";
import { ViewerTop, DepositPanel, OutcomeBanner, SidePanel, SoundToggle, Tooltip, PlayerList, UnitPanel, notableEvents } from "../components/Hud";
import { useUnitSelection } from "../useSelection";
import { scriptAt } from "../scripts";
import type { HoverInfo, SoundSink } from "../render/renderer";
import { useReplayFrames } from "../useReplay";
import { Arrow } from "../components/Arrow";
import { ShareMoment } from "../components/ShareMoment";
import { agentText } from "../components/Agent";

const SPEEDS = [0.5, 1, 2, 4, 8, 16];
/** The viewer's chosen speed, kept for the tab: the next game of a series plays on at it. */
const SPEED_KEY = "aoa:replay-speed";
const savedSpeed = () => { const s = Number(sessionStorage.getItem(SPEED_KEY)); return SPEEDS.includes(s) ? s : 2; };
/** At high speed only the big moments make a sound. */
const BIG_MOMENTS = new Set<SoundName>(["horn", "fanfare", "collapse"]);

export function Replay() {
  const { id } = useParams({ from: pages.replay });
  return <ReplayPlayer key={id} id={id} />;
}

/** Writes the moment and perspective into the address bar so a link opens right there. */
export function writeUrl(moment: MomentChange) {
  const url = new URL(location.href);
  writeMoment(url.searchParams, moment);
  if (url.href !== location.href) history.replaceState(history.state, "", url);
}

/** Notable events of every frame for one perspective, built once as frames stream in. */
function useEventIndex(frames: { current: SpectatorView[] }, loaded: number, player: string | null) {
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
function upTo<T extends { tick: number }>(list: T[], tick: number): T[] {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].tick <= tick) lo = mid + 1; else hi = mid;
  }
  return list.slice(0, lo);
}

type Mark = { tick: number; kind: "death" | "eliminated" | "chat" | "end"; color?: number; count: number; label: string };

/** Timeline marks, grouped in half-percent buckets so a battle is one mark, not a hundred. */
function marksOf(events: GameEvent[], chat: ChatMessage[], total: number, colors: Record<string, number>, names: Record<string, string>): Mark[] {
  const buckets = new Map<string, Mark>();
  const add = (tick: number, kind: Mark["kind"], owner: string | undefined, what: string) => {
    const key = `${kind}:${owner ?? ""}:${Math.round((tick / Math.max(1, total - 1)) * 200)}`;
    const m = buckets.get(key);
    if (m) { m.count++; return; }
    buckets.set(key, { tick, kind, color: owner === NEUTRAL_OWNER ? undefined : colors[owner ?? ""] ?? 0, count: 1, label: `${owner ? `${agentText(owner, names[owner])} ` : ""}${what}` });
  };
  for (const e of events) {
    if (e.type === "death") add(e.tick, "death", e.owner, e.owner === NEUTRAL_OWNER ? "wall destroyed" : "lost units");
    else if (e.type === "eliminated") add(e.tick, "eliminated", e.owner, "is out");
    else if (e.type === "match_end") add(e.tick, "end", undefined, "the battle is over");
  }
  for (const m of chat) add(m.tick, "chat", m.from, "chat");
  return [...buckets.values()];
}

export function ReplayPlayer({ id, onEnded, initialPlaying = true, series }: {
  id: string; onEnded?: () => void; initialPlaying?: boolean;
  /** The series line, under the title of the player list. */
  series?: ReactNode;
}) {
  // Opens at the moment in the address bar; only this replay's own page keeps it up to date.
  const [moment] = useState(() => readMoment(new URLSearchParams(location.search)));
  const syncUrl = location.pathname === pagePath(pages.replay, id);
  const replay = useQuery({ queryKey: ["replay", id], queryFn: () => api.replay(id), staleTime: Infinity, retry: false });
  const [attempt, setAttempt] = useState(0);
  const { frames, ruleset, loaded, check, error } = useReplayFrames(replay.data, attempt);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(moment.player);
  useEffect(() => sfx.holdAmbient(), []);
  useEffect(() => sfx.holdMusic("battle"), []);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(initialPlaying && !moment.seconds);
  const [speed, setSpeed] = useState(savedSpeed);
  const [jumpKey, setJumpKey] = useState(0);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const tickRate = replay.data?.tickRate ?? 10;
  const tickMs = 1000 / tickRate;

  // Playback clock.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      acc += now - last;
      last = now;
      const step = tickMs / speed;
      if (acc >= step) {
        const n = Math.floor(acc / step);
        acc -= n * step;
        setIndex((i) => Math.min(i + n, Math.max(0, frames.current.length - 1)));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, tickMs, frames]);

  const sound = useCallback<SoundSink>(
    (name, pan, vol) => {
      if (speed > 4 && !BIG_MOMENTS.has(name)) return;
      sfx.play(name, pan, vol);
    },
    [speed],
  );

  const seekTo = useCallback((i: number | ((old: number) => number)) => {
    setIndex((old) => Math.max(0, Math.min(typeof i === "function" ? i(old) : i, frames.current.length - 1)));
    setJumpKey((k) => k + 1);
  }, [frames]);
  const changeSpeed = useCallback((s: number) => {
    setSpeed(s); sessionStorage.setItem(SPEED_KEY, String(s));
    track("replay_speed_changed", { replay_id: id, speed: s });
  }, [id]);
  const togglePlayback = useCallback(() => {
    track("replay_playback_toggled", { replay_id: id, playing: !playing });
    setPlaying(p => !p);
  }, [id, playing]);
  useEffect(() => {
    if (error) trackError("prepare replay", { replay_id: id });
  }, [error, id]);

  // A shared link opens at its moment once the simulation gets there.
  const pending = useRef(moment.seconds ?? null);
  useEffect(() => {
    if (pending.current === null || !replay.data) return;
    const target = Math.round(pending.current * tickRate);
    if (loaded > target || check) {
      pending.current = null;
      seekTo(target);
    }
  }, [loaded, check, replay.data, tickRate, seekTo]);

  useEffect(() => {
    if (!syncUrl || playing || pending.current !== null) return;
    const timer = setTimeout(() => writeUrl({ seconds: index > 0 ? (index * tickMs) / 1000 : null, player: selectedPlayer }), 300);
    return () => clearTimeout(timer);
  }, [syncUrl, playing, index, tickMs, selectedPlayer]);

  // Space plays and pauses, arrows move a second (ten with shift), 1–6 pick the speed.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement | null)?.closest?.("input:not([type=range]), textarea, select, [contenteditable]");
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if (e.key === " ") { e.preventDefault(); if (!e.repeat) togglePlayback(); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const step = (e.shiftKey ? 10 : 1) * tickRate * (e.key === "ArrowLeft" ? -1 : 1);
        seekTo((i) => i + step);
      } else if (/^[1-6]$/.test(e.key)) changeSpeed(SPEEDS[Number(e.key) - 1]);
    };
    // A focused button would also click on space.
    const up = (e: KeyboardEvent) => { if (e.key === " " && !typing(e)) e.preventDefault(); };
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    return () => { removeEventListener("keydown", down); removeEventListener("keyup", up); };
  }, [tickRate, seekTo, changeSpeed, togglePlayback]);

  const frame = frames.current[index] ?? null;
  const display = playerPerspective(frame, selectedPlayer);
  const unit = useUnitSelection(display?.entities, display?.deposits);
  const shownUnit = unit.entity ?? unit.last;
  const unitScript = useMemo(() => shownUnit && replay.data && ruleset ? scriptAt(replay.data.orders, ruleset, shownUnit.owner, shownUnit.kind, frame?.tick ?? index) : undefined,
    [shownUnit?.owner, shownUnit?.kind, replay.data, ruleset, frame?.tick, index]);
  const total = replay.data ? replay.data.finalTick + 1 : 0;
  const names = useMemo(() => Object.fromEntries((replay.data?.players ?? []).map((p) => [p.id, p.name])), [replay.data]);
  const colors = useMemo(() => playerColors(replay.data?.players ?? []), [replay.data]);
  const allEvents = useEventIndex(frames, loaded, selectedPlayer);
  const events = useMemo(() => upTo(allEvents, frame?.tick ?? index), [allEvents, frame, index]);
  const lastLoaded = loaded ? frames.current[loaded - 1] : null;
  const marks = useMemo(() => marksOf(allEvents, playerPerspective(lastLoaded, selectedPlayer)?.chat ?? [], total, colors, names),
    [allEvents, lastLoaded, selectedPlayer, total, colors, names]);
  const atEnd = index >= total - 1 && !!check;
  useEffect(() => {
    if (!playing || !atEnd || !onEnded) return;
    const timer = setTimeout(onEnded, 1500);
    return () => clearTimeout(timer);
  }, [playing, atEnd, onEnded]);

  const pct = (tick: number) => `${(100 * tick) / Math.max(1, total - 1)}%`;
  const players = display && <PlayerList selectedPlayer={selectedPlayer} onSelectPlayer={(player) => { setSelectedPlayer(player); setHover(null); track("replay_perspective_changed", { replay_id: id, perspective: player ?? "all" }); }} colors={colors} view={display} names={names} subtitle={series} />;

  if (replay.isError || error) return <div className="page load-state" role="alert">
    <h1>Couldn’t load this battle</h1>
    <p>{error ? "The replay could not be prepared. Try again." : "It may be unavailable, or your connection was interrupted."}</p>
    <button onClick={() => { setIndex(0); setAttempt(a => a + 1); void replay.refetch(); }}>Try again</button> <Link to="/battles">Back to battles</Link>
  </div>;

  return (
    <div className="game viewer" onPointerDown={() => !sfx.muted && sfx.unlock()}>
      <div className="stage">
        {!frame && <div className="load-state" role="status">{replay.isPending ? "Loading battle…" : "Preparing replay…"}</div>}
        {ruleset && <GameCanvas key={selectedPlayer ?? "all"} ruleset={ruleset} colors={colors} frame={display} tickMs={tickMs / speed} paused={!playing} jumpKey={jumpKey} onHover={setHover} selected={unit.selected} onSelect={unit.setSelected} sound={sound} />}
        {unit.deposit ? <DepositPanel deposit={unit.deposit} onClose={() => unit.setSelected(null)} />
          : unit.last ? <UnitPanel entity={unit.entity} last={unit.last} script={unitScript} tickMs={tickMs} names={names} colors={colors} reactiveOrders={ruleset?.reactiveOrders} onClose={() => unit.setSelected(null)} />
          : <Tooltip hover={hover} names={names} colors={colors} />}
        <ViewerTop view={display ?? null} />
        {frame && atEnd && <OutcomeBanner view={frame} names={names} colors={colors} dismissible />}
      </div>

      <div className="controls">
        <button className="play" onClick={togglePlayback} title="play / pause (space)">{playing ? "Pause" : "Play"}</button>
        <button onClick={() => seekTo((i) => i - tickRate)} title="back 1 s (←, shift for 10 s)">−1s</button>
        <button onClick={() => seekTo((i) => i + tickRate)} title="forward 1 s (→, shift for 10 s)">+1s</button>
        <div className="timeline">
          <div className="marks">
            {marks.map((m) => (
              <button key={`${m.kind}-${m.tick}-${m.color}`} className={`mark ${m.kind}${m.color === undefined ? "" : ` bg${m.color}`}`} style={{ left: pct(m.tick), ...(m.color === undefined ? { background: "var(--grey)" } : {}) }}
                title={`${fmtTime(m.tick * tickMs)} ${m.label}${m.count > 1 ? ` ×${m.count}` : ""}`} onClick={() => seekTo(m.tick)} />
            ))}
          </div>
          <input
            type="range" min={0} max={Math.max(0, total - 1)} value={index} aria-label="match time"
            onChange={(e) => seekTo(Number(e.target.value))}
            style={{ ["--loaded" as string]: `${(100 * loaded) / Math.max(1, total)}%` }}
          />
        </div>
        <span className="time">{fmtTime(index * tickMs)} / {fmtTime((total - 1) * tickMs)}</span>
        <span className="speeds">
          {SPEEDS.map((s, i) => (
            <button key={s} className={s === speed ? "on" : ""} title={`speed ${s}× (${i + 1})`} onClick={() => changeSpeed(s)}>{s}×</button>
          ))}
        </span>
        <ShareMoment id={id} seconds={index / tickRate} pov={selectedPlayer} />
        <SoundToggle />
        <span className={`check ${!check ? "" : check.verified ? "ok" : "bad"}`} title="the browser re-simulated the match and compared state hashes">
          {error ? `error: ${error}` : !check ? `simulating ${loaded}/${total}` : check.verified
            ? `verified${replay.data?.experiment?.operationalFailures?.length ? ` · ${replay.data.experiment.operationalFailures.length} recorded script interruptions` : ""}`
            : `desync at ${check.desyncAt}`}
        </span>
      </div>

      <SidePanel players={players} seats={replay.data?.players.length} events={events} chat={display?.chat ?? []} names={names} colors={colors} tickMs={tickMs} player={selectedPlayer} onSeek={seekTo} />
    </div>
  );
}
