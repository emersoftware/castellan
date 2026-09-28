import { useState } from "react";
import type { GameEvent, PlayerStats, PlayerTiming, SpectatorView } from "@aoa/shared";
import type { HoverInfo } from "../render/renderer";
import { fmtTime, winnersOf } from "../api";
import { sfx } from "../audio/sfx";

/**
 * The score list, as in Age of Empires: the clock, then every player in its
 * colour with gold, population, kills and score, grouped by team in 2v2.
 */
export function PlayerList({ view, names, timing, colors }: {
  view: SpectatorView; names: Record<string, string>; timing?: Record<string, PlayerTiming>; colors: Record<string, number>;
}) {
  const teams = [...new Set(view.players.map((p) => p.team))];
  const grouped = teams.length < view.players.length;
  return (
    <div className="scores">
      <div className="clock">
        <span className="time">{fmtTime(view.timeMs)}</span> <span className="sub">/ {fmtTime(view.matchMs)}</span>
      </div>
      <table>
        <thead>
          <tr><th /><th>gold</th><th>pop</th><th>kills</th><th>score</th></tr>
        </thead>
        {teams.map((t, i) => (
          <tbody key={t}>
            {grouped && <tr className="team"><td colSpan={5}>Team {i + 1}</td></tr>}
            {view.players.filter((p) => p.team === t).map((p) => (
              <PlayerRows key={p.id} p={p} name={names[p.id] ?? p.name} color={colors[p.id] ?? 0} timing={timing?.[p.id]} matchMs={view.timeMs} />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function PlayerRows({ p, name, color, timing, matchMs }: { p: PlayerStats; name: string; color: number; timing?: PlayerTiming; matchMs: number }) {
  return (
    <>
      <tr className={p.alive ? "" : "dead"}>
        <td className={`name pc${color}`}><span className={`swatch bg${color}`} />{name}</td>
        <td>{p.capital}</td>
        <td>{p.pop}/{p.popCap}</td>
        <td>{p.kills}</td>
        <td>{p.score}</td>
      </tr>
      {timing && (
        <tr className="timing">
          <td colSpan={5}><TimingLine t={timing} matchMs={matchMs} /></td>
        </tr>
      )}
      {p.upgrades && (Object.keys(p.upgrades).length > 0 || p.research) && (
        <tr className="timing"><td colSpan={5}>
          {Object.entries(p.upgrades).map(([id, level]) => `${id.replaceAll("_", " ")} L${level}`).join(" · ")}
          {p.research && <div>Researching {p.research.upgrade.replaceAll("_", " ")} L{p.research.level} · {Math.max(0, (p.research.completesAtMs - matchMs) / 1000).toFixed(1)}s</div>}
        </td></tr>
      )}
    </>
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
export function EventFeed({ events, names, colors }: { events: GameEvent[]; names: Record<string, string>; colors: Record<string, number> }) {
  const team = (id?: string) => `pc${colors[id ?? ""] ?? 0}`;
  // An eliminated player's entities all die at once: show the elimination, not each death.
  const out = new Set(events.filter((e) => e.type === "eliminated").map((e) => `${e.tick}:${e.owner}`));
  const lines = events
    .filter((e) => (e.type === "death" && !out.has(`${e.tick}:${e.owner}`)) || e.type === "eliminated" || (e.type === "spawn" && e.kind !== "worker") || e.type === "match_end" || e.type === "chat" || e.type === "research_started" || e.type === "upgrade_completed")
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
              <b className={team(e.owner)}>{names[e.owner] ?? e.owner}</b>{e.channel === "private" ? <span className="muted"> [private → {names[e.to ?? ""] ?? e.to}]</span> : e.channel === "team" && <span className="muted"> [team]</span>}: <q>{e.text}</q>
            </>
          )}
          {e.type === "eliminated" && (
            <>
              <b className={team(e.owner)}>{names[e.owner] ?? e.owner}</b> is out
            </>
          )}
          {e.type === "match_end" && <b>The battle is over</b>}
          {(e.type === "research_started" || e.type === "upgrade_completed") && <>
            <b className={team(e.owner)}>{names[e.owner] ?? e.owner}</b> {e.type === "research_started" ? "researching" : "completed"} {e.upgrade.replaceAll("_", " ")} L{e.level}
          </>}
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
          {e.stats && ` · atk ${e.stats.atk} · def ${e.stats.def} · range ${e.stats.range} · attack ${e.stats.attackMs}ms · move ${e.stats.moveMs}ms`}
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
  const winners = winnersOf(o).map((id) => names[id] ?? id);
  const reason = o.reason === "vital_lost" ? "a vital unit has fallen" : o.reason === "timeout" ? "time ran out: the higher score wins" : "forfeit";
  return (
    <div className="banner">
      <div className="big">{winners.length ? `${winners.join(" & ")} ${winners.length > 1 ? "are" : "is"} victorious` : "Stalemate"}</div>
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
