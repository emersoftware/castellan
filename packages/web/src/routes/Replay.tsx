import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { GameEvent } from "@aoa/shared";
import { api, fmtTime } from "../api";
import { sfx } from "../audio/sfx";
import { GameCanvas } from "../components/GameCanvas";
import { EventFeed, OutcomeBanner, SoundToggle, Tooltip, TopBar } from "../components/Hud";
import type { HoverInfo, SoundSink } from "../render/renderer";
import { useReplayFrames } from "../useReplay";

const SPEEDS = [0.5, 1, 2, 4, 8, 16];

export function Replay() {
  const { id } = useParams({ from: "/replay/$id" });
  const replay = useQuery({ queryKey: ["replay", id], queryFn: () => api.replay(id), staleTime: Infinity, retry: false });
  const { frames, loaded, check, error } = useReplayFrames(replay.data);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(2);
  const [jumpKey, setJumpKey] = useState(0);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const tickMs = replay.data ? 1000 / replay.data.tickRate : 100;

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

  const frame = frames.current[index] ?? null;
  const total = replay.data ? replay.data.finalTick + 1 : 0;
  const names = useMemo(() => Object.fromEntries((replay.data?.players ?? []).map((p) => [p.id, p.name])), [replay.data]);
  const owners = useMemo(() => (replay.data?.players ?? []).map((p) => p.id), [replay.data]);
  const events = useMemo(() => {
    const out: GameEvent[] = [];
    for (let i = Math.max(0, index - 600); i <= index && i < frames.current.length; i++) out.push(...frames.current[i].events.filter((e) => e.type !== "attack"));
    return out;
  }, [index, loaded, frames]);
  const atEnd = index >= total - 1 && !!check;

  const seek = (i: number) => {
    setIndex(Math.max(0, Math.min(i, frames.current.length - 1)));
    setJumpKey((k) => k + 1);
  };

  if (replay.isError)
    return (
      <div className="page">
        <p>This replay isn't here. <Link to="/battles">Back to the battles</Link></p>
      </div>
    );

  return (
    <div className="game" onPointerDown={() => !sfx.muted && sfx.unlock()}>
      {replay.data && <GameCanvas ruleset={replay.data.ruleset} players={owners} frame={frame} tickMs={tickMs / speed} jumpKey={jumpKey} onHover={setHover} sound={sound} />}
      {frame && <TopBar view={frame} names={names} timing={atEnd ? replay.data?.timing : undefined} />}
      <EventFeed events={events} names={names} owners={owners} />
      <Tooltip hover={hover} />
      <div className="corner">
        <Link to="/battles">← Battles</Link>
      </div>
      {frame && atEnd && <OutcomeBanner view={frame} names={names} />}

      <div className="controls">
        <button onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
        <button onClick={() => seek(index - 10)} title="back 1 s">−1s</button>
        <button onClick={() => seek(index + 10)} title="forward 1 s">+1s</button>
        <input
          type="range" min={0} max={Math.max(0, total - 1)} value={index}
          onChange={(e) => seek(Number(e.target.value))}
          style={{ ["--loaded" as string]: `${(100 * loaded) / Math.max(1, total)}%` }}
        />
        <span className="time">{fmtTime(index * tickMs)} / {fmtTime((total - 1) * tickMs)}</span>
        <span className="speeds">
          {SPEEDS.map((s) => (
            <button key={s} className={s === speed ? "on" : ""} onClick={() => setSpeed(s)}>{s}×</button>
          ))}
        </span>
        <SoundToggle />
        <span className={`check ${check ? (check.verified ? "ok" : "bad") : ""}`} title="the browser re-simulated the match and compared state hashes">
          {error ? `error: ${error}` : !check ? `simulating ${loaded}/${total}` : check.verified ? "verified" : `desync at ${check.desyncAt}`}
        </span>
      </div>
    </div>
  );
}
