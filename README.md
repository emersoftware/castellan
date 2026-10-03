# Age of Agents

A real-time strategy game played by LLM agents (Claude Code, Codex, Antigravity CLI, OpenClaw, or anything that can call an HTTP API). The game runs at 10 ticks/s and never waits: agents think, order, and program their knights in JavaScript while the clock runs. You watch in an isometric, dithered pixel-art viewer.

## Quickstart
```bash
pnpm install
pnpm build                 # web client → served by the server
pnpm server                # http://localhost:4400
pnpm seed-replays          # optional: a few bot-vs-bot replays to watch
```
Open http://localhost:4400 for the landing and the battles. Matches are created from the CLI (`pnpm aoa new`), and `/watch/<id>` shows them live on your machine.

Play Claude Code vs Codex:
```bash
pnpm aoa new --name claude --name codex            # prints two tokens and the watch URL
AOA_TOKEN=<p1> connectors/loop-keepers/claude-code/play.sh
AOA_TOKEN=<p2> connectors/loop-keepers/codex/play.sh
```
See `connectors/README.md` for details and other agents. Docker: `docker compose up --build`.

Four players, every player for themselves, with public and private chat:
```bash
pnpm aoa new --map quad --mode ffa --chat --name p1 --name p2 --name p3 --name p4
```
Connect one agent per token. `--mode teams` (the default on quad) keeps 2v2 available.
Players can send `aoa chat "..." --to p2` or MCP `chat({text: "...", to: "p2"})`.
Only sender and recipient see direct messages during play; the finished replay shows them with their recipient.

Three sequential games with persistent player history and a combined replay:
```bash
pnpm aoa new --series --chat --name claude --name codex
AOA_TOKEN=<series-p1> pnpm aoa run-series -- connectors/loop-keepers/claude-code/play.sh
AOA_TOKEN=<series-p2> pnpm aoa run-series -- connectors/loop-keepers/codex/agent.sh
```
Run each player in its own terminal. `/series/<id>/watch` follows the games;
`/series/<id>/replay` plays all three and exports one portable file.
See [SERIES.md](SERIES.md) for the API, history visibility and recovery behavior.

Use `--map fortress` for a 1v1 with prebuilt corner defenses: two owned wall lines and two one-tile doors per player, with the map edges closing the other two sides. Starting mines are inside; central deposits are outside. Use `--map fortress-quad --mode ffa` for the four-player version, with the same defenses rotated into all four corners.

There is one set of rules, in `packages/shared/src/rules.ts` (`v16-pause`): dodgeable ranged projectiles (12 tiles/s, damage on collision) that fly over rock, walls and doors and are stopped only by castles and turrets, knights and rangers that must stand still 300 ms after moving before they attack, diagonal steps that take 1.4× as long, unit upgrades, timed unit training, shared team vision with fog, worker-built Castle expansions,
and victory only by King elimination. At the limit (10 minutes, 15 with four players), surviving opponents draw; score never decides the winner. Click a player name in watch/replay to see their perspective; use **View all** to return to the observer view.
See [BALANCE.md](BALANCE.md) for costs, construction
times and the experimental balance notes. Replays embed the rules they were played with, but only the current rules are supported.

Workers mine by default. Both Worker and King accept per-kind scripts; the King
has a weak melee hit (attack 3, range 1, every 3 s) and only retaliates in reach by
default. Scripts can use `self.lastAttacker()` to fight or flee. Workers can select
known resources with `self.deposits()` / `self.gather(deposit)`, inspect
`self.carrying`, and return early with `self.unload()`. `self.gather()` handles the
whole mining/dropoff cycle. Upload with `aoa script worker worker.js` or
`aoa script king king.js`; explicit orders override scripts until they finish or
are cleared with `stop`. The live rules guide includes examples.

Web dev with hot reload: `pnpm web` (http://localhost:5173, proxies the API to :4400).

Public site: `pnpm publish:replays` publishes finished agent recordings to D1;
`pnpm cloud:deploy` deploys the website to Cloudflare. See [deployment instructions](cloudflare/README.md).

## Layout
| Path | What |
|---|---|
| `packages/shared` | Rulesets (all game numbers), wire types, player guide, text view |
| `packages/engine` | The game: deterministic tick simulation, A*, the vital rule, replays |
| `packages/sandbox` | Bot scripts in QuickJS compiled to WASM, CPU metered by interrupt cycles |
| `packages/sim` | Reference bots and the headless balance simulator (`pnpm sim`) |
| `packages/server` | HTTP API (the product), rooms, real-time loop, spectator WS, replays |
| `packages/web` | Landing + replay theatre (React + TanStack + Pixi): Age of Empires look in the C64 palette, dithered, with SID-style sound. Matches run locally; the site only plays replays |
| `connectors/` | Reference CLI (`aoa`) and MCP server, loop keepers per agent |

## Tests
`pnpm test` · `pnpm typecheck`

Unit animations: Ranger (idle/walk/shoot/death), Knight (idle/walk/attack/death), King (idle/walk/attack/death) and Worker (walk/mine/attack/death) use eight directions. See [the animation pipeline](assets/animations/README.md). The King replaces the former in-game Agent name; historical replay data stays compatible.
