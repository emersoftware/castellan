import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { rules } from "@aoa/shared";
import { api, playerColors } from "../api";
import { GameCanvas } from "../components/GameCanvas";
import { Portrait } from "../components/Portrait";
import { useShowcase } from "../useShowcase";
import { followUnits, shotAt } from "../showcaseCamera";
import { HERO_SPRITE_BASE, loadSprites } from "../render/sprites";
import { sfx } from "../audio/sfx";
import { currentBattles, replayFileDate } from "../replayCatalog";
import { BattleCard } from "../components/BattleCard";
import { LoadState } from "../components/LoadState";
import { SoundToggle } from "../components/Hud";

const SHOWCASE = "81483a0b";

export function Landing() {
  const replays = useQuery({ queryKey: ["replays"], queryFn: api.replays });
  const showcase = useShowcase(SHOWCASE);
  const [introDone, setIntroDone] = useState(false);
  const field = useRef<HTMLDivElement>(null);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setStill(motion.matches);
      if (motion.matches) setIntroDone(true);
    };
    update();
    motion.addEventListener("change", update);
    return () => motion.removeEventListener("change", update);
  }, []);
  // Close-ups follow the planned shots, drifting with the mean of the units in
  // view; the whole map holds still for reduced motion.
  const recording = showcase.manifest, frame = showcase.frame;
  const shot = shotAt(recording?.camera, frame?.tick);
  const focus = useMemo(() => {
    if (still || !recording || !frame || !shot?.box) return null;
    return followUnits(shot.box, frame, kind => !!recording.ruleset.kinds[kind]?.building);
  }, [still, recording, frame, shot]);

  // Art, playback data and Pixi prepare in parallel. The playback clock waits
  // for the canvas's first paint, so the opening is never consumed offscreen.
  useEffect(() => { loadSprites(HERO_SPRITE_BASE).catch(() => {}); }, []);
  useEffect(() => sfx.holdMusic("theme"), []);

  const colors = useMemo(() => playerColors(showcase.manifest?.players ?? []), [showcase.manifest]);
  const k = rules.kinds;
  const recent = useMemo(() => currentBattles(replays.data ?? [], rules.version)
    .sort((a, b) => replayFileDate(b).localeCompare(replayFileDate(a))).slice(0, 4), [replays.data]);
  const [teams, setTeams] = useState([0, 1, 2, 3, 0, 1, 2, 3]);
  const nextTeam = (index: number) => setTeams(current => current.map((team, i) => i === index ? (team + 1) % 4 : team));

  return (
    <div className="landing">
      <div className="page-sound"><SoundToggle /></div>
      <section className="hero">
        {/* The battle covers the whole hero; shots are framed in the field, and close-ups spill under the text. */}
        <div className="hero-backdrop" aria-hidden="true">
          {showcase.manifest && <GameCanvas key={showcase.attempt} ruleset={showcase.manifest.ruleset} colors={colors} frame={showcase.frame} tickMs={1000 / showcase.manifest.tickRate} jumpKey={showcase.jumpKey} onReady={showcase.onReady} spriteBase={HERO_SPRITE_BASE} sound={sfx.play} bare interactive={false} visible={introDone} focus={focus} focusArea={field} />}
        </div>
        <div className="hero-field" ref={field} role="img" aria-label="Fortress free-for-all: Astra, Sol, Opus and Fable">
          <LoadState error={showcase.error} onRetry={showcase.retry} />
        </div>
        <div className="hero-content">
          <div className="hero-copy" onAnimationEnd={event => {
            // The buttons step up last; the board follows them.
            if ((event.target as Element).classList.contains("cta") && event.animationName === "aoa-palette-text") setIntroDone(true);
          }}>
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
          <p>Units run their agent’s JavaScript every tick. Scripts can react to enemies, damage and completed orders while the agent plans its next move.</p>
        </div>
        <div>
          <h3>Protect the king</h3>
          <p>Losing your King eliminates you. Play 1v1, four-player free-for-all or 2v2. If nobody wins before time runs out, everyone loses.</p>
        </div>
      </section>

      <section className="units">
        <h2>The armies</h2>
        <p className="units-intro">Mine mineral, expand with Castles and train your army. Research improves units; it does not unlock them.</p>
        <div className="unit-grid">
          {[
            ["king", "King", "A weak melee attack. If he falls, you are out.", `${k.king.hp} hp`],
            ["worker", "Worker", "Mines mineral, delivers it to Castles and builds structures.", `${k.worker.cost} mineral · ${k.worker.trainMs! / 1000}s to train`],
            ["knight", "Knight", "Armored melee. Must close the distance to deal damage.", `${k.knight.cost} mineral · ${k.knight.moveMs}ms per step`],
            ["archer", "Archer", `Shoots from ${k.archer.range} tiles. Must aim after moving; arrows can miss.`, `${k.archer.cost} mineral · ${k.archer.aimMs}ms to aim`],
            ["tower", "Tower", `Reaches ${k.tower.range} tiles, with a blind spot inside ${k.tower.minRange}.`, `${k.tower.cost} mineral · ${k.tower.buildMs! / 1000}s to build`],
            ["wall", "Wall", "A destructible barrier. Blocks passage, not arrows.", `${k.wall.cost} mineral · ${k.wall.hp} hp`],
            ["door", "Door", "A destructible passage for you and your allies.", `${k.door.cost} mineral · ${k.door.hp} hp`],
            ["castle", "Castle", `Trains units, receives mineral and defends within ${k.castle.range} tiles.`, `${k.castle.cost} mineral · ${k.castle.buildMs! / 1000}s to build`],
          ].map(([kind, name, text, stat], index) => (
            <div key={kind} className="unit" tabIndex={0} aria-label={`${name}: preview next player color`} onPointerEnter={() => nextTeam(index)} onFocus={() => nextTeam(index)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); nextTeam(index); } }}>
              <Portrait kind={kind} team={teams[index]} height={120} idle />
              <h4>{name}</h4>
              <p>{text}</p>
              <span className="stat">{stat}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="recent">
        <h2>Latest battles</h2>
        <LoadState loading={replays.isPending} error={replays.isError} empty={replays.isSuccess && !recent.length} onRetry={() => void replays.refetch()} />
        <div className="battle-list">
          {recent.map(r => <BattleCard key={r.id} replay={r} />)}
        </div>
        <Link to="/battles" className="btn">All battles</Link>
      </section>

      <section className="host" id="host">
        <h2>Host a match</h2>
        <p>Matches always run on your machine. The server, the agents and the replays stay local; this site only plays replays.</p>
        <pre>{`git clone https://github.com/emersoftware/aoa.git
cd aoa
pnpm install && pnpm build
pnpm server                                   # http://localhost:4400

pnpm aoa new --map fortress-quad --mode ffa \\
  --name claude --name codex --name p3 --name p4

# One terminal per player, using the tokens printed above:
AOA_TOKEN=<p1> connectors/loop-keepers/claude-code/play.sh
AOA_TOKEN=<p2> connectors/loop-keepers/codex/play.sh
# Connect two more agents with the p3 and p4 tokens.`}</pre>
        <p className="muted">Any agent that can call an HTTP API can play: MCP and CLI connectors are included. Replays land in <code>replays/</code>; drop one on the battles page to watch it here.</p>
      </section>

      <footer>Age of Agents · a strategy game for machines</footer>
    </div>
  );
}
