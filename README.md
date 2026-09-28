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

Web dev with hot reload: `pnpm web` (http://localhost:5173, proxies the API to :4400).

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
