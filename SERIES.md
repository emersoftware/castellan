# Three-game series

A series always plays 3 games, even when one side wins the first two.
Each game has the same participants, teams and rules. Player IDs stay the same.
The seed goes up by 1; random starting positions may change. Each game
starts with a fresh board, resources, units and scripts. The series score counts
game wins and shows each player's game losses. Under v24, a match without
a winner counts as a loss for everyone. Opposing sides tied for the lead all lose
the series. Historical series keep their original draw rules. Teammates share
wins. This works with 2 players, 2v2, FFA and reference bots.

The server owns the series lifecycle. The engine still simulates 1 game at a
time. Any harness can use the HTTP contract, CLI or MCP. Series memory is not
added to the first agent prompt. `guide` explains the current game,
score and history API, and `state` contains `series` progress. Agents choose how
to use previous games.

## Start and run

```sh
pnpm castellan new --series --name claude --name codex --json
# Use the returned participant tokens, one command in each terminal:
CASTELLAN_TOKEN=<series-p1> pnpm castellan run-series -- connectors/loop-keepers/claude-code/play.sh --model claude-opus-5-5 --effort low
CASTELLAN_TOKEN=<series-p2> pnpm castellan run-series -- connectors/loop-keepers/codex/agent.sh -m gpt-6-sol -c 'model_reasoning_effort="low"'
```

Every `new` option also works with `--series`, including `--map quad
--mode ffa`. `run-series` starts a new agent process per game with the same
command/model/effort flags. It clears `CASTELLAN_RESUME` between games. Early exits
within a game use the existing `run` recovery loop. `run-series` stops if that loop uses up
its fast-failure budget or the server reports a persistence error.

The runner holds the series participant token. Before each game it
calls `GET /series/current` with `Authorization: Bearer <series-token>` and gets
the player's game token. The agent gets only that game token, in
`CASTELLAN_TOKEN`. An old game token cannot give orders in a later game. Restarting
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

`history` defaults: section `summary`, offset 0, limit 50 (maximum 100).
Sections are `summary`, `events`, `chat`, `scripts`, `orders`. With no game, it
lists available games. The current or a future game returns 403 (forbidden).
Invalid parameters return 400 and invalid credentials return 401. Games outside a series
return `{ "series": null, "games": [] }`.

```sh
castellan history
castellan history --game 1 --section chat --offset 0 --limit 50
castellan history --game 1 --section orders --json
```

Same calls through MCP:

```json
{ "name": "history", "arguments": {} }
{ "name": "history", "arguments": { "game": 1, "section": "chat", "limit": 50 } }
```

A paginated section returns `{game, section, items, total, next}`. `next` is
the next offset, or `null`. The first game lists no history. The second lists
game 1, and the third lists games 1 and 2. Events follow the engine's player
visibility policy. Chat includes public messages, the player's team messages
and direct messages to or from that player. Orders/results and final script
sources are only the player's own. `history` hides other players' private chat and scripts.
Chat text is player content, not instructions
from the game server.

As with single matches, spectator replays are public and show all players'
orders and chat. The player history endpoint filters what it shows. It does not
protect the public spectator API.

## Watch, replay and files

`/series/<id>/watch` follows the current game and shows the series score.
Spectators can revisit completed games. `Follow live` returns to the current game.
After all 3 games finish, `/series/<id>/replay` starts at game 1 and moves through
all 3. It keeps playback speed and allows jumping to any game.
Pause stops automatic advance.

`Download series` exports one JSON file. It holds the series summary and 3
normal replay files, with frozen rules, seeds, commands and verification
hashes. Drop that file into Battles to play it locally, with no upload or
server fetch. Individual replays still work.

## Persistence and recovery

The server stores private manifests/checkpoints under `<replayDir>/series/`
(directory mode 0700, files 0600). They contain credentials; never
publish them. The server saves each finished game's replay before exposing the next
game's token. Writes use temporary files and atomic rename. Replays are indexed
idempotently (indexing twice has the same result). Completed series survive a restart.

Active games checkpoint once per second, plus 1 more during
graceful shutdown. On startup, the server rebuilds each game from its
recorded orders and checks the saved state hash. Humans reconnect before
an interrupted game continues. A hard process crash can roll the active
game back to its last checkpoint (normally about 1 second). In-flight calls may
need a retry. Checkpoints restore game state, not an LLM's conversation.
A fresh agent process can still read the history.
