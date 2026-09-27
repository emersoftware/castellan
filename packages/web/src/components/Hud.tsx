import { useState } from "react";
import type { GameEvent, PlayerStats, PlayerTiming, SpectatorView } from "@aoa/shared";
import type { HoverInfo } from "../render/renderer";
import { fmtTime } from "../api";
import { sfx } from "../audio/sfx";

const TEAM_CLASS = ["team-a", "team-b"];

export function TopBar({ view, names, timing }: { view: SpectatorView; names: Record<string, string>; timing?: Record<string, PlayerTiming> }) {
  const [a, b] = view.players;
  return (
    <div className="topbar">
      {a && <PlayerCard p={a} name={names[a.id] ?? a.name} team={0} timing={timing?.[a.id]} matchMs={view.timeMs} />}
      <div className="clock">
        <div className="time">{fmtTime(view.timeMs)}</div>
        <div className="sub">of {fmtTime(view.matchMs)}</div>
      </div>
      {b && <PlayerCard p={b} name={names[b.id] ?? b.name} team={1} timing={timing?.[b.id]} matchMs={view.timeMs} />}
    </div>
  );
}

function PlayerCard({ p, name, team, timing, matchMs }: { p: PlayerStats; name: string; team: number; timing?: PlayerTiming; matchMs: number }) {
  return (
    <div className={`player ${TEAM_CLASS[team]} ${p.alive ? "" : "dead"}`}>
      <div className="name">{name}</div>
      <div className="stats">
        <span title="capital"><i>gold</i> {p.capital}</span>
        <span title="population"><i>pop</i> {p.pop}/{p.popCap}</span>
        <span title="kills"><i>kills</i> {p.kills}</span>
        <span title="score"><i>score</i> {p.score}</span>
      </div>
      {timing && <TimingLine t={timing} matchMs={matchMs} />}
    </div>
  );
}

/** How the player uses its time, measured by the server (same for every connector). */
function TimingLine({ t, matchMs }: { t: PlayerTiming; matchMs: number }) {
  const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const avg = t.thinks ? t.thinkMs / t.thinks : 0;
  const opm = matchMs > 0 ? (t.orders * 60000) / matchMs : 0;
  return (
    <div className="timing" title="measured by the server: think = time between our answer and the player's next call">
      <span><i>think</i> {s(avg)}</span>
      <span><i>longest</i> {s(t.maxThinkMs)}</span>
      <span><i>waiting</i> {s(t.waitMs)}</span>
      <span><i>orders/min</i> {opm.toFixed(1)}</span>
      <span><i>first</i> {t.firstActionMs === null ? "—" : s(t.firstActionMs)}</span>
    </div>
  );
}

/** Notable events, newest first. */
export function EventFeed({ events, names, owners }: { events: GameEvent[]; names: Record<string, string>; owners: string[] }) {
  const team = (id?: string) => TEAM_CLASS[Math.max(0, owners.indexOf(id ?? ""))];
  const lines = events
    .filter((e) => e.type === "death" || (e.type === "spawn" && e.kind !== "worker") || e.type === "match_end" || e.type === "chat")
    .slice(-8)
    .reverse();
  return (
    <div className="feed">
      {lines.map((e, i) => (
        <div key={`${e.tick}-${i}`} className="line">
          <span className="t">{fmtTime(e.tick * 100)}</span>{" "}
          {e.type === "death" && (
            <>
              <b className={team(e.owner)}>{names[e.owner] ?? e.owner}</b> lost a {e.kind}
            </>
          )}
          {e.type === "spawn" && (
            <>
              <b className={team(e.owner)}>{names[e.owner] ?? e.owner}</b> {["knight", "ranger", "worker"].includes(e.kind) ? "trained" : "built"} a {e.kind}
            </>
          )}
          {e.type === "chat" && (
            <>
              <b className={team(e.owner)}>{names[e.owner] ?? e.owner}</b>: <q>{e.text}</q>
            </>
          )}
          {e.type === "match_end" && <b>The battle is over</b>}
        </div>
      ))}
    </div>
  );
}

export function Tooltip({ hover }: { hover: HoverInfo | null }) {
  if (!hover) return <div className="tooltip muted">drag to pan · scroll to zoom · hover a unit</div>;
  const e = hover.entity;
  const d = hover.deposit;
  return (
    <div className="tooltip">
      <span className="muted">({hover.x}, {hover.y})</span>{" "}
      {e && (
        <>
          <b>{e.kind}</b> {e.id} · {e.owner} · {e.hp}/{e.maxHp} hp{e.order ? ` · ${e.order}` : ""}
          {e.doing ? ` · ${e.doing}` : e.heading ? ` · ${e.heading}` : ""}
        </>
      )}
      {d && (
        <>
          <b>gold mine</b> {d.id} · {d.amount} left
        </>
      )}
      {hover.rock && <b>impassable rock</b>}
    </div>
  );
}

export function OutcomeBanner({ view, names }: { view: SpectatorView; names: Record<string, string> }) {
  const o = view.outcome;
  if (!o) return null;
  const winner = o.winner ? names[o.winner] ?? o.winner : null;
  const reason = o.reason === "vital_lost" ? "a vital unit has fallen" : o.reason === "timeout" ? "time ran out: the higher score wins" : "forfeit";
  return (
    <div className="banner">
      <div className="big">{winner ? `${winner} is victorious` : "Stalemate"}</div>
      <div className="sub">{reason}</div>
    </div>
  );
}

/** Sound on/off; the first click also unlocks audio in the browser. */
export function SoundToggle() {
  const [muted, setMuted] = useState(sfx.muted);
  return (
    <button
      className="sound"
      title={muted ? "sound off" : "sound on"}
      onClick={() => {
        sfx.setMuted(!muted);
        setMuted(!muted);
      }}
    >
      {muted ? "sound: off" : "sound: on"}
    </button>
  );
}
