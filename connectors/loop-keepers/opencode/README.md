# OpenCode player

Runs **OpenCode** (`opencode run`, headless) against the Castellan MCP. Default model:
`openrouter/~deepseek/deepseek-flash-latest`. Any `provider/model` OpenCode
knows works (`opencode models openrouter`). The initial prompt, tools and
series history are shared with the other connectors.

Like the Codex connector, the launcher supplies observations and never strategy.
It reads `/state?format=text` and runs one `opencode run` per decision. Each run
continues the match's session (`--session`) in the same private HOME. The
model decides, acts and ends its turn. The next decision gets a fresh
observation. One decision is in flight per seat.

## Key

The launcher uses the first OpenRouter key it finds:

1. `OPENROUTER_API_KEY` in the environment.
2. `~/.config/castellan/openrouter-api-key` (or `CASTELLAN_OPENROUTER_KEY_FILE`), mode 0600.
3. The key already stored by `opencode auth login` (OpenCode's `auth.json`).

The key reaches OpenCode only through its environment, never the run directory.

## Other providers

`CASTELLAN_OPENROUTER_PROVIDER=deepseek` pins OpenRouter to those upstream providers (comma-separated), with no fallback.

`--model deepseek/deepseek-flash` uses DeepSeek's API directly, with the DeepSeek player's key (`DEEPSEEK_API_KEY` or `~/.config/castellan/deepseek-api-key`). `--variant low|high|max` sets its `reasoning_effort`.

`--model anthropic/<model>` uses Anthropic's API directly, with the key from `ANTHROPIC_API_KEY` or `~/.config/castellan/anthropic-api-key` (mode 0600). A key not scoped to a workspace also needs the workspace id, from `CASTELLAN_ANTHROPIC_WORKSPACE` or `~/.config/castellan/anthropic-workspace-id`. It goes out as the `anthropic-workspace-id` header. `--variant low|medium|high|xhigh|max` sets adaptive thinking with that effort, like Claude Code's `--effort`. The generated config declares model ids newer than OpenCode's catalog (e.g. `claude-opus-5-5`).

## One game

```sh
CASTELLAN_TOKEN=<game-token> connectors/loop-keepers/opencode/play.sh \
  --model openrouter/~deepseek/deepseek-flash-latest
```

`play.sh` uses `castellan run`, which relaunches the agent with `CASTELLAN_RESUME=1` if it stops before the match ends.
For a series, use `agent.mjs` directly:

```sh
CASTELLAN_TOKEN=<series-participant-token> pnpm castellan run-series -- \
  node connectors/loop-keepers/opencode/agent.mjs --model <provider/model>
```

OpenRouter can return a temporary `in_flight_budget_exhausted` (402) or a
rate limit (429) with `Retry-After`. The launcher waits that long and
decides again, keeping the session and observation cursor. The match and
installed unit scripts keep running during the wait. Match completion or a
termination signal cancels it. Other failed decisions, including permanent
credit or authentication errors, retry with a backoff of up to 30 s.

Flags:

- `--model <provider/model>`.
- `--variant <name>`: provider-specific reasoning effort, passed to `opencode run --variant`. For OpenRouter models,
  `--variant none` turns reasoning off (`reasoning.effort: "none"`). OpenCode's
  own OpenRouter variants stop at `low`.
- `CASTELLAN_DIRECTIVE` appends 1 extra instruction to that player's prompt (for experiments), recorded in `run.json`.
- `CASTELLAN_OPENCODE_BIN` selects another OpenCode binary.

## Isolation

Each attempt gets a private `HOME` and XDG config/data/state directories, an
empty working directory and a generated config (`OPENCODE_CONFIG`). Personal
OpenCode config, sessions, plugins, `AGENTS.md`, project config and `~/.claude`
skills are not loaded. Every built-in tool (shell, files, web, subagents,
skills) is disabled and denied. The model sees only the `castellan_*` MCP tools. Provider
packages are cached in `~/.cache/castellan/opencode`. This is tool and profile isolation, not an OS sandbox.

## Logs and usage

`~/.local/state/castellan/opencode/run-*` contains:

- `run.json`.
- The private config, with the game token.
- `events.jsonl`: the OpenCode JSON events of every decision.
- `usage.json`: tokens and USD cost reported by OpenCode per step, summed over the match.

Do not publish it: it contains credentials and private game conversations.
