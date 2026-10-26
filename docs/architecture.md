# Architecture

Castellan is a real-time strategy game for LLM agents. A deterministic engine simulates
the match, a server exposes it as an HTTP API, and agents play through connectors.
The API is the only contract with players; the web client only watches.

```
 Player side (anything)            Game server (Node, Fastify)
 ┌──────────────┐  HTTP API   ┌──────────────────────────────────┐
 │ LLM agent    │────────────►│ @castellan/server                │
 │ + connector  │             │  rooms · series · replay archive │
 │ (CLI, MCP,   │             │  └ @castellan/engine             │
 │  keeper, …)  │             │     └ @castellan/sandbox (QuickJS│
 └──────────────┘             │        per player, in a worker)  │
                              └───────────────┬──────────────────┘
                                   WebSocket (spectators only)
                                              ▼
                              @castellan/web (React + Pixi)
```

Agents are never inside the tick. Unit scripts carry the real-time play; agents
change orders and scripts at their own pace while the clock runs.

## Packages

| Path | Owns | Depends on |
|---|---|---|
| `packages/shared` | Rulesets and maps (every game number), wire types, HTTP routes and limits, the player guide, text views, geometry, outcome readings, the local data location | — |
| `packages/sandbox` | QuickJS (WebAssembly) script execution and deterministic budgets | shared |
| `packages/engine` | The deterministic match, replays and re-simulation | shared, sandbox |
| `packages/bots` | Reference bots (`rush`, `eco`, `turtle`, `kite`, `archers`) that play from a player view | shared |
| `packages/sim` | Headless simulation and balance tools (`pnpm sim`) | shared, engine, bots |
| `packages/server` | Rooms, series, authorization, the replay archive, script workers, the experiment record | shared, engine, sandbox, bots |
| `packages/web` | Landing, battle catalogue, replay and live viewers, docs page | shared, engine |
| `connectors/` | The `castellan` CLI and its HTTP client, the MCP server, one loop keeper per harness, Castellan Bot, the autonomous player, the open arena | cli, shared |
| `cloudflare/` | The public site's Worker and the replay catalogue in D1 | shared (by path) |
| `assets/` | Source art, music and sounds, with their generators; `packages/web/public/game-assets` holds the served copies | — |
| `tools/` | The Ousterhout design audit (`pnpm design:audit`) and rating tools | — |

Rule of thumb: game numbers change in `packages/shared`, never in a connector or the renderer.
The engine knows nothing about the network or wall-clock time; the server knows no connector.

## Player API

The token goes in `Authorization: Bearer <token>`; the server listens on port 4400.
Add `?format=text` for the compact text form. Actions answer with their result and
the player's view, and events default to "since your last view", so an agent never
needs a separate `state` call. Routes are grouped by who may call them
(`packages/server/src/routes/`).

| Audience | Routes |
|---|---|
| Player (token) | `GET /guide`, `GET /state?since=T`, `POST /act {orders}`, `POST /run {code, lang?}`, `GET/POST /chat`, `GET/PUT /scripts/:kind`, `GET /wait?since&max&until`, `GET /history` |
| Harness metadata (token, not a game call) | `GET /status`, `POST /agent-config`, `POST /agent-status`, `GET /series/current` |
| Lobby | `POST /rooms`, `POST /series` |
| Spectator (host link, or anyone after the match) | `WS /spectate/:id`, `GET /rooms/:id/scripts` |
| Public | `GET /health`, `GET /maps`, `GET /rooms[/:id]`, `GET /replays[/:id]`, `GET /series[/:id]`, `GET /series/:id/replay.json` |

Limits live in `API_LIMITS` and `RUN_LIMITS` (`packages/shared/src/http.ts`): at most
50 orders per player per tick (each extra order gets a rejection), chat of 200
characters once per 3 s across channels, history pages of 50 (max 100).
`GET /guide` is the source of truth for a room's rules.

## Match lifecycle and tick

`waiting` → every seat made an authenticated call → `prep` (60 s, skipped when all
players are bots; reading only: orders and scripts are refused) → `running` →
`finished`. Calls are independent: a silent agent keeps its scripts running.

Each tick (`Match.step`): research and training that finish now → orders, alternating
player priority every tick → scripts (reactive scripts run beside orders) →
movement in player priority → combat, all hits before deaths → economy and
construction → deaths → Wizards' heals and channel completions on the survivors →
the vital rule and the victory check → events.
The King is the vital unit: a side whose Kings all fall loses; a match with no
winning side is a loss for everyone.

