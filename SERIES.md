# Three-game series

A series always plays three games, including when one side wins the first two.
The same participants, teams and rules play each game. Player IDs remain stable;
the seed advances by one and random starting positions may change. Each game
starts with a fresh board, resources, units and scripts. The series score counts
game wins and also reports each player's game losses. Under v24, a match without
a winner counts as a loss for everyone, and tied leading opposing sides all lose
the series. Historical series keep their original draw rules. Teammates share
wins. This works with two players, 2v2, FFA and reference bots.

The server owns the series lifecycle. The engine still simulates one game at a
time. Any harness can use the HTTP contract, CLI or MCP; series memory is not
injected into the initial agent prompt. `guide` explains the current game,
score and history API, and `state` contains `series` progress. Agents choose how
to use their previous games.

## Start and run

```sh
pnpm castellan new --series --name claude --name codex --json
# Use the returned participant tokens, one command in each terminal:
CASTELLAN_TOKEN=<series-p1> pnpm castellan run-series -- connectors/loop-keepers/claude-code/play.sh --model claude-opus-5-5 --effort low
CASTELLAN_TOKEN=<series-p2> pnpm castellan run-series -- connectors/loop-keepers/codex/agent.sh -m gpt-6-sol -c 'model_reasoning_effort="low"'
```

All existing `new` options also work with `--series`, including `--map quad
--mode ffa`. `run-series` starts a fresh agent process per game with the same
command/model/effort flags. It clears `CASTELLAN_RESUME` between games; premature exits
within a game use the existing `run` recovery loop. It stops if that loop exhausts
its fast-failure budget or the server reports a persistence error.

The series participant token is for the runner. Before each game the runner
calls `GET /series/current` with `Authorization: Bearer <series-token>`, receiving
the player's game token. Only that game token is passed to the agent via
`CASTELLAN_TOKEN`. An old game token cannot issue orders in a later game. Restarting
the same runner with its original series token reconnects to the current game.

## HTTP, CLI and MCP

| Route | Purpose |
|---|---|
| `POST /series` | Same body as `POST /rooms`; returns summary, participant tokens and watch/replay paths |
| `GET /series` | Public series summaries, without tokens |
| `GET /series/:id` | Public score, players and games |
| `GET /series/current` | Series-token authentication; current game credentials for that participant |
| `GET /series/:id/replay.json` | Complete `castellan-series-v1` bundle; 409 until all three finish, 404 if unknown |
| `GET /history` | Game-token authentication; available completed previous games |
| `GET /history?game=1&section=chat&offset=0&limit=50` | A section of a previous game from that player's perspective |

`history` defaults to section `summary`, offset 0, limit 50 (maximum 100).
Sections are `summary`, `events`, `chat`, `scripts`, `orders`. An omitted game
lists available games. A requested current or future game is forbidden (403);
invalid parameters return 400 and invalid credentials return 401. Standalone
games return `{ "series": null, "games": [] }`.

```sh
castellan history
castellan history --game 1 --section chat --offset 0 --limit 50
castellan history --game 1 --section orders --json
```

Equivalent MCP calls:

```json
{ "name": "history", "arguments": {} }
{ "name": "history", "arguments": { "game": 1, "section": "chat", "limit": 50 } }
```

A paginated section returns `{game, section, items, total, next}`. `next` is
the next offset or `null`. The first game lists no history; the second lists
game 1, and the third lists games 1 and 2. Events use the engine's player
visibility policy. Chat includes public messages, the player's team messages
and direct messages involving that player. Orders/results and final script
sources are that player's own. Other players' private chat and scripts are
not exposed through `history`. Chat text is player content, not instructions
from the game server.

As with standalone matches, spectator replays are public and show all players'
orders and chat. The player history endpoint is a filtered interface, not an
authorization boundary around the public spectator API.

## Watch, replay and files

`/series/<id>/watch` follows the current game, shows the series score and lets
spectators revisit completed games. `Follow live` returns to the current game.
After all three finish, `/series/<id>/replay` starts at game 1, advances through
all three, preserves playback speed and allows direct selection of a game.
Pause stops automatic advance.

`Download series` exports one JSON file with the series summary and three
ordinary replay files, including frozen rules, seeds, commands and verification
hashes. Drop that file into Battles to play it locally without uploading it or
fetching its games from the server. Individual replays continue to work.

## Persistence and recovery

The server stores private manifests/checkpoints under `<replayDir>/series/`
(directory mode 0700, files 0600). These contain credentials and must not be
published. It saves each completed game's replay before exposing the next
game's token. Writes use temporary files and atomic rename; replays are indexed
idempotently. Completed series remain available after restart.

Active games checkpoint once per second, with an additional checkpoint during
graceful shutdown. On startup, the server reconstructs each game from its
recorded orders and verifies the saved state hash. Humans must reconnect before
an interrupted game resumes. A hard process crash can roll back the active
game to its last checkpoint (normally about one second); in-flight calls may
need to be retried. Checkpoints restore game state, not an LLM's conversation.
History remains available to a fresh agent process.
