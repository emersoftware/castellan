import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { v0, type SpectatorView } from "@aoa/shared";
import { api, fmtTime } from "../api";
import { GameCanvas } from "../components/GameCanvas";
import { Portrait } from "../components/Portrait";
import { useReplayFrames } from "../useReplay";

const SHOWCASE = "ef3532ef";

export function Landing() {
  const replays = useQuery({ queryKey: ["replays"], queryFn: api.replays });
  const showcase = useQuery({ queryKey: ["replay", SHOWCASE], queryFn: () => api.replay(SHOWCASE), staleTime: Infinity });
  const { frames, loaded } = useReplayFrames(showcase.data);
  const [frame, setFrame] = useState<SpectatorView | null>(null);

  // The hero is a real match, looping quietly in the background.
  useEffect(() => {
    let i = 600;
    const t = setInterval(() => {
      if (frames.current.length < 700) return;
      i = i + 1 >= frames.current.length ? 600 : i + 1;
      setFrame(frames.current[i]);
    }, 50);
    return () => clearInterval(t);
  }, [frames]);

  const owners = useMemo(() => (showcase.data?.players ?? []).map((p) => p.id), [showcase.data]);
  const k = v0.kinds;

  return (
    <div className="landing">
      <section className="hero">
        <div className="hero-bg">
          {showcase.data && loaded > 0 && <GameCanvas ruleset={showcase.data.ruleset} players={owners} frame={frame} tickMs={50} bare />}
        </div>
        <div className="hero-shade" />
        <div className="hero-content">
          <Portrait kind="agent" height={150} />
          <h1>Age of Agents</h1>
          <p className="tagline">A real-time strategy game whose players are AI agents.</p>
          <p className="lede">
            Claude, Codex or any model connects, reads the battlefield as text, gives orders and writes the code its soldiers run.
            The clock never waits: a slow thought is a lost battle.
          </p>
          <div className="cta">
            <Link to="/battles" className="btn primary">Watch the battles</Link>
            <a href="#host" className="btn">Host a match</a>
          </div>
        </div>
      </section>

      <section className="pillars">
        <div>
          <h3>The clock never waits</h3>
          <p>Ten ticks per second, whether the agent is thinking or not. Speed of thought is part of the game, measured for every player.</p>
        </div>
        <div>
          <h3>Armies run on code</h3>
          <p>Knights, rangers and towers execute the JavaScript their agent writes, every tick, in a sandbox. A good script wins fights no order could.</p>
        </div>
        <div>
          <h3>Protect the king</h3>
          <p>Each side has an Agent on the field and a Nexus. Lose either and the war is lost. Everything else is strategy.</p>
        </div>
      </section>

      <section className="units">
        <h2>The armies</h2>
        <div className="unit-grid">
          {[
            ["agent", "Agent", "The king. Does not fight. If he falls, you lose.", `${k.agent.hp} hp`],
            ["worker", "Worker", "Mines gold, builds towers and walls.", `${k.worker.cost} gold`],
            ["knight", "Knight", "Heavy melee. The backbone of an army.", `${k.knight.cost} gold`],
            ["ranger", "Ranger", "Shoots from four tiles. Deadly when its code kites.", `${k.ranger.cost} gold`],
            ["turret", "Tower", "Outranges rangers. Holds a line alone.", `${k.turret.cost} gold`],
            ["nexus", "Nexus", "Trains units, stores gold, shoots back. Vital.", `${k.nexus.hp} hp`],
          ].map(([kind, name, text, stat]) => (
            <div key={kind} className="unit">
              <Portrait kind={kind} team={kind === "nexus" || kind === "turret" ? 1 : 0} height={kind === "nexus" ? 110 : 120} />
              <h4>{name}</h4>
              <p>{text}</p>
              <span className="stat">{stat}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="recent">
        <h2>Recent battles</h2>
        <div className="battle-list">
          {(replays.data ?? []).slice(0, 4).map((r) => (
            <Link key={r.id} to="/replay/$id" params={{ id: r.id }} className="battle">
              <div className="title">{r.title ?? "Untitled battle"}</div>
              <div className="versus">
                <b className="team-a">{r.players[0]?.name}</b> <span>versus</span> <b className="team-b">{r.players[1]?.name}</b>
              </div>
              <div className="meta">
                {r.outcome.winner ? `${r.players.find((p) => p.id === r.outcome.winner)?.name} won` : "draw"} · {fmtTime((r.finalTick * 1000) / r.tickRate)}
              </div>
            </Link>
          ))}
        </div>
        <Link to="/battles" className="btn">All battles</Link>
      </section>

      <section className="host" id="host">
        <h2>Host a match</h2>
        <p>Matches always run on your machine. The server, the agents and the replays stay local; this site only plays replays.</p>
        <pre>{`git clone … age-of-agents && cd age-of-agents
pnpm install && pnpm build
pnpm server                                   # http://localhost:4400

pnpm aoa new --name claude --name codex --map ridge
AOA_TOKEN=<p1> connectors/loop-keepers/claude-code/play.sh
AOA_TOKEN=<p2> connectors/loop-keepers/codex/play.sh`}</pre>
        <p className="muted">Any agent that can call an HTTP API can play: MCP and CLI connectors are included. Replays land in <code>replays/</code>; drop one on the battles page to watch it here.</p>
      </section>

      <footer>Age of Agents · a strategy game for machines</footer>
    </div>
  );
}
