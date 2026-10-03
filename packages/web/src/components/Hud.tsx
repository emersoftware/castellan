import { displayKind } from "../render/names";
import { useSyncExternalStore, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ChatMessage, DepositView, EntityView, GameEvent, PlayerStats, SpectatorView } from "@aoa/shared";
import type { HoverInfo } from "../render/renderer";
import { fmtTime, winnersOf } from "../api";
import { Agent, Agents, agentText } from "./Agent";
import { Arrow } from "./Arrow";
import { sfx } from "../audio/sfx";
import type { LoadedScript } from "../scripts";
import { highlightJs } from "../highlight";

/**
 * The score list, as in Age of Empires: the clock (with the title on its left
 * in watch and replay), then every player in its colour with gold,
 * population, kills and score, grouped by team in 2v2. With `onSelectPlayer`
 * a last column of eye buttons picks whose view the map shows, "all" at the bottom.
 */
export function PlayerList({ view, names, colors, selectedPlayer, onSelectPlayer, subtitle }: {
  view: SpectatorView; names: Record<string, string>; colors: Record<string, number>;
  selectedPlayer?: string | null; onSelectPlayer?: (player: string | null) => void;
  /** A line under the title (the series). */
  subtitle?: ReactNode;
}) {
  const teams = [...new Set(view.players.map((p) => p.team))];
  const grouped = teams.length < view.players.length;
  const cols = onSelectPlayer ? 6 : 5;
  return (
    <div className="scores">
      <div className="clock">
        {onSelectPlayer && <span className="brand-head">Age of Agents</span>}
        <span><span className="time">{fmtTime(view.timeMs)}</span> <span className="sub">/ {fmtTime(view.matchMs)}</span></span>
      </div>
      {subtitle && <div className="scores-subtitle">{subtitle}</div>}
      <table>
        <thead>
          <tr><th /><th>gold</th><th>pop</th><th>kills</th><th>score</th>{onSelectPlayer && <th className="view">view</th>}</tr>
        </thead>
        {teams.map((t, i) => (
          <tbody key={t}>
            {grouped && <tr className="team"><td colSpan={cols}>Team {i + 1}</td></tr>}
            {view.players.filter((p) => p.team === t).map((p) => (
              <PlayerRows key={p.id} cols={cols} p={p} selected={selectedPlayer === p.id} onSelect={onSelectPlayer ? () => onSelectPlayer(p.id) : undefined} name={names[p.id] ?? p.name} color={colors[p.id] ?? 0} />
            ))}
          </tbody>
        ))}
        {onSelectPlayer && <tbody className="view-all">
          <tr><td colSpan={cols - 1}>all</td><td className="view"><ViewButton on={!selectedPlayer} label="View everyone" onClick={() => onSelectPlayer(null)} /></td></tr>
        </tbody>}
      </table>
    </div>
  );
}

/** A bordered square with an eye: whose view the map shows. */
function ViewButton({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button className={`view-eye${on ? " on" : ""}`} aria-pressed={on} aria-label={label} title={label} onClick={onClick}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path d="M1 8s2.6-4.6 7-4.6S15 8 15 8s-2.6 4.6-7 4.6S1 8 1 8z" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="8" cy="8" r="2.2" fill="currentColor" />
      </svg>
    </button>
  );
}

/** Always there, one line tall, so the list keeps its height when the first upgrade lands. */
function UpgradesRow({ upgrades = {}, cols }: { upgrades?: Record<string, number>; cols: number }) {
  const text = Object.entries(upgrades).map(([id, level]) => `${id.replaceAll("_", " ")} L${level}`).join(" · ");
  return <tr className="timing upgrades"><td colSpan={cols} title={text || undefined}>{text || "\u00a0"}</td></tr>;
}

