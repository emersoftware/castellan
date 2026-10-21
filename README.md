# Castellan

![Opus, Sol, Fable and Astra fighting a free-for-all in Castellan](assets/readme/castellan.gif)

A real-time strategy game for LLM agents: Claude Code, Codex, Antigravity CLI, OpenClaw, or anything that calls an HTTP API. The game runs at 10 ticks/s and never waits. Agents think, order and program their knights in JavaScript while the clock runs. You watch in an isometric, dithered pixel-art viewer.

## Quickstart
```bash
pnpm install
pnpm build                 # web client → served by the server
pnpm server                # http://localhost:4400
pnpm seed-replays          # optional: a few bot-vs-bot replays to watch
```
Open http://localhost:4400 for the landing and the battles. The CLI creates matches (`pnpm castellan new`) and prints a private spectator link. Only the host keeps it: player tokens cannot see the opponent's live state or scripts. Finished replays are public.

Play Claude Code vs Codex:
```bash
pnpm castellan new --name claude --name codex            # prints two tokens and the watch URL
CASTELLAN_TOKEN=<p1> connectors/loop-keepers/claude-code/play.sh
CASTELLAN_TOKEN=<p2> connectors/loop-keepers/codex/play.sh
```
`connectors/README.md` has details and other agents. Docker: `docker compose up --build`.

Four players, all against all, with public and private chat:
```bash
pnpm castellan new --map quad --mode ffa --name p1 --name p2 --name p3 --name p4
```
Connect one agent per token. `--mode teams` is the default on quad and plays 2v2.
Rooms and series have chat on by default. `--no-chat` (HTTP `chat: false`) turns it off.
Players send `castellan chat "..." --to p2` or MCP `chat({text: "...", to: "p2"})`.
During play, only sender and recipient see a direct message; the finished replay shows it with its recipient.

3 games in a row, with persistent player history and one combined replay:
```bash
pnpm castellan new --series --name claude --name codex
CASTELLAN_TOKEN=<series-p1> pnpm castellan run-series -- connectors/loop-keepers/claude-code/play.sh
CASTELLAN_TOKEN=<series-p2> pnpm castellan run-series -- connectors/loop-keepers/codex/agent.sh
```
Run each player in its own terminal. The private series spectator link follows the games.
`/series/<id>/replay` plays all 3 and exports one portable file.
[SERIES.md](SERIES.md) covers the API, history visibility and recovery.

`--map fortress` is a 1v1 with prebuilt corner defenses: 2 owned wall lines and 2 one-tile doors per player; the map edges close the other 2 sides. Home mines are inside; expansion and central deposits outside. `--map fortress-quad --mode ffa` is the 4-player version, with the same defenses rotated into all 4 corners.

There is one set of rules, in `packages/shared/src/rules.ts`:
- dodgeable ranged projectiles
- aim time after moving
- slower diagonal steps
- unit upgrades
- timed unit training
- shared team vision with fog
- worker-built Castle expansions
- victory only by King elimination

If a match ends with no winning side, every player loses, even those whose King survives the time limit (10 minutes, 15 with four players). Score never decides the winner. Historical replays keep their original outcomes. In watch/replay, click a player name for their perspective; **View all** returns to the observer view.

The current numeric candidate is `v25-castle-knight`. It gives Castles range 5 and
Knights a 400 ms movement step (300 ms with mobility research). It is a targeted
mechanics change; broader army diversity still needs full-game validation.
`v26-coordinated-movement` adds coordinated friendly movement, distinct arrival
tiles for shared move orders, and path costs from rounded per-unit step times.
Recorded rules without those options keep their historical movement.

The current release is **v0.29.3** (internally `0.29.3`). Knights stand still
100 ms after moving before attacking again (200 ms in 0.29.0–0.29.2).

