# OpenCode player

Runs **OpenCode** (`opencode run`, headless) against the AoA MCP. Default model:
`openrouter/~deepseek/deepseek-flash-latest`. Any `provider/model` OpenCode
knows works (`opencode models openrouter`). The initial prompt, tools and
series history are shared with the other connectors.

Like the Codex connector, the launcher supplies observations, never strategy:
it reads `/state?format=text` and runs one `opencode run` per decision, each
continuing the match's session (`--session`) in the same private HOME. The
model decides, acts and ends its turn; the next decision gets a fresh
observation. One decision is in flight per seat.

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

When OpenRouter returns a temporary `in_flight_budget_exhausted` (402) or a
rate limit (429) with `Retry-After`, the launcher waits that long and then
decides again, keeping the session and observation cursor. The match and
installed unit scripts continue during the wait; match completion or a
termination signal cancels it. Other failed decisions, including permanent
credit/authentication errors, retry with a backoff of up to 30 s.

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
skills) is disabled and denied; the model sees only the `aoa_*` MCP tools. Provider
packages are cached in `~/.cache/aoa/opencode`. This is tool and profile
isolation, not an OS sandbox.

## Logs and usage

`~/.local/state/aoa/opencode/run-*` contains `run.json`, the private config
(with the game token), `events.jsonl` (OpenCode JSON events of every decision) and `usage.json`:
tokens and the USD cost reported by OpenCode per step, summed over the match. Do not publish the
directory: it contains credentials and private game conversations.

`AOA_OPENROUTER_PROVIDER=deepseek` pins OpenRouter to those upstream providers (comma-separated), with no fallback.

`--model deepseek/deepseek-flash` uses DeepSeek's API directly, with the DeepSeek player's key (`DEEPSEEK_API_KEY` or `~/.config/aoa/deepseek-api-key`); `--variant low|high|max` sets its `reasoning_effort`.
