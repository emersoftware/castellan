# Antigravity CLI player

This player runs Google's Antigravity CLI (`agy`), not Gemini CLI or the desktop
editor's command launcher.

1. Install `agy`, or run `agy update` for an existing installation. Sign in with `agy` once.
2. Use the model identifiers printed by `agy models`.
3. Create a room and give this player its token:

```sh
pnpm castellan new --name antigravity --bot rush --chat
CASTELLAN_TOKEN=<player-token> connectors/loop-keepers/antigravity/play.sh \
  --model gemini-4-argon-low --effort low
```

For Vertex through Google Cloud:

1. Configure ADC (Application Default Credentials) once with
   `gcloud auth application-default login --project <gcp-project>`.
2. Select that project and region in Antigravity's Google Cloud settings.
3. Start the player:

```sh
AGY_ADC_AUTH=true CASTELLAN_TOKEN=<player-token> \
  connectors/loop-keepers/antigravity/play.sh --model gemini-4-argon-low --effort low
```

The ADC quota project and Antigravity's GCP project must both be the intended
billing project. The launcher inherits `AGY_ADC_AUTH` and leaves global
authentication unchanged.

`CASTELLAN_SERVER` defaults to `http://localhost:4400`. `CASTELLAN_AGY_BIN`
selects another executable. Model and effort arguments go to `agy`.
The driver owns the project, conversation, prompt and stream-json protocol, and
rejects external overrides of them.
An explicit `--model` must appear in `agy models` for the current authentication;
otherwise the launcher stops before creating a workspace or connecting the seat.
For Vertex, list models with `AGY_ADC_AUTH=true agy models` too.

## Native MCP transport

`mcp` is the default transport. The player receives the game's MCP tools directly;
terminal commands, file writes and web access are denied. Only the game MCP and
this conversation's saved tool outputs are pre-approved. Global Antigravity
customizations may still be discovered: this is a tool permission boundary, not
an OS sandbox. No global settings are edited.

With `AGY_ADC_AUTH=true`, these passed the native MCP diagnostic: one real `guide`
call and one real `state` call, with both response nonces confirmed.

- 2026-10-28: `agy 1.4.9`, `gemini-4-argon-low`.
- 2026-11-13: `agy 1.5.8`, `gemini-4-hydrogen-low`.

The earlier `agy 1.3.4` failure to call discovered MCP tools was not reproduced.
Since 1.5.7, headless runs start in Auto mode where it is available; deny rules
still take precedence. In the 1.5.8 ADC run, the CLI log reported Auto as
unavailable and fell back to Default. Check other versions and models with the
diagnostic below; transports never switch automatically.

## Decisions and recovery

The launcher creates a temporary workspace and a unique project under
`~/.gemini/config/projects/`. It connects the player's seat once. While the room
waits or prepares, it polls `/status` without calling the model.
When the game runs, it opens a stream-json conversation. `init` returns the
conversation ID without a paid READY turn.

The first decision includes the common player instructions, room rules, tool
schemas and a fresh observation. Later decisions get a fresh observation in the same
conversation. Only 1 decision runs at a time. The driver supplies no
strategy or gameplay decisions. Observation cursors advance only after
a successful decision, so tool calls cannot hide events from the next.

`agy` owns provider retries and their delays. It can report a turn as `ERROR`
after recovering within it, for example from a malformed tool call, so an
unsuccessful result counts as a failure with its reported reason, like a process
failure. A persistent quota or credit stop ends the player after 3 attempts.
Failures get bounded retries, with the same
conversation ID and observation cursor. The recovery prompt says earlier actions
may already have applied; the driver never repeats them. 3 consecutive failures stop the connector. Match end, elimination and signals
end the model. The CLI print timeout defaults to 15 minutes; change it
with `--print-timeout`. No outer `castellan run` loop relaunches the player.

Stream output passes unchanged. `result.usage` is cumulative per
conversation: use its latest value per conversation ID, or calculate deltas,
instead of summing every decision's value.

## Persistent command transport

Set `CASTELLAN_AGY_TRANSPORT=cli` to use the command bridge instead. 1 MCP process
stays connected for the whole player session. A private Unix socket connects the temporary `bin/castellan-tool`
wrapper to that process. The wrapper takes exactly a tool name and 1 JSON
object, and exposes the same 7 tools, schemas, validation and responses:
`guide`, `state`, `act`, `script`, `run`, `chat` and `history`.

The bridge fixes the server and player token at startup; wrapper arguments and
environment overrides cannot redirect it. Scripts are inline JSON strings for the
game sandbox. The wrapper accepts no local file arguments or host commands.
Requests are never retried automatically.

Responses over 6,000 characters or 60 lines are saved complete in the player's
private `tool-output/` directory. For orders, script uploads and sent messages, a
short preview keeps the complete receipt, with every rejection and mineral
change. The next decision supplies a fresh full observation. Other actions in the same
turn can still use the saved response. Unknown formats or large
receipts fall back to the full saved result. Rules, custom `run` values/logs and script reads are never
previewed.

The launcher pre-approves only the absolute wrapper command, tool schemas, the
private output directory and its own conversation's saved outputs. File writes and
web access are denied. Other actions keep Antigravity's default approval; global
customizations may still be discovered. This is
a tool permission boundary, not an OS sandbox. No global settings are edited.

On exit, the launcher closes the bridge, removing its project registration,
socket, wrapper and output files. Antigravity keeps its normal logs.
Replay metadata records the persistent conversation and bridge policies.

## Verify actual tool access

A working executable or model list does not prove that a model can use game
tools. Run this diagnostic before a match:

```sh
AGY_ADC_AUTH=true node connectors/loop-keepers/antigravity/preflight.mjs \
  --model gemini-4-argon-low --effort low --transport mcp
```

It spends 1 model prompt on a disposable local server, never a game. To
pass, the model must make real `guide` and `state` requests and return the fresh
nonces from both. CLI exit zero or `SUCCESS` alone is not enough. A 60-second
host deadline stops the process and its children, and temporary resources are
removed. Regression tests use fake model
processes and never call paid models.

To check the command bridge instead, run the diagnostic with `--transport cli`.

References: [headless mode](https://antigravity.google/docs/cli/headless/),
[MCP configuration](https://antigravity.google/docs/mcp?tab=cli),
[permissions](https://antigravity.google/docs/permissions?tab=cli), and
[Google Cloud authentication](https://antigravity.google/docs/enterprise).