## Determinism and replays

Corner maps rotate a common layout as before. Maps with explicit `origins`
translate their local starts and deposits to each seat without rotation; this
supports the six-seat `hex` FFA. The engine validates those origins and occupied
tiles before allocating VMs. [Map design and measured routes](maps.md) document
the geometry and its limits; lobby, guide and mineral rendering consume the same
embedded map data.

- No `Date` or unseeded randomness in the engine or scripts; `self.random()` is seeded.
  Iteration follows creation order and seats, so mirrored play stays mirrored.
- Script budgets count QuickJS interrupt cycles, not milliseconds.
- A replay holds the ruleset, seed, players, every applied order (scripts already
  stripped of types), a state hash every 100 ticks and the final tick.
- `resimulate` (`packages/engine/src/replay.ts`) is the one re-simulation loop for replays,
  room checkpoints, series history and balance battles. `runReplay` is strict: it refuses
  recordings with a sandbox operational failure. Viewers use `recordingWithShutdowns`,
  which reproduces recorded VM shutdowns and never counts as a balance sample.
- Old replays must keep verifying: `npx tsx packages/engine/scripts/verify-replays.ts`.
  A recording must stop where it did, not only match its hashes.
- Every recording uses today's names and spells out every rule field; the code keeps no
  adapters for older formats. On 2026-10-22 the archive was rewritten that way, and each
  rewrite was checked to play the same game frame by frame, perspectives included; where
  model scripts were renamed, also the same script logs, script errors and order results. Changed
  names got new hashes; replays that never verified keep their recorded mismatch. Originals
  are in `~/.local/share/castellan/replays-original/`. Older mechanics remain plain rule options
  (`drawsAreLosses`, `reactiveOrders`, `coordinatedMovement`, `tickPathCosts`,
  `revealAttackerMs`, `scriptSight`, `projectiles.blindSpot`).
- Inside the engine, `Board` owns tile occupancy, doors and construction sites; every
  static change bumps the path version. Movement, combat, vision, order progress,
  `Production` (training, research and what each player may do now) and `UnitScripts`
  (each player's VM, what a script sees and the events it hears) and `Abilities` (Wizards' heal, hack and
  convert: eligibility, seeded channels, recharge) are separate collaborators.
  Outside code reaches a match only through its API, `stage` (staged scenarios) and `resimulate`.

## Script sandbox

- One QuickJS runtime per player, with heap and stack from the ruleset's `script`
  limits (`heapBytes` 8 MiB, `stackBytes` 256 KiB; older recordings get 256 KiB). A
  `/run` call uses `RUN_LIMITS` (16 KiB code, 32 MiB heap, 2,500 interrupt cycles).
- Uploads are at most 4 KB. The server strips TypeScript types with esbuild and compiles
  the script before it is installed; a failed upload keeps the previous script.
- Each tick the world loads into the VM once, then one call runs per unit. Every VM call
  after the trusted prelude is metered: `gasPerUnit` per unit and `gasPerPlayer` per tick.
  Out of gas → `hold()` and a script error. Intrinsics and globals are frozen.
- `Date`, `WeakRef` and `FinalizationRegistry` are removed; `Math.random` is seeded.
  `self.memory` is JSON, at most 1 KB per unit; a memory that grows past that or cannot
  be serialized is reset, and the reset is reported even when the script also threw.
- A hack installs a payload for one entity: it is compiled once, when the channel starts, as a named script
  in the deciding player's VM (`setScript(name, code)`, the same operation in the worker), and the entity runs
  it there with that player's gas, sight and memory. Ownership and control changes list the entity in
  `ScriptWorld.forget`, so every VM that ran it starts its memory over.
- The first action call counts; none → `hold()`. The engine re-validates every action.
  `self` exposes readiness (`attackReadyInTicks`, `moveReadyInTicks`, …), `canMove(dir)`
  (`null` when it would need unseen tiles) and `lastActionResult`.
- Live rooms run each player's VM in a Node worker thread with an emergency
  wall-clock deadline of 250 ms per request (startup: 10 s). After a timeout the VM stays
  terminated: actions hold with an explicit error, memory is never silently reset, and
  the failure goes into `experiment.operationalFailures`. Offline simulation and browser
  replay use the synchronous adapter. A waiting room starts no workers; a finished room
  releases them at once while its views and replay stay readable.

## Isolation and access

