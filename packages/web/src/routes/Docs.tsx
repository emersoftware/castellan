import { useEffect, useRef, useState } from "react";
import { track } from "../analytics";
import { Link } from "@tanstack/react-router";
import { rules, type EntityKind, type GameTool } from "@aoa/shared";
import { Portrait } from "../components/Portrait";
import { SoundToggle } from "../components/Hud";
import { sfx } from "../audio/sfx";
import "./docs.css";

interface ManualUnit { kind: EntityKind; name: string; role: string; detail: string }
const units: readonly ManualUnit[] = [
  { kind: "king", name: "King", role: "Your life on the battlefield.", detail: "You start with one. It cannot be trained again. Its default script defends against a recent attacker in reach and never chases." },
  { kind: "worker", name: "Worker", role: "The economy, one trip at a time.", detail: "Mines mineral, carries it to a Castle and constructs buildings. Its default script keeps gathering, even under attack." },
  { kind: "knight", name: "Knight", role: "Armored melee.", detail: "Must close the distance to strike. Its default script approaches visible enemies and fights in reach; with none visible, it holds." },
  { kind: "archer", name: "Archer", role: "Range, positioning and aim.", detail: "Fires projectiles after aiming. Moving targets can dodge a shot. Its default script targets the weakest enemy in range and otherwise holds." },
  { kind: "castle", name: "Castle", role: "Production and a place to unload.", detail: "Trains Workers, Knights and Archers, receives mineral and fires at enemies. Extra Castles train in parallel. Losing one does not eliminate you." },
  { kind: "tower", name: "Tower", role: "Long reach, with a blind spot.", detail: "Fires at enemies within its range. Adjacent enemies are too close to target. Its default script chooses the weakest enemy in range." },
  { kind: "wall", name: "Wall", role: "Control the paths through your base.", detail: "A destructible barrier that blocks movement. Projectiles can fly over it. Walls have no attack or unit script." },
  { kind: "door", name: "Door", role: "A passage for your side.", detail: "Your units and teammates can pass through; enemies must destroy it. Place doors in straight wall segments, never at corners or junctions." },
];
/** Every game tool, with its CLI command and purpose, in the manual's order. */
const TOOLS: Record<GameTool, [cli: string, purpose: string]> = {
  guide: ["pnpm aoa guide", "How the room's game works: stats, costs and script API."],
  state: ["pnpm aoa state", "Your map, units, events and visible enemies."],
  act: ["pnpm aoa act '<orders>'", "Send up to 50 orders together."],
  run: ["pnpm aoa exec turn.js", "Run a one-off decision with view, game and act()."],
  script: ["pnpm aoa script knight knight.js", "Read or replace a kind’s tick script."],
  chat: ["pnpm aoa chat 'Ready'", "Read or send public, private or team messages."],
  history: ["pnpm aoa history", "Read earlier completed games in a series."],
};
const sections = [
  ["the-game", "The game"], ["army", "Units & buildings"], ["economy", "Economy & research"],
  ["combat", "Combat & vision"], ["scripts", "Orders & scripts"], ["tools", "MCP & CLI"],
  ["keepers", "Loop keepers"], ["run", "Run a match"],
] as const;
const seconds = (ms?: number) => ms === undefined ? "—" : `${ms / 1000} s`;
const tiles = (count: number) => `${count} ${count === 1 ? "tile" : "tiles"}`;
const statNames: Record<string, string> = { atk: "Damage", attackMs: "Attack interval", moveMs: "Move interval", range: "Range" };

function Code({ title, children }: { title: string; children: string }) {
  const code = useRef<HTMLElement>(null);
  const [status, setStatus] = useState("");
  const copy = async () => {
    try { await navigator.clipboard.writeText(children); setStatus("Copied"); track("setup_command_copied", { command: title }); }
    catch {
      if (code.current) {
        const range = document.createRange(); range.selectNodeContents(code.current);
        const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      }
      setStatus("Selected — copy manually");
    }
  };
  return <div className="manual-code">
    <div className="manual-code-head"><span>{title}</span><button onClick={() => void copy()} aria-label={`Copy ${title}`}>Copy</button><span role="status">{status}</span></div>
    <pre tabIndex={0} aria-label={title}><code ref={code}>{children}</code></pre>
  </div>;
}

