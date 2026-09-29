# OpenCode player

Runs **OpenCode** (`opencode run`, headless) against the AoA MCP. Default model:
`openrouter/~deepseek/deepseek-flash-latest`. Any `provider/model` OpenCode
knows works (`opencode models openrouter`). The initial prompt, tools and
series history are shared with the other connectors.

## Key

The launcher uses the first OpenRouter key it finds:

1. `OPENROUTER_API_KEY` in the environment.
2. `~/.config/aoa/openrouter-api-key` (or `AOA_OPENROUTER_KEY_FILE`), mode 0600.
3. The key already stored by `opencode auth login` (OpenCode's `auth.json`).

The key is passed to OpenCode through its environment only; it is never
written to the run directory.

## One game

```sh
AOA_TOKEN=<game-token> connectors/loop-keepers/opencode/play.sh \
  --model openrouter/~deepseek/deepseek-flash-latest
```

`play.sh` uses `aoa run`, which relaunches the agent with `AOA_RESUME=1` if it
stops before the match ends. For a series use `agent.mjs` directly:

```sh
AOA_TOKEN=<series-participant-token> pnpm aoa run-series -- \
  node connectors/loop-keepers/opencode/agent.mjs --model <provider/model>
```

Flags: `--model <provider/model>`, `--variant <name>` (provider-specific
reasoning effort, passed to `opencode run --variant`). For OpenRouter models,
`--variant none` turns reasoning off (`reasoning.effort: "none"`); OpenCode's
own OpenRouter variants stop at `low`. `AOA_DIRECTIVE` appends
one extra instruction to that player's prompt (for experiments); it is recorded
in `run.json`. `AOA_OPENCODE_BIN` selects another OpenCode binary.

## Isolation

Each attempt gets a private `HOME` and XDG config/data/state directories, an
empty working directory and a generated config (`OPENCODE_CONFIG`). Personal
OpenCode config, sessions, plugins, `AGENTS.md`, project config and `~/.claude`
skills are not loaded. Every built-in tool (shell, files, web, subagents,
skills) is disabled and denied; the model sees only `aoa_rules`, `aoa_state`,
`aoa_act`, `aoa_run`, `aoa_script`, `aoa_wait`, `aoa_chat` and `aoa_history`. Provider
packages are cached in `~/.cache/aoa/opencode`. This is tool and profile
isolation, not an OS sandbox.

## Logs and usage

`~/.local/state/aoa/opencode/run-*` contains `run.json`, the private config
(with the game token), `events.jsonl` (OpenCode JSON events) and `usage.json`:
tokens and the USD cost reported by OpenCode per step. Do not publish the
directory: it contains credentials and private game conversations.