- Player tokens are per match and seat. A player sees only its own fog-of-war view and
  the chat it may read; private and team messages are hidden from live spectators and
  appear in the replay.
- Creating a room returns `/watch/<id>#spectator=<token>`: the only live view of
  everything. Player tokens cannot open it. Finished matches are public.
- `GET /status` is for supervisors; polling `/state` would consume a player's observations.
- Logs never include query strings, headers or bodies.
- Not done yet: HTTP rate limiting per token, and a non-root user in the Docker image.
  A harness's configuration isolation is not an operating-system sandbox; the
  open arena (`connectors/open-arena`) is the experiment that adds one.

## Experiment record

Each room keeps an `ExperimentRecorder` (`packages/server/src/experiment.ts`), saved in
checkpoints and replays as `experiment` and `timing`:

- engine identity (git revision, a SHA-256 of the runtime sources and lockfile, Node version),
  the rules hash and the base guide hash;
- each player's declared agent (model, effort, connector and version, prompt hash, memory
  and context policy) and every change to it. Unknown values are `null`, never inferred
  from display names. The one exception is old recordings: the 2026-10-22 migration read
  efforts their harnesses never recorded from player names, and kept them apart in
  `migrated.effortFromNames`. Hosts declare with `agent` when creating a room, `POST /agent-config`
  or the `CASTELLAN_*` variables; a declaration does not prove the provider's identity;
- a trace of up to 20,000 calls (tool, observation tick, start and answer, duration,
  status, failure), harness activity reports and operational failures;
- timing measured the same for every connector: think time (from our answer to the next
  call), wait time inside `/wait`, decisions, orders, time to first action, rejected
  orders, observation age and the longest gap without an accepted order.

When a match ends, the server waits up to 1 s for open calls before it saves the replay.

## Web client

Routes: `/` landing, `/battles` catalogue (also accepts a dropped replay file),
`/replay/$id`, `/watch/$id` (live, local server), `/series/$id/watch`,
`/series/$id/replay`, `/docs`, `/record/$id` (headless capture). `/devday/` serves the
static DevDay 2026 deck, with its recorded clips.

Replays are re-simulated in a Web Worker with the real engine and checked against their
hashes. The landing plays a prebuilt board-only recording (`pnpm --filter
@castellan/web showcase:build`). The look is an isometric, dithered pixel-art board
(`render/`); sound is synthesized in the style of the C64 SID (`audio/`). Source art and
music live in `assets/`; `pnpm --filter @castellan/web assets:runtime` builds the served
copies in `public/game-assets` ([details](../packages/web/scripts/RUNTIME-ASSETS.md)).

## Connectors

All connectors are clients of the same API. `connectors/cli/src/client.ts` is the one
HTTP client: CLI commands, MCP tools, Castellan Bot and the loop keepers use it.
[connectors/README.md](../connectors/README.md) has the shared turn contract.

- `castellan` CLI: rooms, series, play commands and `run`/`run-series`, which relaunch a
  harness when it exits mid-match.
- MCP server: stateless tools (`guide`, `state`, `act`, `run`, `script`, `chat`, `history`),
  each one HTTP call.
- Loop keepers: one per harness (Claude Code, Codex, Cursor, OpenCode, DeepSeek, MiniMax,
  Antigravity, JEV). They share the decision loop (`decisions.mjs`), the turns
  (`turns.mjs`) and metadata reports, and load `@castellan/shared` and `@castellan/cli`
  with Node's own type stripping, so those two packages use explicit `.ts` imports and
  erasable syntax only (checked by their own `tsconfig.json`).
- Castellan Bot: an autonomous player with local strategy, rules only.
- `connectors/autonomous`: another autonomous player, maintained by Codex.
- Open arena: a Docker experiment for official Claude Code and Codex CLIs with their native tools.

## Local data

Matches leave replays, run logs, reports and videos on the machine that runs them.
They live outside the repository, so every checkout and worktree shares one archive:
`~/.local/share/castellan/` (`CASTELLAN_DATA` overrides it; `packages/shared/src/localData.ts`).

| Directory | Holds |
|---|---|
| `replays/` | The server's archive: one `<id>.json.gz` per match and `index.json` (`REPLAY_DIR` overrides it) |
| `runs/`, `reports/` | Experiment runs, logs and analyses; copies of replays for a report stay there |
| `videos/` | Recordings made with `packages/web/scripts/record.mjs` |

Credentials stay in `~/.config/castellan/`, private to the user. Never put keys or live
tokens in logs, fixtures, commits or reports.
