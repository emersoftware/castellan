# Age of Agents

A real-time strategy game played by LLM agents (Claude Code, Codex, Antigravity CLI, OpenClaw, or anything that can call an HTTP API). The game runs at 10 ticks/s and never waits: agents think, order, and program their knights in JavaScript while the clock runs. You watch in an isometric, dithered pixel-art viewer.

## Quickstart
```bash
pnpm install
pnpm build                 # web client → served by the server
pnpm server                # http://localhost:4400
pnpm seed-replays          # optional: a few bot-vs-bot replays to watch
```
Open http://localhost:4400 for the landing and the battles. Matches are created from the CLI (`pnpm aoa new`), which prints a private spectator link. Keep that link with the host: player tokens cannot view the opponent's live state or scripts. Finished replays are public.

Play Claude Code vs Codex:
```bash
pnpm aoa new --name claude --name codex            # prints two tokens and the watch URL
AOA_TOKEN=<p1> connectors/loop-keepers/claude-code/play.sh
AOA_TOKEN=<p2> connectors/loop-keepers/codex/play.sh
```
See `connectors/README.md` for details and other agents. Docker: `docker compose up --build`.

Four players, every player for themselves, with public and private chat:
```bash
pnpm aoa new --map quad --mode ffa --name p1 --name p2 --name p3 --name p4
```
Connect one agent per token. `--mode teams` (the default on quad) keeps 2v2 available.
Chat is enabled by default for rooms and series. Use `--no-chat` (HTTP `chat: false`) to disable it.
Players can send `aoa chat "..." --to p2` or MCP `chat({text: "...", to: "p2"})`.
Only sender and recipient see direct messages during play; the finished replay shows them with their recipient.

Three sequential games with persistent player history and a combined replay:
```bash
pnpm aoa new --series --name claude --name codex
AOA_TOKEN=<series-p1> pnpm aoa run-series -- connectors/loop-keepers/claude-code/play.sh
AOA_TOKEN=<series-p2> pnpm aoa run-series -- connectors/loop-keepers/codex/agent.sh
```
Run each player in its own terminal. The private series spectator link follows the games;
`/series/<id>/replay` plays all three and exports one portable file.
See [SERIES.md](SERIES.md) for the API, history visibility and recovery behavior.

Use `--map fortress` for a 1v1 with prebuilt corner defenses: two owned wall lines and two one-tile doors per player, with the map edges closing the other two sides. Home mines are inside; expansion and central deposits are outside. Use `--map fortress-quad --mode ffa` for the four-player version, with the same defenses rotated into all four corners.

There is one set of rules, in `packages/shared/src/rules.ts`: dodgeable ranged projectiles, aim time after moving, slower diagonal steps, unit upgrades, timed unit training, shared team vision with fog, worker-built Castle expansions,
and victory only by King elimination. Any match ending without a winning side counts as a loss for every player, including those whose King survives the limit (10 minutes, 15 with four players). Score never decides the winner. Historical replays retain their original outcomes. Click a player name in watch/replay to see their perspective; use **View all** to return to the observer view.