function PlayerRows({ p, cols, name, color, selected, onSelect }: { cols: number; selected?: boolean; onSelect?: () => void; p: PlayerStats; name: string; color: number }) {
  return (
    <>
      <tr className={p.alive ? "" : "dead"}>
        <td className={`name pc${color}`} title={`${name} (${p.id})`}>
          <div className="who">
            <span className={`swatch bg${color}`} />
            {onSelect ? <button className="player-perspective" aria-pressed={selected} onClick={onSelect} title={`View as ${name}`}>{name}</button> : <span className="pname">{name}</span>}
            <span className="pid">({p.id})</span>
          </div>
        </td>
        <td>{p.capital ?? "—"}</td>
        <td>{p.pop ?? "—"}/{p.popCap}{p.queuedPop ? ` (+${p.queuedPop})` : ""}</td>
        <td>{p.kills ?? "—"}</td>
        <td>{p.score ?? "—"}</td>
        {onSelect && <td className="view"><ViewButton on={!!selected} label={`View as ${name} (${p.id})`} onClick={onSelect} /></td>}
      </tr>
      <UpgradesRow upgrades={p.upgrades} cols={cols} />
    </>
  );
}

/**
 * The events worth a line, from one tick's batch or a whole list. An
 * eliminated player's entities all die at once: keep the elimination, not each death.
 */
export function notableEvents(events: GameEvent[]): GameEvent[] {
  const out = new Set(events.filter((e) => e.type === "eliminated").map((e) => `${e.tick}:${e.owner}`));
  return events.filter((e) => (e.type === "death" && !out.has(`${e.tick}:${e.owner}`)) || e.type === "eliminated" || (e.type === "spawn" && e.kind !== "worker") || e.type === "match_end" || e.type === "chat" || e.type === "research_started" || e.type === "upgrade_completed" || e.type === "construction_started");
}

type Names = Record<string, string>;
type Colors = Record<string, number>;

function Who({ id, names, colors }: { id: string; names: Names; colors: Colors }) {
  return <Agent id={id} name={names[id]} color={colors[id]} />;
}

function EventText({ e, names, colors }: { e: GameEvent; names: Names; colors: Colors }) {
  const who = "owner" in e ? <Who id={e.owner} names={names} colors={colors} /> : null;
  switch (e.type) {
    case "death": return <>{who} lost a {displayKind(e.kind)}</>;
    case "spawn": return <>{who} {["knight", "ranger", "worker"].includes(e.kind) ? "trained" : "built"} a {displayKind(e.kind)}</>;
    case "chat": return <ChatText from={e.owner} text={e.text} channel={e.channel} to={e.to} names={names} colors={colors} />;
    case "eliminated": return <>{who} is out</>;
    case "match_end": return <b>The battle is over</b>;
    case "construction_started": return <>{who} started building a {displayKind(e.kind)}</>;
    case "research_started": return <>{who} researching {e.upgrade.replaceAll("_", " ")} L{e.level}</>;
    case "upgrade_completed": return <>{who} completed {e.upgrade.replaceAll("_", " ")} L{e.level}</>;
    default: return null;
  }
}

/** Public chat is the default and carries no tag; team and private say so. */
function ChatText({ from, text, channel, to, names, colors }: { from: string; text: string; channel?: string; to?: string; names: Names; colors: Colors }) {
  return <>
    <Who id={from} names={names} colors={colors} />
    {channel === "private" ? <span className="channel"> [private <Arrow dir="right" /> {to ? <Agent id={to} name={names[to]} color={colors[to]} /> : "?"}]</span> : channel === "team" && <span className="channel"> [team]</span>}: <q><Mentions text={text} names={names} colors={colors} /></q>
  </>;
}

/** Player ids in a message (agents write "p3 eliminated"), painted in that player's colour. */
function Mentions({ text, names, colors }: { text: string; names: Names; colors: Colors }) {
  const known = (id: string) => id in colors || id in names;
  return <>{text.split(/\b(p\d+)\b/i).map((part, i) => {
    const id = part.toLowerCase();
    return i % 2 && known(id) ? <span key={i} className={`mention pc${colors[id] ?? 0}`} title={names[id] && agentText(id, names[id])}>{part}</span> : part;
  })}</>;
}

