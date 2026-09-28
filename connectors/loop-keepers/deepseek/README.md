# DeepSeek Harness player

Runs the official **DeepSeek Harness (`dsh`) 0.1.7-rc.2**, headless, against
the existing AoA MCP. Default model: `deepseek-flash`; effort: `low`.
The game engine, tool responses, initial gameplay prompt and series history
remain shared with the other connectors. `dsh` owns the agent loop.

## Install and check

Use Node.js and npm (tested with Node 26.7):

```sh
node connectors/loop-keepers/deepseek/setup.mjs
node connectors/loop-keepers/deepseek/agent.mjs --check
```

Installation lives under `~/.cache/aoa/dsh/0.1.7-rc.2`, separate from the game's
dependencies and any personal dsh installation. The top-level harness version
is pinned and verified before launch. npm retains its resolved dependency lock
there. `--check` composes the real CLI profile without calling a model or joining
a game; it does not prove API credentials or remote model availability.

Save the key locally using hidden terminal input:

```sh
node connectors/loop-keepers/deepseek/key.mjs
```

This stores it outside the repository at `~/.config/aoa/deepseek-api-key` with
mode 0600. The launcher reads it automatically across terminal sessions.
Alternatively set `DEEPSEEK_API_KEY` in the shell that launches the player;
the environment takes precedence. `AOA_DEEPSEEK_KEY_FILE` selects another
private key file. Use your personal
DeepSeek API account. The connector does not read Google ADC, Vertex billing,
Claude/Codex credentials or a personal dsh login. Do not commit or paste the key
into game chat, source or launch commands saved in logs.

## One game

```sh
# After saving the key, or with DEEPSEEK_API_KEY set:
AOA_TOKEN=<game-token> connectors/loop-keepers/deepseek/play.sh \
  --model deepseek-flash --effort low
```

`play.sh` uses `aoa run` to relaunch a process that exits before the game ends.
The existing fast-failure budget still applies. A restarted attempt starts a
fresh dsh session and receives the common recovery instruction to read `state`.
It never resumes a different player's conversation.

## Three-game series

```sh
AOA_TOKEN=<series-participant-token> pnpm aoa run-series -- \
  node connectors/loop-keepers/deepseek/agent.mjs \
  --model deepseek-flash --effort low
```

Use `agent.mjs` directly here: `run-series` already provides the recovery loop
and passes a fresh game token per game. Model and effort stay the same; each
attempt gets a separate workspace and dsh home. `rules`, `state` and `history`
expose the series history through the game API.

Accepted player flags: `--model <id>`, `--effort off|low|high|max`, `--check`.
`off` explicitly sends `thinking: {type: "disabled"}`; omitting `--effort`
uses this connector's default `low`, not zero reasoning.
Other flags are rejected. A model ID must be supported by the installed harness
and the DeepSeek account; choosing an arbitrary ID does not add it to the
provider's catalog. Effort labels are provider-specific, not equal compute
budgets across vendors.

## Tools and isolation

The model sees exactly `mcp__aoa__rules`, `state`, `act`, `script`, `wait`, `chat`
and `history` under that namespace. Built-in shell, filesystem, web, delegation,
plugin-management and generic MCP-resource tools are disabled. A plugin also
restricts the visible catalog and denies every non-AoA tool at execution.
If the expected seven-tool catalog is missing, the player fails before its first
model request. Tool timeouts allow the game's 30-second long polling.

Each process uses an empty working directory and a private `DSH_HOME`. Project
instructions, filesystem skills and personal dsh configuration are not loaded.
Only selected environment variables, the game token and the DeepSeek API key
are passed to the harness. The API key is never written into our profile or
metadata. Game-token configuration files are private (0600) inside a private
run directory. Additional session-log/inventory uploads and telemetry are off;
the model provider still receives the normal prompts and tool results needed
to play.

This is tool and profile isolation, **not an operating-system/container
sandbox for the harness process itself**. The model has no filesystem or shell
tool, but trusted Node/dsh/MCP code still runs with the launching user's OS
permissions. The shared game MCP reads its own implementation files normally.

## Logs and usage

The launcher prints the attempt's directory under
`~/.local/state/aoa/deepseek/run-*`. It contains:

- `run.json`: requested model, effort, harness version and paths, without keys.
- `dsh/sessions/`: the harness's durable JSONL session and tool records.
- `usage.json`: provider-reported input/output/cache tokens after the process exits.
- `aoa.patch.json`: private generated profile, including the game token.

The CLI streams dsh JSON events on stdout; diagnostics and a usage summary go
to stderr. Token totals sum committed assistant responses; they are not a
billing invoice and may omit failed requests the provider billed without
returning usage. No dollar price is guessed. Do not publish the whole run
directory: it includes player credentials and private game conversations.

## Validation

```sh
pnpm exec vitest run connectors/cli/test/deepseek.test.ts
```

The integration test boots this **real pinned dsh runtime**, uses the actual
game server and MCP, and replaces only the remote model with a local Messages
SSE fixture. It checks the model/effort sent on the wire, exact tool catalog,
successful training, history, waiting, and token accounting. It makes no paid
model requests. Runtime-dependent tests skip if dsh has not been installed;
the launcher/argument tests still run.

Upstream: [headless](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/headless/README.md),
[MCP client](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md),
[provider](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-deepseek-api-key/README.md).