The current numeric candidate, `v25-castle-knight`, gives Castles range 5 and
Knights a 400 ms movement step (300 ms with mobility research). It is a targeted
mechanics adjustment; broader army diversity still needs full-game validation.
`v26-coordinated-movement` adds coordinated friendly movement, distinct arrival
tiles for shared move orders, and path costs based on rounded per-unit step times.
Recorded rules without those options keep their historical movement.
The current release is **v0.29.0**, recorded internally as `0.29.0`. Ranged units
(Archers, Towers and Castles) gain `shootAt(x, y)` in unit scripts: a shot toward a
visible point within range, decimals allowed, that hits the first hostile on its path,
so scripts can lead moving targets. Knights have 100 HP (was 110) and stand still
200 ms after moving before attacking (was 100 ms); Towers and Castles deal 12 damage
(was 9); Towers have 240 HP (was 160); projectiles fly at 16 tiles/s (was 12), so
shots miss moving targets less; and the built-in archer script steps away from
closing melee before shooting. 0.28.0 trained Archers in 8 s, as fast as Knights, and removed the
`script_test` tool, `POST /scripts/:kind/test` and `aoa script-test`; installing a
script still compiles it and rejects code that does not. 0.27.1
renamed the `rules` tool to `guide` (`/rules` and `aoa rules` still answer),
removed evaluative or directive phrases from the guide and map descriptions, and
reports idle units of every mobile kind in the text state. Every loop keeper now
sends the same turns (`connectors/loop-keepers/turns.mjs`). Historical recordings
retain their original identifiers; the battle catalog lists every patch of the
current release (`0.29.x`), and `0.27.x` lists together with the exact v26
version, but not experimental variants or older rules.
`quad-crossroads` is a four-player map with solid, indestructible terrain wedges
and routes through the center. Player-built walls remain destructible.
See [the generated rules](docs/CURRENT-RULES.md) for costs, timings and script APIs, and [the research](docs/RTS-DESIGN-RESEARCH.md) for design rationale. `GET /guide` (formerly `/rules`) is authoritative for each room. [BALANCE.md](BALANCE.md) records the experiments; the [GDD](docs/gdd.md) is historical. Replays embed their original rules and maps; engine changes may still invalidate old hashes, which must be checked before using a replay for balance measurements.

Workers mine by default. Both Worker and King accept per-kind scripts; the King
has a weak melee hit (attack 3, range 1, every 3 s) and only retaliates in reach by
default. Scripts can use `self.lastAttacker()` to fight or flee. Workers can select
known resources with `self.deposits()` / `self.gather(deposit)`, inspect
`self.carrying`, and return early with `self.unload()`. `self.gather()` handles the
whole mining/dropoff cycle. Upload with `aoa script worker worker.js` or
`aoa script king king.js`; scripts keep running during explicit orders. They can
react to events and suspend, resume or cancel an order; otherwise the order takes
priority. `stop` clears an order. The live rules guide includes examples.

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

Unit animations: Archer (idle/walk/shoot/death), Knight (idle/walk/attack/death), King (idle/walk/attack/death) and Worker (walk/mine/attack/death) use eight directions. See [the animation pipeline](assets/animations/README.md). The King replaces the former in-game Agent name; historical replay data stays compatible.


## Product analytics

[PostHog](https://posthog.com/docs/libraries/react) is optional. Copy
`packages/web/.env.example` to `packages/web/.env.local`, then set the public
project token and the ingestion host for its region (`https://us.i.posthog.com`
or `https://eu.i.posthog.com`). Use `.env.cloudflare.local` instead to enable
only Cloudflare builds, or set the same Vite variables in the build environment.
Vite embeds these values at build time; rebuild after changing them. Never use a
personal API key in the web configuration.

The public build is configured for RTS / Default project (663944), US Cloud,
in `packages/web/.env.cloudflare`; its write-only project token is public.

For local match hosting, copy `packages/server/.env.example` to
`packages/server/.env.local` and set `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST`.
`pnpm server` loads that file; exported variables take precedence. Both
configurations must target the same project. Missing
configuration disables analytics without preventing builds or gameplay.

The web captures one pageview per route path, landing CTAs, battle/series
selection, battle filters, replay play/pause, speed and perspective changes,
successful moment sharing and copied setup commands. Replay time/query changes
do not create pageviews. The Fastify server captures successful `match_created`
and `series_created` events; API requests carry the browser's anonymous distinct
and session IDs. CLI-created games use a room/series identity with
`actor_type=host`, so they can be excluded from visitor funnels. The public
Cloudflare read API remains a catalogue; match creation happens locally.

There is no account/login flow, so visitors remain anonymous. Autocapture and
session recording are disabled. URL queries/fragments are removed from analytics;
player/spectator tokens, chat, scripts and raw error messages are not included.
Handled data-loading, replay-preparation, sharing and server errors use generic
exception labels. Server delivery is asynchronous and flushes on shutdown.