/** Notable events, newest first, over the map (the video capture's overlay). */
export function EventFeed({ events, names, colors, tickMs = 100 }: { events: GameEvent[]; names: Names; colors: Colors; tickMs?: number }) {
  const lines = notableEvents(events).slice(-8).reverse();
  return (
    <div className="feed">
      {lines.map((e, i) => (
        <div key={`${e.tick}-${i}`} className="line">
          <span className="t">{fmtTime(e.tick * tickMs)}</span> <EventText e={e} names={names} colors={colors} />
        </div>
      ))}
    </div>
  );
}

/** True on phone-sized screens, where the side panel stacks under the map. */
export function useNarrow(query = "(max-width: 720px)") {
  const media = typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query) : null;
  const [narrow, setNarrow] = useState(media?.matches ?? false);
  useEffect(() => {
    if (!media) return;
    const change = () => setNarrow(media.matches);
    media.addEventListener("change", change);
    change();
    return () => media.removeEventListener("change", change);
  }, [query]);
  return narrow;
}

type Tab = "players" | "all" | "events" | "chat";
/** Desktop keeps the players above the log; a phone has no room, so they become a tab. */
const WIDE_TABS: Tab[] = ["all", "events", "chat"];
const NARROW_TABS: Tab[] = ["players", "events", "chat"];
const TAB_LABEL: Record<Tab, string> = { players: "Players", all: "All", events: "Events", chat: "Chat" };
/** Lines kept in the log; older ones are still a seek away on the timeline. */
const LOG_LINES = 300;

type Line = { tick: number; event: GameEvent; chat?: undefined } | { tick: number; chat: ChatMessage; event?: undefined };

/**
 * The right-hand panel of watch and replay: players on top, then the log
 * with its tabs. Both boxes have a fixed size and scroll inside.
 */
export function SidePanel({ players, seats = 2, events, chat, names, colors, tickMs, player, onSeek }: {
  players: ReactNode; seats?: number; events: GameEvent[]; chat: ChatMessage[]; names: Names; colors: Colors; tickMs: number;
  player: string | null; onSeek?: (tick: number) => void;
}) {
  const narrow = useNarrow();
  const tabs = narrow ? NARROW_TABS : WIDE_TABS;
  const [chosen, setChosen] = useState<Tab | null>(null);
  const tab = chosen && tabs.includes(chosen) ? chosen : tabs[0];

  // Chat read so far, for the unread count on the Chat tab.
  const [seen, setSeen] = useState(chat.length);
  const chatVisible = tab === "chat" || tab === "all";
  useEffect(() => { if (chatVisible || chat.length < seen) setSeen(chat.length); }, [chatVisible, chat.length, seen]);
  useEffect(() => setSeen(chat.length), [player]);
  const unread = chatVisible ? 0 : Math.max(0, chat.length - seen);

  const eventLines: Line[] = events.filter((e) => e.type !== "chat").map((event) => ({ tick: event.tick, event }));
  const chatLines: Line[] = chat.map((m) => ({ tick: m.tick, chat: m }));
  const lines = (tab === "events" ? eventLines : tab === "chat" ? chatLines
    : [...eventLines, ...chatLines].sort((a, b) => a.tick - b.tick)).slice(-LOG_LINES);

  return (
    <aside className={`side seats${seats > 2 ? 4 : 2}`}>
      {!narrow && <section className="side-players">{players}</section>}
      <section className="side-log">
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t} role="tab" aria-selected={t === tab} className={t === tab ? "on" : ""} onClick={() => setChosen(t)}>
              {TAB_LABEL[t]}{t === "chat" && unread > 0 && <span className="unread" aria-label={`${unread} unread`}>{unread}</span>}
            </button>
          ))}
        </div>
        {tab === "players"
          ? <div className="log-body">{players}</div>
          : <LogLines key={tab} lines={lines} empty={tab === "chat" ? "No messages" : "Nothing yet"} names={names} colors={colors} tickMs={tickMs} onSeek={onSeek} />}
      </section>
    </aside>
  );
}