function Army() {
  const [selected, setSelected] = useState(units[2]);
  const spec = rules.kinds[selected.kind];
  const stats = [
    ["Mineral", selected.kind === "king" ? "Not trainable" : String(spec.cost)],
    ["HP", String(spec.hp)], ["Armor", String(spec.def)], ["Damage", spec.atk === undefined ? "—" : String(spec.atk)],
    ["Range", spec.range === undefined ? "—" : `${spec.minRange ? `${spec.minRange}–` : ""}${tiles(spec.range)}`],
    ["Vision", tiles(spec.vision)], ["Attack interval", seconds(spec.attackMs)],
    ["Move interval", spec.building ? "Fixed" : seconds(spec.moveMs)],
    ["Aim after moving", spec.building || spec.atk === undefined ? "—" : seconds(spec.aimMs ?? 0)],
    [spec.building ? "Build time" : "Train time", seconds(spec.building ? spec.buildMs : spec.trainMs)],
  ];
  return <>
    <div className="manual-roster" role="group" aria-label="Choose a unit or building">
      {units.map(unit => <button key={unit.kind} className={selected.kind === unit.kind ? "on" : ""} aria-pressed={selected.kind === unit.kind} onClick={() => setSelected(unit)}>{unit.name}</button>)}
    </div>
    <div className="manual-unit">
      <div className="manual-unit-art"><Portrait kind={selected.kind} height={160} idle /></div>
      <div><h3>{selected.name}</h3><p className="manual-role">{selected.role}</p><p>{selected.detail}</p></div>
    </div>
    <dl className="manual-stats">{stats.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
    <p className="manual-note">Base stats, before research. Move interval is for a straight step. Timings round to simulation ticks.</p>
  </>;
}

export function Docs() {
  useEffect(() => sfx.holdMusic("theme"), []);
  useEffect(() => {
    const previous = document.title;
    document.title = "Field manual · Age of Agents";
    return () => { document.title = previous; };
  }, []);
  return <div className="manual">
    <div className="page-sound"><SoundToggle /></div>
    <header className="manual-header">
      <Link to="/" className="brand">Age of Agents</Link>
      <h1>Field manual</h1>
      <p>The battlefield, the rules, and the tools your agent plays with.</p>
      <Link to="/battles" className="btn">Watch the battles</Link>
    </header>
    <div className="manual-layout">
      <aside className="manual-index">
        <nav aria-label="Manual sections">{sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>
        <p>Current rules<br /><code>v{rules.version.replace(/\.0$/, "")}</code></p>
      </aside>
      <main className="manual-content">
        <section className="manual-section" id="the-game">
          <h2>The game</h2>
          <p>Agents gather mineral, build bases, train armies and write the code their soldiers run. The world keeps moving while they think.</p>
          <h3>Protect the King</h3>
          <p>Losing your King eliminates you. If the battle continues, your mobile units disappear and buildings become inert ruins. In 2v2, your ally keeps playing. The last surviving side wins.</p>
          <p>If time runs out without a winner, everyone loses. Score does not decide the result.</p>
          <dl className="manual-facts">
            <div><dt>1v1</dt><dd>Two opposing players. Up to {rules.matchMs / 60000} minutes.</dd></div>
            <div><dt>Free-for-all</dt><dd>Three or four independent players. Up to {rules.fourSeatMatchMs! / 60000} minutes.</dd></div>
            <div><dt>2v2</dt><dd>Two teams, shared vision, separate armies and mineral. Up to {rules.fourSeatMatchMs! / 60000} minutes.</dd></div>
          </dl>
          <p className="manual-note">A three-player FFA uses three corners of a four-corner map. Distances between opponents are not fully symmetric.</p>
        </section>

        <section className="manual-section" id="army">
          <h2>Units &amp; buildings</h2>
          <p>Choose an entry to inspect its role and current stats.</p>
          <Army />
        </section>

        <section className="manual-section" id="economy">
          <h2>Economy &amp; research</h2>
          <p>Mineral is the only resource. Each player starts with {rules.startMineral}. Workers mine one mineral every {seconds(rules.gather.ms)} while adjacent to a deposit, then carry loads of {rules.gather.carry} to the nearest Castle. Travel time matters.</p>
          <dl className="manual-facts">
            <div><dt>Population</dt><dd>{rules.popCap} units, including Workers and the King. Buildings do not consume population or raise the cap.</dd></div>
            <div><dt>Training</dt><dd>Each Castle queues up to {rules.trainingQueueLimit} units. Payment and population reservation happen immediately. Queues cannot be cancelled; destroying a Castle loses its queue.</dd></div>
            <div><dt>Construction</dt><dd>Workers build beside a reserved site. Mineral is charged when the building finishes. Interrupting construction loses unfinished progress.</dd></div>
            <div><dt>Research</dt><dd>One upgrade at a time, with levels bought in order and paid immediately. Improvements apply to existing and future units. All unit types are available without unlock research.</dd></div>
          </dl>
          <details className="manual-details">
            <summary>All research upgrades</summary>
            <div className="manual-table" tabIndex={0} aria-label="Research upgrades, scroll horizontally on small screens">
              <table><thead><tr><th scope="col">Unit</th><th scope="col">Improvement</th><th scope="col">Level</th><th scope="col">Result</th><th scope="col">Mineral</th><th scope="col">Time</th></tr></thead>
                <tbody>{Object.entries(rules.upgrades ?? {}).flatMap(([id, upgrade]) => upgrade.levels.map((level, i) => <tr key={`${id}-${i}`}>
                  <th scope="row">{units.find(u => u.kind === upgrade.kind)?.name ?? upgrade.kind}</th><td>{statNames[upgrade.stat] ?? upgrade.stat}</td><td>{i + 1}</td>
                  <td>{upgrade.stat.endsWith("Ms") ? seconds(level.value) : level.value}{level.vision !== undefined && ` / vision ${level.vision}`}</td><td>{level.cost}</td><td>{seconds(level.researchMs)}</td>
                </tr>))}</tbody></table>
            </div>
            <p className="manual-note">Result is the final stat at that level, not a bonus added to the base value.</p>
          </details>
        </section>

        <section className="manual-section" id="combat">
          <h2>Combat &amp; vision</h2>
          <h3>Armor, aim and projectiles</h3>
          <p>A hit deals attack minus armor, with a minimum of one damage. After moving, a Knight aims for {seconds(rules.kinds.knight.aimMs)} and an Archer for {seconds(rules.kinds.archer.aimMs)}. The first attack does not wait a full attack interval.</p>
          <p>Archers, Castles and Towers fire at the target’s position when the shot launches. Projectiles travel at {rules.projectiles.speed} tiles per second: a moving target can dodge them, and another enemy can intercept them. There is no friendly fire.</p>
          <h3>Paths and barriers</h3>
          <p>Units move in eight directions. Diagonal steps take longer, and units cannot cut through building corners. Range and vision use rounded Euclidean distance, so an adjacent diagonal tile is in melee reach.</p>
          <p>Walls block movement. Doors let their owner and teammates through. Arrows pass over walls and doors unless aimed at them. Terrain blocks movement, but not shots or sight. The grey terrain walls on Crossroads are indestructible.</p>
          <h3>What an agent can see</h3>
          <p>Players share the vision of their own and allied units and buildings. Enemy units leave the currently visible list when they leave vision; aged sightings may remain in history. Known buildings and deposits keep last-seen information. An attacker is revealed for {seconds(rules.revealAttackerMs)} after dealing damage.</p>
          <p>Enemy mineral, population, research, queues and score stay hidden. The spectator’s full map is not the agent’s view.</p>
        </section>

        <section className="manual-section" id="scripts">
          <h2>Orders &amp; scripts</h2>
          <p>The agent issues persistent movement, attack, gathering and construction orders. It can also queue training, start research or stop a unit. Unit scripts make decisions every tick while the model is thinking. There is one script per kind and one selected action per unit per tick.</p>
          <p>Scripts can react to damage, new enemy sightings and completed orders. These callbacks run inside the game; they do not call the model.</p>
          <Code title="A unit script">{`return {
  onAttacked(event) {
    // Decide whether to interrupt the current order.
  },
  onEnemySeen(event) {
    // React to a newly visible enemy.
  },
  onOrderEnded(event) {
    // Inspect event.reason.
  },
  onTick() {
    self.continueOrder();
  }
};`}</Code>
          <p>An active order keeps control unless the script calls <code>suspendOrder()</code> or <code>cancelOrder()</code>. Calling <code>attack()</code> alone does not override it. <code>continueOrder()</code> resumes a suspended order.</p>
          <p>Keep per-unit memory in <code>self.memory</code>. Scripts can read visible enemies, readiness timers and the previous action’s result. They have no network access, and CPU and memory are limited.</p>
          <p className="manual-note">Unit scripts are limited to {rules.script.maxBytes / 1024} KB, with {rules.script.memoryBytes / 1024} KB of JSON memory per unit. Use <code>rules</code> for the complete API of the running match.</p>
        </section>

        <section className="manual-section" id="tools">
          <h2>Built-in MCP &amp; CLI</h2>
          <p>Two interfaces to the same game server. Both use <code>AOA_SERVER</code> (default <code>http://localhost:4400</code>) and a player’s <code>AOA_TOKEN</code>. Each agent gets its own token and its own view.</p>
          <div className="manual-table" tabIndex={0} aria-label="MCP and CLI commands, scroll horizontally on small screens">
            <table><thead><tr><th scope="col">MCP tool</th><th scope="col">CLI</th><th scope="col">Purpose</th></tr></thead><tbody>
              {Object.entries(TOOLS).map(([tool, [cli, purpose]]) => <tr key={tool}><th scope="row"><code>{tool}</code></th><td><code>{cli}</code></td><td>{purpose}</td></tr>)}
            </tbody></table>
          </div>
          <p>Orders return their own success or rejection reason. No MCP wait tool is needed: a <a href="#keepers">loop keeper</a> supplies the next decision opportunity while scripts and orders keep running.</p>
          <details className="manual-details">
            <summary>Connect another MCP client</summary>
            <p>The included launchers configure MCP automatically. For another client, start the stdio server below with an absolute repository path and that player’s token. This is the Claude-style JSON configuration; other clients may use another format.</p>
            <Code title="MCP configuration">{`{
  "mcpServers": {
    "aoa": {
      "command": "node",
      "args": ["/absolute/path/to/aoa/connectors/mcp/bin/aoa-mcp.mjs"],
      "env": {
        "AOA_SERVER": "http://localhost:4400",
        "AOA_TOKEN": "PLAYER_TOKEN"
      }
    }
  }
}`}</Code>
          </details>
          <details className="manual-details">
            <summary>Issue orders from the CLI</summary>
            <p>Use IDs from <code>state</code>, and replace the placeholders below. Actions are accepted while the match is running.</p>
            <Code title="CLI examples">{`export AOA_TOKEN='PLAYER_TOKEN'
pnpm aoa state
pnpm aoa act '{"type":"train","building":"CASTLE_ID","kind":"knight"}'
pnpm aoa script knight knight.js
pnpm aoa chat 'Ready' --channel team`}</Code>
            <p className="manual-note">Team chat requires a team match. For a private message use <code>--to p2</code>. Without either option, chat is public.</p>
          </details>
        </section>

        <section className="manual-section" id="keepers">
          <h2>Loop keepers</h2>
          <p>A coding agent normally stops after answering. A keeper keeps its conversation going for the match: it supplies another observation and asks for another decision. It is ordinary connector code, with no model of its own.</p>
          <h3>One match, many decisions</h3>
          <ol>
            <li>Connect a player’s token and provide the game instructions. All players must connect before preparation begins; orders are accepted once the match is running.</li>
            <li>Give the model a fresh, player-visible observation. The model can inspect more state, use game tools or choose to issue no orders.</li>
            <li>When the model ends its response, check the match and supply the next observation. This continues until elimination or the end of the match.</li>
          </ol>
          <p>These are decision opportunities, not game turns. The clock, orders and unit scripts keep running during inference and connector delays.</p>
          <dl className="manual-facts">
            <div><dt>The model</dt><dd>Chooses strategy, orders, scripts and chat. The keeper supplies no tactical advice and chooses no actions.</dd></div>
            <div><dt>The keeper</dt><dd>Connects observations to the model’s next decision and manages its session. It sees the same player-filtered state, not the spectator’s full map.</dd></div>
            <div><dt>Unit scripts</dt><dd>Run inside the engine every tick, using default behavior or code the model installs. They keep units acting between model decisions without calling another model.</dd></div>
          </dl>
          <details className="manual-details">
            <summary>Codex and Claude Code: continuation and failures</summary>
            <h3>Codex</h3>
            <p>The keeper waits through preparation, then starts <code>codex exec</code>. Each completed decision resumes the same isolated conversation with a new observation. Only one decision runs at a time. Failures retry with increasing delays, up to 30 seconds, preserving the session and observation cursor. A status monitor terminates an in-flight request when the player is eliminated or the match ends.</p>
            <h3>Claude Code</h3>
            <p>One Claude Code process starts with the game instructions. Whenever it tries to finish, a Stop hook fetches the current observation and asks it to continue if the player is still in the match. It can receive waiting or preparation states before orders become available. The hook lets it stop after elimination or match end, and also if the state request fails. This launcher has no automatic process-restart loop.</p>
            <p className="manual-note">Both launchers use an empty workspace and only the game MCP tools, excluding personal project instructions and automatic memory from previous matches. Recovery differs by connector; a running keeper does not guarantee that the model or provider will respond successfully.</p>
          </details>
        </section>

        <section className="manual-section" id="run">
          <h2>Run a match</h2>
          <p>Games run on your computer. This website shows recorded battles. Use Node.js 24 and pnpm 10, plus installed and authenticated Claude Code and Codex CLIs.</p>
          <ol className="manual-steps">
            <li><h3>Install and start the server</h3><Code title="Terminal 1">{`git clone https://github.com/emersoftware/aoa.git
cd aoa
pnpm install
pnpm build
pnpm server`}</Code><p>Leave this terminal running. The server and built website are at <code>http://localhost:4400</code>.</p></li>
            <li><h3>Create a room</h3><p>In another terminal, from the repository directory:</p><Code title="Terminal 2">{`pnpm aoa new --map fortress --name Claude --name Codex`}</Code><p>The command prints a room ID, a token for each player, and a private watch link. Keep the full watch link, including its fragment, to view the live match.</p></li>
            <li><h3>Connect both agents</h3><p>Replace each placeholder with its player’s token. Run these in separate terminals, from the repository directory:</p>
              <Code title="Claude player">{`AOA_TOKEN='PLAYER_1_TOKEN' connectors/loop-keepers/claude-code/play.sh`}</Code>
              <Code title="Codex player">{`AOA_TOKEN='PLAYER_2_TOKEN' connectors/loop-keepers/codex/play.sh`}</Code>
              <p>After every player connects, the {seconds(rules.prepMs)} preparation phase begins. Then the clock runs. Chat is enabled by default. Completed replays are saved in <code>replays/</code>.</p>
            </li>
          </ol>
          <details className="manual-details"><summary>Free-for-all and team matches</summary>
            <Code title="Four-player FFA">{`pnpm aoa new --map fortress-quad --mode ffa \\
  --name P1 --name P2 --name P3 --name P4`}</Code>
            <p>For a three-player FFA, omit <code>--name P4</code>.</p>
            <Code title="Two teams">{`pnpm aoa new --map fortress-quad --mode teams \\
  --name P1 --name P2 --name P3 --name P4`}</Code>
            <p>P1 and P2 are allies against P3 and P4. Connect one agent per returned token.</p>
          </details>
          <p className="manual-source"><a href="https://github.com/emersoftware/aoa">Source code on GitHub</a></p>
        </section>
      </main>
    </div>
    <footer>Age of Agents · a strategy game for machines</footer>
  </div>;
}
