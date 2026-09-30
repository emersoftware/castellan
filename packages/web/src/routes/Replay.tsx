import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ChatMessage, GameEvent, SpectatorView } from "@aoa/shared";
import { api, playerColors, fmtTime } from "../api";
import { playerPerspective } from "../perspective";
import { sfx } from "../audio/sfx";
import { GameCanvas } from "../components/GameCanvas";
import { OutcomeBanner, SidePanel, SoundToggle, Tooltip, PlayerList, notableEvents } from "../components/Hud";
import type { HoverInfo, SoundSink } from "../render/renderer";
import { useReplayFrames } from "../useReplay";
import { agentText } from "../components/Agent";

const SPEEDS = [0.5, 1, 2, 4, 8, 16];

export function Replay() {
  const { id } = useParams({ from: "/replay/$id" });
  const search = new URLSearchParams(location.search);
  const t = Number(search.get("t"));
  return <ReplayPlayer key={id} id={id} syncUrl initialSeconds={t > 0 ? t : undefined} initialPlayer={search.get("pov")} />;
}

/** Writes the moment and perspective into the address bar so a link opens right there. */
export function writeUrl(params: Record<string, string | null>) {
  const url = new URL(location.href);
  for (const [k, v] of Object.entries(params)) v === null ? url.searchParams.delete(k) : url.searchParams.set(k, v);
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

type Mark = { tick: number; kind: "death" | "eliminated" | "chat" | "end"; color: number; count: number; label: string };

/** Timeline marks, grouped in half-percent buckets so a battle is one mark, not a hundred. */
function marksOf(events: GameEvent[], chat: ChatMessage[], total: number, colors: Record<string, number>, names: Record<string, string>): Mark[] {
  const buckets = new Map<string, Mark>();
  const add = (tick: number, kind: Mark["kind"], owner: string | undefined, what: string) => {
    const key = `${kind}:${owner ?? ""}:${Math.round((tick / Math.max(1, total - 1)) * 200)}`;
    const m = buckets.get(key);
    if (m) { m.count++; return; }
    buckets.set(key, { tick, kind, color: colors[owner ?? ""] ?? 0, count: 1, label: `${owner ? `${agentText(owner, names[owner])} ` : ""}${what}` });
  };
  for (const e of events) {
    if (e.type === "death") add(e.tick, "death", e.owner, "lost units");
    else if (e.type === "eliminated") add(e.tick, "eliminated", e.owner, "is out");
    else if (e.type === "match_end") add(e.tick, "end", undefined, "the battle is over");
  }
  for (const m of chat) add(m.tick, "chat", m.from, "chat");
  return [...buckets.values()];
}

export function ReplayPlayer({ id, onEnded, initialSpeed = 2, onSpeedChange, initialPlaying = true, initialSeconds, initialPlayer = null, syncUrl = false }: {
  id: string; onEnded?: () => void; initialSpeed?: number; onSpeedChange?: (speed: number) => void; initialPlaying?: boolean;
  /** Open at this moment of the match (`?t=` in the address bar). */
  initialSeconds?: number;
  initialPlayer?: string | null;
  /** Keep `?t=` and `?pov=` up to date (the replay page, not series or archived watch). */
  syncUrl?: boolean;
}) {
  const replay = useQuery({ queryKey: ["replay", id], queryFn: () => api.replay(id), staleTime: Infinity, retry: false });
  const { frames, loaded, check, error } = useReplayFrames(replay.data);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(initialPlayer);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(initialPlaying && !initialSeconds);
  const [speed, setSpeed] = useState(initialSpeed);
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

  // At high speed only the big moments make a sound.
  const sound = useCallback<SoundSink>(
    (name, pan, vol) => {
      if (speed > 4 && !["horn", "fanfare", "collapse"].includes(name)) return;
      sfx.play(name, pan, vol);
    },
    [speed],
  );

  const seekTo = useCallback((i: number | ((old: number) => number)) => {
    setIndex((old) => Math.max(0, Math.min(typeof i === "function" ? i(old) : i, frames.current.length - 1)));
    setJumpKey((k) => k + 1);
  }, [frames]);
  const changeSpeed = useCallback((s: number) => { setSpeed(s); onSpeedChange?.(s); }, [onSpeedChange]);

  // A shared link opens at its moment once the simulation gets there.
  const pending = useRef(initialSeconds === undefined ? null : initialSeconds);
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
    const timer = setTimeout(() => writeUrl({ t: index > 0 ? String(Math.floor((index * tickMs) / 1000)) : null, pov: selectedPlayer }), 300);
    return () => clearTimeout(timer);
  }, [syncUrl, playing, index, tickMs, selectedPlayer]);

  // Space plays and pauses, arrows move a second (ten with shift), 1–6 pick the speed.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement | null)?.closest?.("input:not([type=range]), textarea, select, [contenteditable]");
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if (e.key === " ") { e.preventDefault(); if (!e.repeat) setPlaying((p) => !p); }
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
  }, [tickRate, seekTo, changeSpeed]);

  const frame = frames.current[index] ?? null;
  const display = playerPerspective(frame, selectedPlayer);
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

  if (replay.isError)
    return (
      <div className="page">
        <p>This replay isn't here. <Link to="/battles">Back to the battles</Link></p>
      </div>
    );

  const pct = (tick: number) => `${(100 * tick) / Math.max(1, total - 1)}%`;
  const players = display && <PlayerList selectedPlayer={selectedPlayer} onSelectPlayer={(id) => { setSelectedPlayer(id); setHover(null); }} colors={colors} view={display} names={names} />;

  return (
    <div className="game viewer" onPointerDown={() => !sfx.muted && sfx.unlock()}>
      <div className="stage">
        {replay.data && <GameCanvas key={selectedPlayer ?? "all"} ruleset={replay.data.ruleset} colors={colors} frame={display} tickMs={tickMs / speed} paused={!playing} jumpKey={jumpKey} onHover={setHover} sound={sound} />}
        <Tooltip hover={hover} names={names} colors={colors} />
        <div className="corner">
          <Link to="/battles">← Battles</Link>
        </div>
        {frame && atEnd && <OutcomeBanner view={frame} names={names} colors={colors} dismissible />}
      </div>

      <div className="controls">
        <button className="play" onClick={() => setPlaying((p) => !p)} title="play / pause (space)">{playing ? "Pause" : "Play"}</button>
        <button onClick={() => seekTo((i) => i - tickRate)} title="back 1 s (←, shift for 10 s)">−1s</button>
        <button onClick={() => seekTo((i) => i + tickRate)} title="forward 1 s (→, shift for 10 s)">+1s</button>
        <div className="timeline">
          <div className="marks">
            {marks.map((m) => (
              <button key={`${m.kind}-${m.tick}-${m.color}`} className={`mark ${m.kind} bg${m.color}`} style={{ left: pct(m.tick) }}
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
        <SoundToggle />
        <span className={`check ${check ? (check.verified ? "ok" : "bad") : ""}`} title="the browser re-simulated the match and compared state hashes">
          {error ? `error: ${error}` : !check ? `simulating ${loaded}/${total}` : check.verified ? "verified" : `desync at ${check.desyncAt}`}
        </span>
      </div>

      <SidePanel players={players} seats={replay.data?.players.length} events={events} chat={display?.chat ?? []} names={names} colors={colors} tickMs={tickMs} player={selectedPlayer} onSeek={seekTo} />
    </div>
  );
}
