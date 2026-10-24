import { useSyncExternalStore, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ChatChannel, ChatMessage, DepositView, EntityView, GameEvent, Outcome, PlayerStats, SpectatorView } from "@castellan/shared";
import { eventKind, eventOwner, NEUTRAL_OWNER, scriptOrigin, winnersOf } from "@castellan/shared";
import { Link } from "@tanstack/react-router";
import type { HoverInfo } from "../render/renderer";
import { fmtTime } from "../api";
import { Agent, Agents, agentText } from "./Agent";
import { Arrow } from "./Arrow";
import { sfx } from "../audio/sfx";
import type { LoadedScript } from "../scripts";
import { highlightJs } from "../highlight";

/**
 * The score list, as in Age of Empires: the clock (with the title on its left
 * in watch and replay), then every player in its colour with mineral,
 * population, kills and score, grouped by team in 2v2. With `onSelectPlayer`
 * a last column of eye buttons picks whose view the map shows, "all" at the bottom.
 * Under a player, the entities its hacks control (selectable with `onSelectUnit`)
 * and how many of its own the view shows hacked.
 */
export function PlayerList({ view, names, colors, selectedPlayer, onSelectPlayer, onSelectUnit, subtitle }: {
  view: SpectatorView; names: Record<string, string>; colors: Record<string, number>;
  selectedPlayer?: string | null; onSelectPlayer?: (player: string | null) => void;
  onSelectUnit?: (id: string) => void;
  /** A line under the title (the series). */
  subtitle?: ReactNode;
}) {
  const teams = [...new Set(view.players.map((p) => p.team))];
  const grouped = teams.length < view.players.length;
  const cols = onSelectPlayer ? 6 : 5;
  return (
    <div className="scores">
      <div className="clock">
        {onSelectPlayer && <span className="brand-head">Castellan</span>}
        <span><span className="time">{fmtTime(view.timeMs)}</span> <span className="sub">/ {fmtTime(view.matchMs)}</span></span>
      </div>
      {subtitle && <div className="scores-subtitle">{subtitle}</div>}
      <table>
        <thead>
          <tr><th /><th>mineral</th><th>pop</th><th>kills</th><th>score</th>{onSelectPlayer && <th className="view">view</th>}</tr>
        </thead>
        {teams.map((t, i) => (
          <tbody key={t}>
            {grouped && <tr className="team"><td colSpan={cols}>Team {i + 1}</td></tr>}
            {view.players.filter((p) => p.team === t).map((p) => (
              <PlayerRows key={p.id} cols={cols} p={p} selected={selectedPlayer === p.id} onSelect={onSelectPlayer ? () => onSelectPlayer(p.id) : undefined} name={names[p.id] ?? p.name} color={colors[p.id] ?? 0}
                hypno={<HypnoRow cols={cols} entities={view.entities} player={p.id} onSelectUnit={onSelectUnit} />} />
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

/**
 * The top of the map: the way back, and on phones also the title, the clock and the
 * audio switches (icons only), which on wider screens live in the side panel and controls.
 */
export function ViewerTop({ view }: { view: SpectatorView | null }) {
  return (
    <div className="corner viewer-top">
      <Link to="/battles"><Arrow dir="left" /> Battles</Link>
      <span className="viewer-top-title">
        <span className="brand-head">Castellan</span>
        {view && <span className="viewer-top-clock"><span className="time">{fmtTime(view.timeMs)}</span> <span className="sub">/ {fmtTime(view.matchMs)}</span></span>}
      </span>
      <SoundToggle />
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

/**
 * A player's hacks as this view shows them: what it controls (a view names the controller only to that player and
 * full observers) and how many of its own run another player's script. Absent when there are neither.
 */
function HypnoRow({ entities, player, cols, onSelectUnit }: { entities: EntityView[]; player: string; cols: number; onSelectUnit?: (id: string) => void }) {
  const controls = entities.filter((e) => e.controller === player);
  const compromised = entities.filter((e) => e.owner === player && e.hypno).length;
  if (!controls.length && !compromised) return null;
  return (
    <tr className="hypno">
      <td colSpan={cols}>
        HYPNO{controls.length > 0 && <> · controls {controls.length}:{controls.map((e) => onSelectUnit
          ? <button key={e.id} className="hypno-unit" title={`Select ${e.kind} ${e.id}`} onClick={() => onSelectUnit(e.id)}>{e.kind} {e.id}</button>
          : <span key={e.id} className="hypno-unit">{e.kind} {e.id}</span>)}</>}
        {compromised > 0 && ` · ${compromised} of its own hacked`}
      </td>
    </tr>
  );
}

/** Why a player's scripts or connector are not running, when they aren't. */
function playerNotice({ scriptRuntime, agentActivity }: PlayerStats): string | null {
  if (scriptRuntime) return `Scripts stopped at tick ${scriptRuntime.tick}: ${scriptRuntime.message}`;
  switch (agentActivity?.state) {
    case "provider_wait": return `Provider retry pending${agentActivity.retryAt ? ` until ${agentActivity.retryAt}` : ""}`;
    case "connector_retry": return "Connector retry pending";
    case "stopped": return "Connector stopped";
    default: return null;
  }
}

function PlayerRows({ p, cols, name, color, selected, onSelect, hypno }: { cols: number; selected?: boolean; onSelect?: () => void; p: PlayerStats; name: string; color: number; hypno: ReactNode }) {
  const notice = playerNotice(p);
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
        <td>{p.mineral ?? "—"}</td>
        <td>{p.pop ?? "—"}/{p.popCap}{p.queuedPop ? ` (+${p.queuedPop})` : ""}</td>
        <td>{p.kills ?? "—"}</td>
        <td>{p.score ?? "—"}</td>
        {onSelect && <td className="view"><ViewButton on={!!selected} label={`View as ${name} (${p.id})`} onClick={onSelect} /></td>}
      </tr>
      {notice && <tr><td colSpan={cols}>{notice}</td></tr>}
      {hypno}
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
  return events.filter((e) => (e.type === "death" && !out.has(`${e.tick}:${e.owner}`)) || e.type === "eliminated" || (e.type === "spawn" && e.kind !== "worker") || e.type === "match_end" || e.type === "chat" || e.type === "research_started" || e.type === "upgrade_completed" || e.type === "construction_started" || e.type === "converted" || e.type === "hypno");
}

type Names = Record<string, string>;
type Colors = Record<string, number>;

function Who({ id, names, colors }: { id: string; names: Names; colors: Colors }) {
  return <Agent id={id} name={names[id]} color={colors[id]} />;
}

function EventText({ e, names, colors }: { e: GameEvent; names: Names; colors: Colors }) {
  const owner = eventOwner(e);
  const who = owner !== undefined ? <Who id={owner} names={names} colors={colors} /> : null;
  const kind = eventKind(e) ?? "";
  const namedKind = `${/^[aeiou]/i.test(kind) ? "an" : "a"} ${kind}`;
  switch (e.type) {
    case "death": return e.owner === NEUTRAL_OWNER ? <>Neutral wall destroyed</> : <>{who} lost {namedKind}</>;
    // A spawn comes from a builder's construction or from a building's training.
    case "spawn": return <>{who} {e.builder ? "built" : "trained"} {namedKind}</>;
    case "chat": return <ChatText from={e.owner} text={e.text} channel={e.channel} to={e.to} names={names} colors={colors} />;
    case "eliminated": return <>{who} is out</>;
    case "match_end": return <b>The battle is over</b>;
    case "construction_started": return <>{who} started building {namedKind}</>;
    case "research_started": return <>{who} researching {e.upgrade.replaceAll("_", " ")} L{e.level}</>;
    case "upgrade_completed": return <>{who} completed {e.upgrade.replaceAll("_", " ")} L{e.level}</>;
    case "converted": return <><Who id={e.owner} names={names} colors={colors} /> converted {namedKind} {e.id} from <Who id={e.from} names={names} colors={colors} /></>;
    // Only the hack's controller and observers receive `controller`; the owner learns that it happened, not by whom.
    case "hypno": return e.active
      ? <>{e.controller ? <><Who id={e.controller} names={names} colors={colors} /> hacked</> : "Hacked:"} {who}’s {kind} {e.id}</>
      : <>{who}’s {kind} {e.id} no longer runs a hack</>;
    default: return null;
  }
}

/** Public chat is the default and carries no tag; team and private say so. */
function ChatText({ from, text, channel, to, names, colors }: { from: string; text: string; channel?: ChatChannel; to?: string; names: Names; colors: Colors }) {
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
function useNarrow(query = "(max-width: 720px)") {
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

/** A Wizard's ability in use; the channel time appears only where the view carries it (whoever runs its script, and observers). */
function castingText({ action, target, progressMs }: NonNullable<EntityView["casting"]>): string {
  const channel = progressMs === undefined ? "" : ` · ${(progressMs / 1000).toFixed(1)} s channelled`;
  return action === "heal" ? `healing ${target}` : `channelling ${action} on ${target}${channel}`;
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
          <b>{e.kind}</b> {e.id} · <Agent id={e.owner} name={names[e.owner]} color={colors[e.owner]} /> · {e.hp}/{e.maxHp} hp{e.order ? ` · ${e.order}${e.orderSuspended ? " (suspended)" : ""}` : ""}
          {e.vital ? " · VITAL" : ""}
          {e.construction && ` · building ${e.construction.kind} (${e.construction.x},${e.construction.y})`}
          {e.stats && ` · atk ${e.stats.atk} · def ${e.stats.def} · range ${e.stats.range} · attack ${e.stats.attackMs}ms · move ${e.stats.moveMs}ms`}
          {e.doing ? ` · ${e.doing}` : e.heading ? ` · ${e.heading}` : ""}
          {e.casting && ` · ${castingText(e.casting)}`}
          {e.hypno && <> · HYPNO{e.controller && <> by <Agent id={e.controller} name={names[e.controller]} color={colors[e.controller]} /></>}</>}
        </>
      )}
      {d && (
        <>
          <b>mineral mine</b> {d.id} · {d.amount} left
        </>
      )}
      {hover.rock && <b>impassable rock</b>}
      {hover.terrainWall && <b>indestructible terrain wall</b>}
    </div>
  );
}

/**
 * The clicked entity, kept at the bottom of the map: what it is and does now, and the
 * script its kind runs for its owner. `entity` is null while it is not visible (or dead);
 * `last` is the last time it was seen. `viewer` is the player whose view the map shows: only
 * an entity's owner and its hack's controller can tell whether a hack replaced that script.
 */
export function UnitPanel({ entity, last, script, scriptRuntime, tickMs, names = {}, colors = {}, reactiveOrders = false, viewer = null, onClose }: {
  entity: EntityView | null; last: EntityView; script: LoadedScript | null | undefined; tickMs: number;
  scriptRuntime?: PlayerStats["scriptRuntime"]; viewer?: string | null;
  names?: Names; colors?: Colors; reactiveOrders?: boolean; onClose: () => void;
}) {
  const e = entity ?? last;
  // Abilities and hacks only from the current view: `last` may come from another perspective or an earlier moment.
  const { hypno, controller, casting, rechargeMs }: Partial<EntityView> = entity ?? {};
  const hackHidden = !!viewer && e.owner !== viewer && !hypno;
  const pct = Math.max(0, Math.min(100, (100 * e.hp) / Math.max(1, e.maxHp)));
  const details = [
    e.vital && "VITAL",
    e.ruin && "ruin",
    e.stats && `atk ${e.stats.atk} · def ${e.stats.def} · range ${e.stats.range} · attack ${e.stats.attackMs}ms${e.stats.moveMs ? ` · move ${e.stats.moveMs}ms` : ""}`,
    e.carrying ? `carrying ${e.carrying}` : "",
    e.construction && `building ${e.construction.kind} (${e.construction.x},${e.construction.y})`,
    e.training?.length ? `training ${e.training.map((t) => t.kind).join(", ")}` : "",
    casting && castingText(casting),
    rechargeMs !== undefined && `hack and convert ready in ${(rechargeMs / 1000).toFixed(1)} s`,
  ].filter(Boolean);
  return (
    <div className="unit-panel">
      <button className="unit-close" onClick={onClose} aria-label="close" title="close (Esc)">×</button>
      <div className="unit-head">
        <b>{e.kind}</b> {e.id} · <Agent id={e.owner} name={names[e.owner]} color={colors[e.owner]} /> · ({e.x}, {e.y})
        <span className="unit-hp"><span className={`unit-hp-bar${e.owner === NEUTRAL_OWNER ? "" : ` bg${colors[e.owner] ?? 0}`}`} style={{ width: `${pct}%`, ...(e.owner === NEUTRAL_OWNER ? { background: "var(--grey)" } : {}) }} /></span>{e.hp}/{e.maxHp} hp
      </div>
      {!entity && <div className="muted">not visible from this view</div>}
      {entity && <div>{e.ruin ? "Inert, destructible ruin" : e.order ? <>order: <b>{e.order}</b>{e.orderSuspended ? " (suspended by script)" : ""}</> : hypno ? "running a hack’s script" : hackHidden ? "script not visible from this view" : scriptRuntime ? "script stopped" : script === null ? "no script" : "running its script"}{e.doing ? ` · now ${e.doing}` : e.heading ? ` · ${e.heading}` : ""}</div>}
      {hypno && <div><b>HYPNO</b> · {controller ? <>controlled by <Agent id={controller} name={names[controller]} color={colors[controller]} /></> : "hacked by an unknown player"}; its owner’s orders and script uploads do not apply until a Wizard hacks it back</div>}
      {!e.ruin && scriptRuntime && <div>Scripts stopped at {fmtTime(scriptRuntime.tick * tickMs)}: {scriptRuntime.message}</div>}
      {details.length > 0 && <div className="muted">{details.join(" · ")}</div>}
      {e.ruin ? null : hypno ? <div className="muted">The installed code is private to the hack’s controller.</div> : script === undefined ? <div className="muted">loading script…</div> : script === null ? <div className="muted">no script</div> : (
        <div className="unit-script">
          <div className="muted">
            {e.kind} script of <Agent id={e.owner} name={names[e.owner]} color={colors[e.owner]} />: {`${scriptOrigin(script)}${script.custom && script.sinceTick !== undefined ? `, loaded at ${fmtTime(script.sinceTick * tickMs)}` : ""}`}
            {scriptRuntime ? " · inactive: VM stopped" : !e.order ? "" : reactiveOrders ? " · runs during orders" : " · paused while the order runs"}
            {hackHidden && " · a hack could replace it without this view showing it"}
          </div>
          <pre><code>{highlightJs(script.code.trim())}</code></pre>
        </div>
      )}
    </div>
  );
}

/** A clicked mineral mine: where it is and how much is left. */
export function DepositPanel({ deposit, onClose }: { deposit: DepositView; onClose: () => void }) {
  return (
    <div className="unit-panel">
      <button className="unit-close" onClick={onClose} aria-label="close" title="close (Esc)">×</button>
      <div className="unit-head"><b>mineral mine</b> {deposit.id} · ({deposit.x}, {deposit.y}) · {deposit.amount} left</div>
      {deposit.lastSeenMs !== undefined && <div className="muted">as last seen by this player at {fmtTime(deposit.lastSeenMs)}</div>}
    </div>
  );
}

function outcomeReason(o: Outcome): string {
  if (o.reason === "vital_lost") return o.allDefeated ? "no surviving side: everyone loses" : "a vital unit has fallen";
  if (o.reason !== "timeout") return "forfeit";
  if (winnersOf(o).length) return "time ran out: victory on score under this replay's rules";
  return o.allDefeated ? "time limit reached: everyone loses" : "time limit reached: draw";
}

/** The result over the map; `dismissible` lets the viewer fold it away to look at the field. */
export function OutcomeBanner({ view, names, colors = {}, dismissible, children }: { view: SpectatorView; names: Record<string, string>; colors?: Colors; dismissible?: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(true);
  const o = view.outcome;
  if (!o) return null;
  const winners = winnersOf(o);
  const title = winners.length ? <><Agents ids={winners} names={names} colors={colors} /> {winners.length > 1 ? "are" : "is"} victorious</> : o.allDefeated ? "All players defeated" : "Stalemate";
  const reason = outcomeReason(o);
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
      <button className="sound" aria-pressed={!sfx.effectsMuted} title={`Sounds: ${sfx.effectsMuted ? "off" : "on"}`} onClick={() => sfx.setEffectsMuted(!sfx.effectsMuted)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4Z" />{sfx.effectsMuted ? <path d="m16 9 6 6m0-6-6 6" /> : <><path d="M15 8a6 6 0 0 1 0 8" /><path d="M18 5a10 10 0 0 1 0 14" /></>}</svg>
        <span>Sounds: {sfx.effectsMuted ? "off" : "on"}</span>
      </button>
      <button className="sound" aria-pressed={!sfx.musicMuted} title={`Music: ${sfx.musicMuted ? "off" : "on"}`} onClick={() => sfx.setMusicMuted(!sfx.musicMuted)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13M9 9l11-2" /><ellipse cx="6" cy="18" rx="3" ry="2" /><ellipse cx="17" cy="16" rx="3" ry="2" />{sfx.musicMuted && <path d="m3 3 18 18" />}</svg>
        <span>Music: {sfx.musicMuted ? "off" : "on"}</span>
      </button>
    </div>
  );
}
