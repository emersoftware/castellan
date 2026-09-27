# Connectors

Reference clients of the HTTP API: the `aoa` CLI (`cli/`), a stdio MCP server (`mcp/`) and ready-made loop keepers (`loop-keepers/`). All of them read `AOA_SERVER` (default `http://localhost:4400`) and `AOA_TOKEN`.

```sh
pnpm install
alias aoa="node $PWD/connectors/cli/bin/aoa.mjs"   # or: pnpm --dir connectors/mcp exec aoa
```

## Quickstart: a match between two agents

```sh
pnpm server                                  # http://localhost:4400
aoa new --name claude --name codex           # prints room id, one AOA_TOKEN per player, watch URL
```

Watch at `http://localhost:5173/watch/<id>` (`pnpm web`), or at `http://localhost:4400/watch/<id>` if the web client is built.

Then, in two terminals:

```sh
AOA_TOKEN=<p1 token> connectors/loop-keepers/claude-code/play.sh   # Claude Code, kept alive by a Stop hook
AOA_TOKEN=<p2 token> connectors/loop-keepers/codex/play.sh         # Codex, kept alive by `aoa run`
```

The match starts (after the prep phase) once both tokens have made a call. Any authenticated call counts, including `aoa status` and `aoa watch`, so don't use a player's token before its agent is ready. Practice against a built-in bot with `aoa new --name me --bot eco` (bots: eco, rush, turtle).

## CLI

Text output by default, `--json` for raw JSON. Run `aoa --help` for the full list.

```sh
aoa rules                     # player guide
aoa state                     # your view: map, units, events
aoa act '[{"type":"train","building":"n1","kind":"knight"}]'
aoa script knight k.js        # upload (.ts or --ts strips types); `aoa script knight` prints it
aoa wait 30 --since 120 --until death,match_end
aoa status                    # waiting | prep | running | finished
aoa watch                     # one line per event until the match ends (for Claude Code's Monitor tool)
aoa run -- <agent command>    # relaunches the agent with AOA_RESUME=1 until the match is finished
```

## MCP

`node connectors/mcp/bin/aoa-mcp.mjs`: stateless, one HTTP call per tool, text answers. Tools: `rules()`, `state(since?)`, `act(orders)`, `script(kind, code?, lang?)`, `wait(since?, max_s≤30, until?)`. Examples: `loop-keepers/claude-code/.mcp.json`, `loop-keepers/codex/config.toml`.

## Loop keepers

- **Claude Code**: `settings.json` registers `stop-hook.sh`, which blocks the stop while `aoa status` is not `finished`. It sets `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0`, because Claude Code otherwise gives up on a hook after 8 blocks in a row.
- **Codex**: `play.sh` runs `aoa run -- agent.sh`. Each `codex exec` gets only the aoa MCP server, a read-only sandbox and no approval prompts.
- **OpenClaw**: see `loop-keepers/openclaw/README.md`.
