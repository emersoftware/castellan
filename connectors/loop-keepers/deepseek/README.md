# DeepSeek Harness player

Runs the official **DeepSeek Harness (`dsh`) 0.1.7-rc.2**, headless, against
the existing Castellan MCP. Default model: `deepseek-flash`. Default effort: `low`.
`dsh` owns the agent loop. The game engine, tool responses, initial gameplay prompt and series history
stay shared with other connectors.

## Install and check

Use Node.js and npm (tested with Node 26.7):

```sh
node connectors/loop-keepers/deepseek/setup.mjs
node connectors/loop-keepers/deepseek/agent.mjs --check
```

Setup installs under `~/.cache/castellan/dsh/0.1.7-rc.2`, apart from the game's
dependencies and any personal dsh installation. The launcher pins and verifies the top-level harness version
before launch. npm keeps its resolved dependency lock there.

`--check` builds the real CLI profile without calling a model or joining
a game. It does not prove API credentials or remote model availability.

Save the key locally with hidden terminal input:

```sh
node connectors/loop-keepers/deepseek/key.mjs
```

This stores it outside the repository at `~/.config/castellan/deepseek-api-key` with
mode 0600. The launcher reads it automatically in every terminal session.
Or set `DEEPSEEK_API_KEY` in the shell that launches the player; the environment wins.
`CASTELLAN_DEEPSEEK_KEY_FILE` selects another private key file.

Use your personal DeepSeek API account. The connector does not read Google ADC, Vertex billing,
Claude/Codex credentials or a personal dsh login. Keep the key out of commits, game chat, source and
launch commands saved in logs.

## One game

```sh
# After saving the key, or with DEEPSEEK_API_KEY set:
CASTELLAN_TOKEN=<game-token> connectors/loop-keepers/deepseek/play.sh \
  --model deepseek-flash --effort low
```

`play.sh` uses `castellan run` to relaunch a process that exits before the game ends.
The existing fast-failure budget still applies. A restart starts a
fresh dsh session and gets the common recovery instruction to read `state`.
It never resumes a different player's conversation.

## Three-game series

```sh
CASTELLAN_TOKEN=<series-participant-token> pnpm castellan run-series -- \
  node connectors/loop-keepers/deepseek/agent.mjs \
  --model deepseek-flash --effort low
```

Call `agent.mjs` directly: `run-series` already provides the recovery loop
and passes a fresh game token for each game. Model and effort stay the same. Each
attempt gets its own workspace and dsh home. `guide`, `state` and `history`
show the series history through the game API.

`CASTELLAN_DIRECTIVE` adds 1 extra instruction to that player's prompt (see the
connectors README). `run.json` records it.

Accepted player flags: `--model <id>`, `--effort off|low|high|max`, `--check`.
Other flags are rejected.
`off` explicitly sends `thinking: {type: "disabled"}`. Without `--effort`, the default is `low`, not zero reasoning.

The installed harness and the DeepSeek account must support the model ID.
An arbitrary ID does not add it to the provider's catalog. Effort labels are provider-specific.
They are not equal compute budgets across vendors.

## Tools and isolation

The model sees exactly `mcp__castellan__guide`, `state`, `act`, `run`, `script`, `wait`, `chat`
and `history` under that namespace. The launcher disables the built-in shell, filesystem, web, delegation,
plugin-management and generic MCP-resource tools. A plugin also
limits the visible catalog and blocks every non-Castellan tool at execution.
If the expected 8-tool catalog is missing, the player fails before its first
model request. Tool timeouts allow the game's 30-second long polling.

Each process uses an empty working directory and a private `DSH_HOME`. Project
instructions, filesystem skills and personal dsh configuration are not loaded.
The harness gets only selected environment variables, the game token and the DeepSeek API key.
The API key never goes into our profile or metadata. Game-token configuration files are private (0600) inside a private
run directory. Extra session-log/inventory uploads and telemetry are off.
The model provider still gets the normal prompts and tool results needed to play.

This is tool and profile isolation, **not an operating-system/container
sandbox for the harness process itself**. The model has no filesystem or shell
tool, but trusted Node/dsh/MCP code still runs with the launching user's OS permissions.
The shared game MCP reads its own implementation files normally.

## Logs and usage

The launcher prints the attempt's directory under
`~/.local/state/castellan/deepseek/run-*`. It contains:

- `run.json`: requested model, effort, harness version and paths, without keys.
- `dsh/sessions/`: the harness's durable JSONL session and tool records.
- `usage.json`: provider-reported input/output/cache tokens after the process exits.
- `castellan.patch.json`: private generated profile, including the game token.

The CLI streams dsh JSON events on stdout. Diagnostics and a usage summary go
to stderr. Token totals sum committed assistant responses. They are not a
billing invoice and may miss failed requests the provider billed without
returning usage. No dollar price is guessed. Do not publish the whole run
directory: it holds player credentials and private game conversations.

## Validation

```sh
pnpm exec vitest run connectors/cli/test/deepseek.test.ts
```

The integration test boots this **real pinned dsh runtime** with the actual
game server and MCP, and replaces only the remote model with a local Messages
SSE fixture. It checks the model/effort sent on the wire, exact tool catalog,
successful training, history, waiting, and token accounting. It makes no paid model requests. Runtime-dependent tests skip if dsh is not installed;
launcher/argument tests still run.

Upstream: [headless](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/headless/README.md),
[MCP client](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md),
[provider](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-deepseek-api-key/README.md).
