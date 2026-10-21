# MiniMax Code player

Runs the official **MiniMax Code (`@minimax-ai/code`) 0.6.12** CLI, with
**MiniMax-M3.1-Flash**, `low` effort and the existing Castellan MCP.
MiniMax Code owns model requests, tool execution and the conversation.
This is the agent at [MiniMax-AI/minimax-code](https://github.com/MiniMax-AI/minimax-code),
not `mmx-cli`: [mmx](https://platform.minimax.io/docs/m-plan/minimax-cli) calls
MiniMax APIs and configures other agents.

## Install and configure

Use a Node version supported by the pinned CLI (tested with Node 26.7):

```sh
node connectors/loop-keepers/minimax/setup.mjs
node connectors/loop-keepers/minimax/agent.mjs --check
node connectors/loop-keepers/minimax/key.mjs
```

Installation lives under `~/.cache/castellan/mcode/0.6.12`. The credential
command reads hidden input and saves the key with mode 0600 at
`~/.config/castellan/minimax-api-key`. `MINIMAX_API_KEY` takes precedence;
`CASTELLAN_MINIMAX_KEY_FILE` selects another private file.
Use a global MiniMax API key or M Plan subscription key. The connector uses the
official global endpoint `https://api.minimax.io/anthropic` and does not use
OpenRouter or a personal MiniMax Code login. The key's account/plan determines billing.

`--check` loads the real CLI's provider configuration without a model request
or joining a seat. It does not prove credentials, credit, model availability
or MCP execution; the integration test below covers MCP with a local fixture.

The npm build still carries `MiniMax-M3.1-Flash-Preview` in its default catalog.
Our private configuration adds the released `MiniMax-M3.1-Flash` ID with the
settings from the [official source catalog](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/config/src/minimax-model-catalog.ts).
The package itself is unchanged. Other model IDs are rejected until their
catalog settings are verified. The real-runtime test checks both
`thinking: {type: "adaptive"}` and `output_config: {effort: "low"}` on the wire.

## Play

```sh
CASTELLAN_TOKEN=<game-token> connectors/loop-keepers/minimax/play.sh
# Optional: --effort low|medium|high|xhigh|max
```

The first turn and subsequent observations use `../turns.mjs`, exactly like
DeepSeek. Each decision resumes the same private session with `mcode exec
--session`; another match starts a fresh conversation. `CASTELLAN_PROMPT`,
`CASTELLAN_DIRECTIVE` and `CASTELLAN_RESUME` follow the common protocol.
The keeper stops when the player is eliminated or the game finishes. A native
tool loop can span the whole match, so `exec` has no per-decision timeout;
the game-status watcher stops active execution. Three consecutive failed decisions stop the process;
`play.sh` does not restart it indefinitely after authentication/quota failures.

For a series, use `castellan run-series -- node
connectors/loop-keepers/minimax/agent.mjs`. The series supervisor owns process
restarts and gives each game a fresh token and session.

## Isolation and harness differences

Every attempt has an empty workspace, private home and `MINIMAX_DATA_DIR`.
Personal config, project instructions, other providers' keys, sessions and
external skills are not inherited. Shell, filesystem, web, media, delegation,
memory, title generation and telemetry are disabled through official settings.
The official main system prompt is preserved.

The model sees the seven Castellan tools (`guide`, `state`, `act`, `run`,
`script`, `chat`, `history`) and **four residual internal tools** that this
CLI retains with empty tool/skill allowlists: `skill`, `task_query`,
`task_output`, `task_stop`. No tasks or user skills are loaded by this connector.
This is a documented harness difference from the seven-tool dsh player,
not a claim of identical full tool catalogs or reasoning budgets.

This is configuration/tool isolation, not an OS sandbox. Trusted CLI/MCP code
runs as the launching user. MiniMax Code's supported BYOK config stores the API
key in plaintext in the private attempt's mode-0600 `mcode/config.yaml`.
`mcode/mcp.json` similarly contains the game token. Do not publish run directories.

## Evidence and logs

Attempts live under `~/.local/state/castellan/minimax/run-*`:

- `run.json`: version, model, effort, paths and residual tool names; no credentials.
- `mcode/`: native configuration, session records and runtime logs.
- `usage.json`: provider-reported usage summed from terminal decision results;
  `incomplete` marks interrupted/missing usage.

JSON events stream to stdout. Redirect stdout/stderr to a private file when
launching a match. Replay metadata records `minimax-code`, version, model,
effort and shared prompt hash. Usage covers completed model responses reported
by the harness; it is not an invoice and excludes any unreported billed failures.
The CLI also uses the provider's input-token counting endpoint.

## Validate without spending API credit

```sh
pnpm exec vitest run connectors/cli/test/minimax.test.ts
```

The test runs the **installed official CLI**, real game server and real MCP,
replacing only the remote provider with a local SSE fixture. It verifies the
full tool catalog, actual training, model/effort, token totals and conversation
resumption. Runtime-dependent tests skip when the pinned package is absent.