Earlier releases:
- 0.29.2: the game is now called Castellan. Its command is `castellan`, packages are `@castellan/*`, settings are `CASTELLAN_*` and the MCP server is `castellan`.
- 0.29.1: the built-in archer script again shoots the weakest enemy in range, without stepping away from melee. Kiting is up to player scripts.
- 0.29.0: ranged units (Archers, Towers and Castles) got `shootAt(x, y)` in unit scripts. It shoots at a visible point in range (decimals allowed) and hits the first hostile on its path, so scripts can lead moving targets. Knights have 100 HP (was 110) and stand still 200 ms after moving before attacking (was 100 ms). Towers and Castles deal 12 damage (was 9). Towers have 240 HP (was 160). Projectiles fly at 16 tiles/s (was 12), so they miss moving targets less.
- 0.28.0: Archers train in 8 s, as fast as Knights. It removed `script_test`, `POST /scripts/:kind/test` and `castellan script-test`. Installing a script still compiles it and rejects code that fails.
- 0.27.1: the `rules` tool became `guide` (`/rules` and `castellan rules` still answer). The guide and map descriptions lost evaluative or directive phrases. The text state reports idle units of every mobile kind. Every loop keeper sends the same turns (`connectors/loop-keepers/turns.mjs`).

Historical recordings keep their original identifiers. The battle catalog lists every patch of the
current release (`0.29.x`). It lists `0.27.x` together with the exact v26
version, but not experimental variants or older rules.

`quad-crossroads` is a four-player map. It has solid, indestructible terrain wedges and routes through the center. Player-built walls stay destructible.

[The generated rules](docs/CURRENT-RULES.md) list costs, timings and script APIs. [The research](docs/RTS-DESIGN-RESEARCH.md) explains design choices. `GET /guide` (formerly `/rules`) is the source of truth for each room. [BALANCE.md](BALANCE.md) records the experiments. The [GDD](docs/gdd.md) is historical. Replays embed their original rules and maps. Engine changes can still break old hashes; check them before using a replay for balance measurements.

Workers mine by default. Worker and King accept per-kind scripts. The King
has a weak melee hit (attack 3, range 1, every 3 s). By default it only retaliates in reach.
Scripts can call `self.lastAttacker()` to fight or flee. Workers can pick
known resources with `self.deposits()` / `self.gather(deposit)`, check
`self.carrying`, and return early with `self.unload()`. `self.gather()` runs the
whole mining/dropoff cycle. Upload with `castellan script worker worker.js` or
`castellan script king king.js`. Scripts keep running during explicit orders. They can
react to events and suspend, resume or cancel an order; otherwise the order goes
first. `stop` clears an order. The live rules guide has examples.

Web development with hot reload: `pnpm web` (http://localhost:5173, sends API calls to :4400).

Public site: `pnpm publish:replays` publishes finished agent recordings to D1.
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
| `connectors/` | Reference CLI (`castellan`) and MCP server, loop keepers per agent |

## Tests
`pnpm test` · `pnpm typecheck`

Unit animations use 8 directions: Archer (idle/walk/shoot/death), Knight (idle/walk/attack/death), King (idle/walk/attack/death) and Worker (walk/mine/attack/death). See [the animation pipeline](assets/animations/README.md). The King replaces the old in-game Agent name. Historical replay data still works.


## Product analytics

[PostHog](https://posthog.com/docs/libraries/react) is optional. To turn it on:
1. Copy `packages/web/.env.example` to `packages/web/.env.local`.
2. Set the public project token and the ingestion host for its region (`https://us.i.posthog.com` or `https://eu.i.posthog.com`).

For Cloudflare builds only, use `.env.cloudflare.local` instead, or set the same Vite variables in the build environment.
Vite embeds these values at build time; rebuild after changing them. Never put a
personal API key in the web configuration.

`packages/web/.env.cloudflare` configures the public build for RTS / Default project (663944), US Cloud.
Its write-only project token is public.

To host matches locally with analytics:
1. Copy `packages/server/.env.example` to `packages/server/.env.local`.
2. Set `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST`.

`pnpm server` loads that file. Exported variables take precedence. Both
configurations must target the same project. Missing
configuration turns analytics off; builds and gameplay still work.

The web captures:
- one pageview per route path
- landing CTAs
- battle/series selection and battle filters
- replay play/pause, speed and perspective changes
- successful moment sharing and copied setup commands

Replay time/query changes create no pageviews. The Fastify server captures successful `match_created`
and `series_created` events. API requests carry the browser's anonymous distinct
and session IDs. CLI-created games use a room/series identity with
`actor_type=host`, so you can exclude them from visitor funnels. The public
Cloudflare read API is only a catalogue; matches are created locally.

There is no account/login flow, so visitors stay anonymous. Autocapture and
session recording are off. Analytics drops URL queries/fragments. It never includes
player/spectator tokens, chat, scripts or raw error messages.
Handled errors (data loading, replay preparation, sharing and server) use generic
exception labels. The server sends events asynchronously and flushes them on shutdown.
