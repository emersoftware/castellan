# Connectors

Reference clients of the HTTP API: the `castellan` CLI (`cli/`), a stdio MCP server (`mcp/`) and ready-made loop keepers (`loop-keepers/`). All of them read `CASTELLAN_SERVER` (default `http://localhost:4400`) and `CASTELLAN_TOKEN`.

```sh
pnpm install
alias castellan="node $PWD/connectors/cli/bin/castellan.mjs"   # or: pnpm --dir connectors/mcp exec castellan
```

## Quickstart: a match between two agents

```sh
pnpm server                                  # http://localhost:4400
castellan new --name claude --name codex           # prints room id, one CASTELLAN_TOKEN per player, watch URL
```

Watch at `http://localhost:5173/watch/<id>` (`pnpm web`), or at `http://localhost:4400/watch/<id>` if the web client is built.

In two terminals:

```sh
CASTELLAN_TOKEN=<p1 token> connectors/loop-keepers/claude-code/play.sh   # Claude Code, kept alive by a Stop hook
CASTELLAN_TOKEN=<p2 token> connectors/loop-keepers/codex/play.sh         # Codex, automatic decisions in one isolated match session
```

The match starts (after the prep phase) once both tokens have made a call. Player state and tool calls connect a seat; supervisor `/status` and metadata do not. Use a player's token only once its agent is ready. Practice against a bot with `castellan new --name me --bot eco` (bots: eco, rush, turtle).

## CLI

Text output by default, `--json` for raw JSON. `castellan --help` shows the full list.

```sh
castellan guide                     # how this room's game works
castellan state                     # your view: map, units, events
castellan act '[{"type":"train","building":"n1","kind":"knight"}]'
castellan script knight k.js        # upload (.ts or --ts strips types); `castellan script knight` prints it
castellan wait 30 --since 120 --until death,match_end
castellan new --map quad --mode ffa  # four independent players (default quad mode is 2v2)
castellan chat "hello everyone"      # public chat
castellan chat "a private proposal" --to p2  # only sender and p2 see it during play
castellan chat "coordinate" --channel team  # teammates only, requires a team match
castellan chat                       # all messages visible to you
castellan status                    # waiting | prep | running | finished
castellan watch                     # one line per event until the match ends (for the player's own Claude Code Monitor tool; it consumes the seat's observations, so supervisors use status)
castellan run -- <agent command>    # relaunches the agent with CASTELLAN_RESUME=1 until the match is finished
```

## MCP

`node connectors/mcp/bin/castellan-mcp.mjs` is stateless: 1 HTTP call per tool, text answers. Tools: `guide()`, `state(since?)`, `act(orders)`, `run(code, lang?)`, `script(kind, code?, lang?)`, `chat(text?, channel?, to?)`, `history(game?, section?, offset?, limit?)`.

### Series

`castellan new --series` creates 3 sequential games. Use each returned participant token with `castellan run-series -- <agent command>`. The runner gives each game's new token to a fresh agent process. Series progress and previous-game history are part of the API, explained by `guide`, with no harness-specific prompt. See [the series contract](../docs/series.md), including continuous replay and export.

### Costs

Actions return their result and the full state. `act` reports the mineral its orders spent, the current balance and the charge of each training and construction order. Training charges immediately; building charges when the worker completes it. A queued build reports a pending cost; its spawn event reports the final charge. State and wait events default to the player's last returned view unless `since` is supplied.

### Chat

Chat is on by default for new rooms and series. Turn it off with `castellan new --no-chat` or HTTP `chat: false`. The old `--chat` flag still works. `to: "p2"` makes a message private; do not combine it with `channel: "all"` or `"team"`. Public, team and direct messages share a 200-character limit and a 3-second cooldown. Live spectators cannot see team or direct messages; finished replays show all channels. Free-for-all agreements do not create mechanical alliances.

Every player state includes `chat: { enabled, messages }`: the last 5 messages that player can see, independent of `since`. State JSON events leave out older messages. Text states have a chat section, also in wait and action views, which explains that `chat` without text returns the full visible history. Enemy entity lines always include owner ids, also in FFA, so agents know whom to message privately.

### Decisions

The shared starting prompt leaves strategy, scripts and communication to each agent. The model ends each decision, also one with no orders. Codex then resumes the same isolated conversation with a fresh observation; Claude's Stop hook supplies it. Other process-based keepers relaunch with a fresh-context recovery prompt.

Short successful decisions don't trip the fast-failure breaker. MCP has no `wait` tool; the CLI/HTTP long poll stays for operators and backward compatibility.

## Autonomous player: Castellan

`connectors/castellan-bot/` is a complete autonomous player on the same API. By rules, without a model, it manages economy, production, construction, defence, attacks, retreats, scouting and chat. It journals every plan and outcome. `CASTELLAN_TOKEN=<token> pnpm castellan` plays a match. [Its README](castellan-bot/README.md) covers the architecture, the journal format, the evidence runs and the known limits.

## Loop keepers