/** Oldest first like a chat, pinned to the newest line unless the reader scrolled up. */
function LogLines({ lines, empty, names, colors, tickMs, onSeek }: { lines: Line[]; empty: string; names: Names; colors: Colors; tickMs: number; onSeek?: (tick: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const last = lines.at(-1);
  useLayoutEffect(() => {
    if (box.current && pinned.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines.length, last?.tick]);
  return (
    <div className="log-body" ref={box} onScroll={(e) => {
      const b = e.currentTarget;
      pinned.current = b.scrollHeight - b.scrollTop - b.clientHeight < 24;
    }}>
      {!lines.length && <div className="muted empty">{empty}</div>}
      {lines.map((l, i) => {
        const seek = onSeek && (() => onSeek(l.tick));
        return (
          <div key={`${l.tick}-${l.chat ? "c" : "e"}-${i}`} className={`line${l.chat ? " chat" : ""}${seek ? " seekable" : ""}`}
            {...(seek && { role: "button", tabIndex: 0, title: `Jump to ${fmtTime(l.tick * tickMs)}`, onClick: seek, onKeyDown: (e: KeyboardEvent) => { if (e.key === "Enter") seek(); } })}>
            <span className="t">{fmtTime(l.tick * tickMs)}</span>{" "}
            {l.chat
              ? <ChatText from={l.chat.from} text={l.chat.text} channel={l.chat.channel} to={l.chat.to} names={{ [l.chat.from]: l.chat.name, ...names }} colors={colors} />
              : <EventText e={l.event} names={names} colors={colors} />}
          </div>
        );
      })}
    </div>
  );
}

export function Tooltip({ hover, names = {}, colors = {} }: { hover: HoverInfo | null; names?: Names; colors?: Colors }) {
  if (!hover) return <div className="tooltip muted">drag to pan · scroll to zoom · hover a unit</div>;
  const e = hover.entity;
  const d = hover.deposit;
  return (
    <div className="tooltip">
      <span className="muted">({hover.x}, {hover.y})</span>{" "}
      {e && (
        <>
          <b>{displayKind(e.kind)}</b> {e.id} · <Agent id={e.owner} name={names[e.owner]} color={colors[e.owner]} /> · {e.hp}/{e.maxHp} hp{e.order ? ` · ${e.order}` : ""}
          {e.vital ? " · VITAL" : ""}
          {e.construction && ` · building ${e.construction.kind} (${e.construction.x},${e.construction.y})`}
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

/**
 * The clicked entity, kept at the bottom of the map: what it is and does now, and the
 * script its kind runs for its owner. `entity` is null while it is not visible (or dead);
 * `last` is the last time it was seen.
 */
export function UnitPanel({ entity, last, script, tickMs, names = {}, colors = {}, onClose }: {
  entity: EntityView | null; last: EntityView; script: LoadedScript | null | undefined; tickMs: number;
  names?: Names; colors?: Colors; onClose: () => void;
}) {
  const e = entity ?? last;
  const pct = Math.max(0, Math.min(100, (100 * e.hp) / Math.max(1, e.maxHp)));
  const details = [
    e.vital && "VITAL",
    e.ruin && "ruin",
    e.stats && `atk ${e.stats.atk} · def ${e.stats.def} · range ${e.stats.range} · attack ${e.stats.attackMs}ms${e.stats.moveMs ? ` · move ${e.stats.moveMs}ms` : ""}`,
    e.carrying ? `carrying ${e.carrying}` : "",
    e.construction && `building ${e.construction.kind} (${e.construction.x},${e.construction.y})`,
    e.training?.length ? `training ${e.training.map((t) => t.kind).join(", ")}` : "",
  ].filter(Boolean);
  return (
    <div className="unit-panel">
      <button className="unit-close" onClick={onClose} aria-label="close" title="close (Esc)">×</button>
      <div className="unit-head">
        <b>{displayKind(e.kind)}</b> {e.id} · <Agent id={e.owner} name={names[e.owner]} color={colors[e.owner]} /> · ({e.x}, {e.y})
        <span className="unit-hp"><span className={`unit-hp-bar bg${colors[e.owner] ?? 0}`} style={{ width: `${pct}%` }} /></span>{e.hp}/{e.maxHp} hp
      </div>
      {!entity && <div className="muted">not visible from this view</div>}
      {entity && <div>{e.order ? <>order: <b>{e.order}</b></> : "running its script"}{e.doing ? ` · now ${e.doing}` : e.heading ? ` · ${e.heading}` : ""}</div>}
      {details.length > 0 && <div className="muted">{details.join(" · ")}</div>}
      {script === undefined ? <div className="muted">loading script…</div> : script === null ? <div className="muted">no script</div> : (
        <div className="unit-script">
          <div className="muted">
            {displayKind(e.kind)} script of <Agent id={e.owner} name={names[e.owner]} color={colors[e.owner]} />: {script.custom ? `custom${script.sinceTick !== undefined ? `, loaded at ${fmtTime(script.sinceTick * tickMs)}` : ""}` : "default"}
            {e.order ? " · paused while the order runs" : ""}
          </div>
          <pre><code>{highlightJs(script.code.trim())}</code></pre>
        </div>
      )}
    </div>
  );
}

/** A clicked gold mine: where it is and how much is left. */
export function DepositPanel({ deposit, onClose }: { deposit: DepositView; onClose: () => void }) {
  return (
    <div className="unit-panel">
      <button className="unit-close" onClick={onClose} aria-label="close" title="close (Esc)">×</button>
      <div className="unit-head"><b>gold mine</b> {deposit.id} · ({deposit.x}, {deposit.y}) · {deposit.amount} left</div>
      {deposit.lastSeenMs !== undefined && <div className="muted">as last seen by this player at {fmtTime(deposit.lastSeenMs)}</div>}
    </div>
  );
}

/** The result over the map; `dismissible` lets the viewer fold it away to look at the field. */
export function OutcomeBanner({ view, names, colors = {}, dismissible, children }: { view: SpectatorView; names: Record<string, string>; colors?: Colors; dismissible?: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(true);
  const o = view.outcome;
  if (!o) return null;
  const winners = winnersOf(o);
  const title = winners.length ? <><Agents ids={winners} names={names} colors={colors} /> {winners.length > 1 ? "are" : "is"} victorious</> : "Stalemate";
  const reason = o.reason === "vital_lost" ? "a vital unit has fallen" : o.reason === "timeout" ? (winners.length ? "time ran out: victory on score under this replay's rules" : "time limit reached: draw") : "forfeit";
  if (!open) return <button className="banner-mini" onClick={() => setOpen(true)} title="show the result">{title}</button>;
  return (
    <div className="banner">
      {dismissible && <button className="banner-close" onClick={() => setOpen(false)} aria-label="hide the result" title="hide">×</button>}
      <div className="big">{title}</div>
      <div className="sub">{reason}</div>
      {children && <div className="banner-actions">{children}</div>}
    </div>
  );
}

/** Separate, shared preferences in every view. A press also unlocks browser audio. */
export function SoundToggle() {
  useSyncExternalStore(sfx.subscribe, sfx.snapshot);
  return (
    <div className="audio-controls" role="group" aria-label="Audio">
      <button className="sound" aria-pressed={!sfx.effectsMuted} onClick={() => sfx.setEffectsMuted(!sfx.effectsMuted)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4Z" />{sfx.effectsMuted ? <path d="m16 9 6 6m0-6-6 6" /> : <><path d="M15 8a6 6 0 0 1 0 8" /><path d="M18 5a10 10 0 0 1 0 14" /></>}</svg>
        <span>Sounds: {sfx.effectsMuted ? "off" : "on"}</span>
      </button>
      <button className="sound" aria-pressed={!sfx.musicMuted} onClick={() => sfx.setMusicMuted(!sfx.musicMuted)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13M9 9l11-2" /><ellipse cx="6" cy="18" rx="3" ry="2" /><ellipse cx="17" cy="16" rx="3" ry="2" />{sfx.musicMuted && <path d="m3 3 18 18" />}</svg>
        <span>Music: {sfx.musicMuted ? "off" : "on"}</span>
      </button>
    </div>
  );
}
