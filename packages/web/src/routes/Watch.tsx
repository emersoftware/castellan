import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { GameEvent, Ruleset, SpectatorMessage, SpectatorView } from "@aoa/shared";
import { api, playerColors, spectateUrl } from "../api";
import { GameCanvas } from "../components/GameCanvas";
import { EventFeed, OutcomeBanner, SoundToggle, Tooltip, PlayerList } from "../components/Hud";
import { sfx } from "../audio/sfx";
import type { HoverInfo } from "../render/renderer";

export function Watch() {
  const { id } = useParams({ from: "/watch/$id" });
  const room = useQuery({ queryKey: ["room", id], queryFn: () => api.room(id), refetchInterval: 1000, refetchIntervalInBackground: true });
  const [ruleset, setRuleset] = useState<Ruleset | null>(null);
  const [tickMs, setTickMs] = useState(100);
  const [frame, setFrame] = useState<SpectatorView | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    const connect = () => {
      ws = new WebSocket(spectateUrl(id));
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data) as SpectatorMessage;
        if (msg.type === "hello") {
          setRuleset(msg.ruleset);
          setTickMs(1000 / msg.tickRate);
        }
        setFrame(msg.view);
        if (msg.view.events.length) setEvents((old) => [...old, ...msg.view.events.filter((e) => e.type !== "attack")].slice(-200));
        setLost(false);
      };
      ws.onclose = () => {
        if (closed) return;
        setLost(true);
        setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }, [id]);

  const names = useMemo(() => Object.fromEntries((room.data?.players ?? []).map((p) => [p.id, p.name])), [room.data]);
  const colors = useMemo(() => playerColors(room.data?.players ?? []), [room.data]);
  // The websocket carries the current game status. Lobby polling can lag or
  // fail independently; an old "prep" response must not cover a running match.
  const status = frame?.status ?? room.data?.status;

  return (
    <div className="game" onPointerDown={() => !sfx.muted && sfx.unlock()}>
      {ruleset && Object.keys(colors).length > 0 && <GameCanvas ruleset={ruleset} colors={colors} frame={frame} tickMs={tickMs} onHover={setHover} sound={sfx.play} />}
      {frame && <PlayerList colors={colors} view={frame} names={names} timing={room.data?.timing} />}
      <EventFeed events={events} names={names} colors={colors} />
      <Tooltip hover={hover} />
      <div className="corner">
        <Link to="/battles">← Battles</Link> <span className="live">{status === "running" ? "● live" : status}</span> <SoundToggle />
        {lost && <span className="muted"> reconnecting…</span>}
      </div>
      {status === "waiting" && (
        <div className="banner small">
          <div className="big">Waiting for the agents</div>
          <div className="sub">
            {room.data?.players.map((p) => `${p.name}: ${p.connected ? "connected" : "…"}`).join(" · ")}
          </div>
        </div>
      )}
      {status === "prep" && room.data?.prepEndsAt && <PrepBanner until={room.data.prepEndsAt} />}
      {frame && <OutcomeBanner view={frame} names={names} />}
      {status === "finished" && (
        <div className="corner right">
          <Link to="/replay/$id" params={{ id }}>Watch the replay →</Link>
        </div>
      )}
    </div>
  );
}

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