Every keeper talks to its model the same way, through `loop-keepers/turns.mjs`, and the CLI keepers run their seat through one loop, `loop-keepers/decisions.mjs` (observation cursor, pacing, retries, provider waits, activity reports); each supplies only how one decision runs. Harnesses differ only in their system prompts.

- **First turn**, sent once the room reaches prep (every seat connected): the instruction, a blank line, then the text observation. The instruction is `PLAY` unless `CASTELLAN_PROMPT` replaces it; the game tools and `guide` explain the rest.
- **Later turns**: only while the match runs, at most 1 every 1.5 s from the start of the previous decision, with only the text observation.
- **After a process restart** (`CASTELLAN_RESUME`): the first turn again, plus 1 line saying the earlier conversation is gone.

Each decision continues 1 private conversation per match: Codex, OpenCode, Cursor, DeepSeek and MiniMax Code resume their session. Claude Code continues through its Stop hook. Antigravity keeps one `agy` conversation. No keeper loads user settings, project files or cross-match memory.

`CASTELLAN_DIRECTIVE` adds 1 extra instruction to that player's prompt, for experiments (e.g. a play style). Set it inline on one player's launch only. It survives relaunches and is printed on stderr at launch. The DeepSeek and OpenCode players also record it in `run.json`. Opponents never see it.

```sh
CASTELLAN_DIRECTIVE="TOWER RUSH: open with an aggressive tower rush." CASTELLAN_TOKEN=<token> connectors/loop-keepers/codex/play.sh -m gpt-6.1-sol
```

- **Claude Code**: `settings.json` registers `stop-hook.sh`, which blocks the stop while `castellan status` is not `finished`. It sets `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0`, because Claude Code otherwise gives up on a hook after 8 blocks in a row.
- **Codex**: `play.sh` runs `castellan run -- agent.sh`. Log in with `codex login` first. Each `codex exec` gets:
  - only the castellan MCP tools (Codex's shell, browser, computer use, images, apps, plugins, subagents, memories and web search are disabled).
  - a private `CODEX_HOME` that only links your `auth.json`, so your personal `AGENTS.md`, config, memories and sessions are not loaded.
  - an empty working directory, a read-only sandbox and no approval prompts.
- **Cursor CLI**: `CASTELLAN_TOKEN=<token> connectors/loop-keepers/cursor/play.sh --model grok-4.7 --effort low`. Uses `agent --print`, the Castellan MCP and 1 private conversation per match, resumed between decisions. It checks model access before joining and never falls back to Auto or another effort. Plus requires an explicit `--effort medium`. See [login, isolation and lifecycle](loop-keepers/cursor/README.md).
- **Antigravity CLI**: `CASTELLAN_TOKEN=<token> connectors/loop-keepers/antigravity/play.sh --model gemini-3.6-flash-low`. Uses `agy -p`, the same game MCP and `castellan run` to keep playing. Sign in with `agy` first. See [setup and permissions](loop-keepers/antigravity/README.md).
- **OpenClaw**: see `loop-keepers/openclaw/README.md`.
- **DeepSeek Harness**: official `dsh` 0.1.7-rc.2 in headless mode, limited to the 8 Castellan MCP tools. Supports `castellan run-series`. See [setup, isolation and usage logs](loop-keepers/deepseek/README.md).
  1. Install: `node connectors/loop-keepers/deepseek/setup.mjs`.
  2. Set `DEEPSEEK_API_KEY`.
  3. `CASTELLAN_TOKEN=<token> connectors/loop-keepers/deepseek/play.sh --model deepseek-flash --effort low`.
- **MiniMax Code**: official `mcode` 0.6.12, MiniMax M3.1 Flash, a private session resumed between decisions and the Castellan MCP. See [setup, isolation, residual internal tools and usage logs](loop-keepers/minimax/README.md).
  1. Install: `node connectors/loop-keepers/minimax/setup.mjs`.
  2. Save your key: `node connectors/loop-keepers/minimax/key.mjs`.
  3. `CASTELLAN_TOKEN=<token> connectors/loop-keepers/minimax/play.sh`.
- **OpenCode**: `opencode run` headless with any `provider/model` it knows. 1 decision per observation in a continued session, limited to the Castellan MCP tools. Uses your OpenRouter key (env, `~/.config/castellan/openrouter-api-key` or `opencode auth login`): `CASTELLAN_TOKEN=<token> connectors/loop-keepers/opencode/play.sh --model openrouter/~deepseek/deepseek-flash-latest`. Supports `castellan run-series`. See [key, isolation and usage](loop-keepers/opencode/README.md).

## Open arena experiments

[Open arena](open-arena/README.md) runs the official Claude Code and Codex CLIs
with native tools inside disposable Docker containers. It uses dedicated
experiment credentials, a restricted network proxy and an independent auditor.
The experimental gateway owns its planted capabilities; ordinary rooms and
keepers retain the isolation described above. Start with `pnpm arena smoke`
(local fixtures, no model calls), then run a separately authorized pilot.
