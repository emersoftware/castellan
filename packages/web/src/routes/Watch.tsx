import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { GameEvent, Ruleset, SpectatorMessage, SpectatorView } from "@aoa/shared";
import { api, fmtTime, playerColors, spectateUrl } from "../api";
import { GameCanvas } from "../components/GameCanvas";
import { OutcomeBanner, SidePanel, SoundToggle, Tooltip, PlayerList, notableEvents } from "../components/Hud";
import { ReplayPlayer, writeUrl } from "./Replay";
import { Agent } from "../components/Agent";
import { playerPerspective } from "../perspective";
import { sfx } from "../audio/sfx";
import type { HoverInfo } from "../render/renderer";

export function Watch() {
  const { id } = useParams({ from: "/watch/$id" });
  return <WatchPlayer key={id} id={id} syncUrl initialPlayer={new URLSearchParams(location.search).get("pov")} />;
}

export function WatchPlayer({ id, initialPlayer = null, syncUrl = false }: { id: string; initialPlayer?: string | null; syncUrl?: boolean }) {
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
        setFrame(msg.view);
        if (msg.view.perspectives) setPlayerEvents((old) => Object.fromEntries(Object.entries(msg.view.perspectives!).map(([id, view]) => [id, [...(old[id] ?? []), ...notable(view.events)].slice(-KEPT)])));
        if (msg.view.events?.length) setEvents((old) => [...old, ...notable(msg.view.events)].slice(-KEPT));
        setLost(false);
      };
      ws.onclose = (event) => {
        if (closed) return;
        if (event.code === 4404) { setArchived(true); return; }
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

  useEffect(() => { if (syncUrl) writeUrl({ pov: selectedPlayer }); }, [syncUrl, selectedPlayer]);

  if (archived) return <ReplayPlayer key={id} id={id} initialPlaying={false} initialPlayer={selectedPlayer} />;

  const shownEvents = selectedPlayer ? playerEvents[selectedPlayer] ?? notable(playerPerspective(frame ? { ...frame, events } : null, selectedPlayer)?.events ?? []) : events;
  const players = display?.players && <PlayerList selectedPlayer={selectedPlayer} onSelectPlayer={(id) => { setSelectedPlayer(id); setHover(null); }} colors={colors} view={display} names={names} />;
  return (
    <div className="game viewer" onPointerDown={() => !sfx.muted && sfx.unlock()}>
      <div className="stage">
        {ruleset && Object.keys(colors).length > 0 && <GameCanvas key={selectedPlayer ?? "all"} ruleset={ruleset} colors={colors} frame={display} tickMs={tickMs} onHover={setHover} sound={sfx.play} />}
        <Tooltip hover={hover} names={names} colors={colors} />
        <div className="corner">
          <Link to="/battles">← Battles</Link>
        </div>
        {status === "waiting" && (
          <div className="banner small">
            <div className="big">Waiting for the agents</div>
            <div className="sub">
              {room.data?.players.map((p, i) => <span key={p.id}>{i > 0 && " · "}<Agent id={p.id} name={p.name} color={colors[p.id]} />: {p.connected ? "connected" : "…"}</span>)}
            </div>
          </div>
        )}
        {status === "prep" && room.data?.prepEndsAt && <PrepBanner until={room.data.prepEndsAt} />}
        {frame?.outcome && <OutcomeBanner view={frame} names={names} colors={colors} dismissible>
          <Link to="/replay/$id" params={{ id }}>Watch the replay →</Link>
        </OutcomeBanner>}
      </div>
      <div className="controls">
        <span className={`live${lost ? " lost" : ""}`}>{status === "running" ? "● live" : status}</span>
        {lost && <span className="reconnecting">reconnecting…</span>}
        <span className="time">{frame?.timeMs !== undefined && `${fmtTime(frame.timeMs)} / ${fmtTime(frame.matchMs)}`}</span>
        <span className="spacer" />
        {status === "finished" && <Link to="/replay/$id" params={{ id }}>Watch the replay →</Link>}
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
