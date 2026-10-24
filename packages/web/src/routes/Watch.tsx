import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { pages, readMoment, type GameEvent, type Ruleset, type SpectatorMessage, type SpectatorView } from "@castellan/shared";
import { api, fmtTime, playerColors, spectateUrl } from "../api";
import { GameCanvas } from "../components/GameCanvas";
import { ViewerTop, DepositPanel, OutcomeBanner, SidePanel, SoundToggle, Tooltip, PlayerList, UnitPanel, notableEvents } from "../components/Hud";
import { useUnitSelection } from "../useSelection";
import { defaultScript } from "../scripts";
import { ReplayPlayer, writeUrl } from "./Replay";
import { Agent } from "../components/Agent";
import { Arrow } from "../components/Arrow";
import { playerPerspective } from "../perspective";
import { sfx } from "../audio/sfx";
import type { HoverInfo } from "../render/renderer";

export function Watch() {
  const { id } = useParams({ from: pages.watch });
  return <WatchPlayer key={id} id={id} syncUrl initialPlayer={readMoment(new URLSearchParams(location.search)).player} />;
}

export function WatchPlayer({ id, initialPlayer = null, syncUrl = false, series }: {
  id: string; initialPlayer?: string | null; syncUrl?: boolean;
  /** The series line, under the title of the player list. */
  series?: ReactNode;
}) {
  const [archived, setArchived] = useState(false);
  const room = useQuery({ queryKey: ["room", id], queryFn: () => api.room(id), retry: false, refetchInterval: archived ? false : 1000, refetchIntervalInBackground: true });
  const [ruleset, setRuleset] = useState<Ruleset | null>(null);
  const [tickMs, setTickMs] = useState(100);
  const [frame, setFrame] = useState<SpectatorView | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(initialPlayer);
  const [playerEvents, setPlayerEvents] = useState<Record<string, GameEvent[]>>({});
  const [lost, setLost] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => sfx.holdAmbient(), []);
  useEffect(() => sfx.holdMusic("battle"), []);

  useEffect(() => {
    if (room.error instanceof Error && room.error.message.startsWith("404 ")) setArchived(true);
  }, [room.error]);

  useEffect(() => {
    if (archived) return;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let ws: WebSocket | null = null;
    let closed = false;
    const connect = () => {
      if (closed) return;
      ws = new WebSocket(spectateUrl(id));
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data) as SpectatorMessage;
        if (msg.type === "hello") {
          setRuleset(msg.ruleset);
          setTickMs(1000 / msg.tickRate);
        }
        const view = msg.view;
        setFrame(view);
        if (view.perspectives) setPlayerEvents((old) => Object.fromEntries(Object.entries(view.perspectives!).map(([id, p]) => [id, [...(old[id] ?? []), ...notable(p.events)].slice(-KEPT)])));
        if (view.events?.length) setEvents((old) => [...old, ...notable(view.events)].slice(-KEPT));
        setLost(false);
      };
      ws.onclose = (event) => {
        if (closed) return;
        if (event.code === 4404) { setArchived(true); return; }
        if (event.code === 4403) { setDenied(true); return; }
        setLost(true);
        reconnect = setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(reconnect);
      ws?.close();
    };
  }, [id, archived]);

  const names = useMemo(() => Object.fromEntries((room.data?.players ?? []).map((p) => [p.id, p.name])), [room.data]);
  const colors = useMemo(() => playerColors(room.data?.players ?? []), [room.data]);
  // The websocket carries the current game status. Lobby polling can lag or
  // fail independently; an old "prep" response must not cover a running match.
  const display = playerPerspective(frame, selectedPlayer);
  const status = frame?.status ?? room.data?.status;
  const unit = useUnitSelection(display?.entities, display?.deposits);
  const shownUnit = unit.entity ?? unit.last;
  // The live room reports each player's scripts; polled only while a unit is selected.
  const scripts = useQuery({ queryKey: ["scripts", id], queryFn: () => api.roomScripts(id), enabled: !!shownUnit && !archived, refetchInterval: 2000 });
  const unitScript = !shownUnit || !ruleset ? undefined : !ruleset.kinds[shownUnit.kind]?.scriptable ? null
    : scripts.data ? scripts.data[shownUnit.owner]?.[shownUnit.kind] ?? defaultScript(ruleset, shownUnit.kind) : undefined;

  useEffect(() => { if (syncUrl) writeUrl({ player: selectedPlayer }); }, [syncUrl, selectedPlayer]);

  if (archived) return <ReplayPlayer key={id} id={id} initialPlaying={false} series={series} />;

  const shownEvents = selectedPlayer ? playerEvents[selectedPlayer] ?? notable(playerPerspective(frame ? { ...frame, events } : null, selectedPlayer)?.events ?? []) : events;
  const players = display?.players && <PlayerList selectedPlayer={selectedPlayer} onSelectPlayer={(id) => { setSelectedPlayer(id); setHover(null); }} onSelectUnit={unit.setSelected} colors={colors} view={display} names={names} subtitle={series} />;
  return (
    <div className="game viewer" onPointerDown={() => !sfx.muted && sfx.unlock()}>
      <div className="stage">
        {denied && <div className="banner small"><div className="big">Private live match</div><div className="sub">Open the spectator link provided when the match was created, or watch the replay after it finishes.</div></div>}
        {ruleset && Object.keys(colors).length > 0 && <GameCanvas key={selectedPlayer ?? "all"} ruleset={ruleset} colors={colors} frame={display} tickMs={tickMs} onHover={setHover} selected={unit.selected} onSelect={unit.setSelected} sound={sfx.play} />}
        {unit.deposit ? <DepositPanel deposit={unit.deposit} onClose={() => unit.setSelected(null)} />
          : unit.last ? <UnitPanel entity={unit.entity} last={unit.last} script={unitScript} scriptRuntime={display?.players.find(p => p.id === unit.last?.owner)?.scriptRuntime} tickMs={tickMs} names={names} colors={colors} reactiveOrders={ruleset?.reactiveOrders} viewer={selectedPlayer} onClose={() => unit.setSelected(null)} />
          : <Tooltip hover={hover} names={names} colors={colors} />}
        <ViewerTop view={display ?? null} />
        {!denied && status === "waiting" && (
          <div className="banner small">
            <div className="big">Waiting for the agents</div>
            <div className="sub">
              {room.data?.players.map((p, i) => <span key={p.id}>{i > 0 && " · "}<Agent id={p.id} name={p.name} color={colors[p.id]} />: {p.connected ? "connected" : "…"}</span>)}
            </div>
          </div>
        )}
        {!denied && status === "prep" && room.data?.prepEndsAt && <PrepBanner until={room.data.prepEndsAt} />}
        {frame?.outcome && <OutcomeBanner view={frame} names={names} colors={colors} dismissible>
          <Link to="/replay/$id" params={{ id }}>Watch the replay <Arrow dir="right" /></Link>
        </OutcomeBanner>}
      </div>
      <div className="controls">
        <span className={`live${lost ? " lost" : ""}`}>{denied ? "private" : status === "running" ? "● live" : status}</span>
        {lost && <span className="reconnecting">reconnecting…</span>}
        <span className="time">{frame?.timeMs !== undefined && `${fmtTime(frame.timeMs)} / ${fmtTime(frame.matchMs)}`}</span>
        <span className="spacer" />
        {status === "finished" && <Link to="/replay/$id" params={{ id }}>Watch the replay <Arrow dir="right" /></Link>}
        <SoundToggle />
      </div>
      <SidePanel players={players} seats={room.data?.players.length} events={shownEvents} chat={display?.chat ?? []} names={names} colors={colors} tickMs={tickMs} player={selectedPlayer} />
    </div>
  );
}

/** Lines kept per perspective while watching. */
const KEPT = 300;
const notable = (events: GameEvent[]) => notableEvents(events).filter((e) => e.type !== "chat");

function PrepBanner({ until }: { until: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.ceil((new Date(until).getTime() - now) / 1000));
  return (
    <div className="banner small">
      <div className="big">The battle begins in {s}</div>
      <div className="sub">the agents study the field and plan</div>
    </div>
  );
}
