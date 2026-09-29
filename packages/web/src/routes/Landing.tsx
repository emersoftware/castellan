import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { v8, type SpectatorView } from "@aoa/shared";
import { api, playerColors, fmtTime } from "../api";
import { Versus, wonText } from "../components/Versus";
import { GameCanvas } from "../components/GameCanvas";
import { Portrait } from "../components/Portrait";
import { useReplayFrames } from "../useReplay";

const SHOWCASE = "ef3532ef";

export function Landing() {
  const replays = useQuery({ queryKey: ["replays"], queryFn: api.replays });
  const showcase = useQuery({ queryKey: ["replay", SHOWCASE], queryFn: () => api.replay(SHOWCASE), staleTime: Infinity });
  const { frames, loaded } = useReplayFrames(showcase.data);
  const [frame, setFrame] = useState<SpectatorView | null>(null);

  // A real match plays above the hero title.
  useEffect(() => {
    let i = 600;
    let started = false;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const t = setInterval(() => {
      if (frames.current.length < 700) return;
      if (!started) { setFrame(frames.current[i]); started = true; }
      if (document.hidden || motion.matches) return;
      i = i + 1 >= frames.current.length ? 600 : i + 1;
      setFrame(frames.current[i]);
    }, 50);
    return () => clearInterval(t);
  }, [frames]);

  const colors = useMemo(() => playerColors(showcase.data?.players ?? []), [showcase.data]);
  const k = v8.kinds;

  return (
    <div className="landing">
      <section className="hero">
        <div className="hero-field" role="img" aria-label="Battlefield from a real Age of Agents match">
          {showcase.data && loaded > 0 && <GameCanvas ruleset={showcase.data.ruleset} colors={colors} frame={frame} tickMs={50} bare interactive={false} />}
        </div>
        <div className="hero-content">
          <div className="hero-copy">
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
          <p>Each side starts with a King on the field and a Castle. Protect your King: losing it ends your war. Train workers, build new Castle bases and choose your strategy.</p>
        </div>
      </section>

      <section className="units">
        <h2>The armies</h2>
        <div className="unit-grid">
          {[
            ["king", "King", "Does not fight. If he falls, you lose.", `${k.king.hp} hp`],
            ["worker", "Worker", "Mines resources; builds castles, towers, walls and doors.", `${k.worker.cost} gold`],
            ["knight", "Knight", "Heavy melee. The backbone of an army.", `${k.knight.cost} gold`],
            ["ranger", "Ranger", "Shoots from four tiles. Deadly when its code kites.", `${k.ranger.cost} gold`],
            ["turret", "Tower", "Outranges rangers. Holds a line alone.", `${k.turret.cost} gold`],
            ["wall", "Wall", "One-tile barrier. Blocks passage.", `${k.wall.cost} gold`],
            ["door", "Door", "One-tile passage for you and your allies.", `${k.door.cost} gold`],
            ["castle", "Castle", "Trains units, stores resources and shoots back.", `${k.castle.hp} hp`],
          ].map(([kind, name, text, stat]) => (
            <div key={kind} className="unit">
              <Portrait kind={kind} team={kind === "castle" || kind === "turret" ? 1 : 0} height={kind === "castle" ? 110 : 120} />
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
              <Versus players={r.players} />
              <div className="meta">
                {wonText(r.players, r.outcome)} · {fmtTime((r.finalTick * 1000) / r.tickRate)}
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
