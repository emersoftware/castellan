# Antigravity CLI player

Install Google's `agy` CLI and sign in once by running `agy` interactively.
Use the model identifiers printed by `agy models`. This uses Antigravity CLI,
not Gemini CLI or the desktop editor's command launcher.

Create a room and give this player its token:

```sh
pnpm aoa new --name antigravity --bot rush --chat
AOA_TOKEN=<player-token> connectors/loop-keepers/antigravity/play.sh \
  --model gemini-4-argon-low --effort low
```

For Vertex through Google Cloud, configure ADC once with
`gcloud auth application-default login --project <gcp-project>` and select that
project and region in Antigravity's Google Cloud settings:

```sh
AGY_ADC_AUTH=true AOA_TOKEN=<player-token> \
  connectors/loop-keepers/antigravity/play.sh --model gemini-4-argon-low --effort low
```

The ADC quota project and Antigravity's GCP project must identify the intended
billing project. The launcher inherits `AGY_ADC_AUTH`; it does not change global
authentication. `AOA_SERVER` defaults to `http://localhost:4400` and
`AOA_AGY_BIN` can select another executable. Model and effort arguments are
forwarded to `agy`. The driver owns the project, conversation, prompt and
stream-json protocol; external conversation/project overrides are rejected.

## Decisions and recovery

The launcher creates a temporary workspace and a unique project under
`~/.gemini/config/projects/`. It connects the player's seat once, then polls
`/status` during waiting/preparation without invoking the model. Once the game
runs, it opens a stream-json conversation. `init` provides the conversation ID
without a paid READY turn.

The first decision includes the common player instructions, room rules, tool
schemas and a fresh observation. Later decisions receive a fresh observation
in the same conversation, with at most one decision in flight. The driver
supplies no strategy and delegates no gameplay decisions. Observation cursors
advance only after successful decisions; tool calls cannot make intervening
events disappear from the next supplied observation.

Actual process failures trigger bounded retries using the same conversation ID
and observation cursor. The recovery prompt explains that earlier actions may
already have applied; the driver never repeats them. Three consecutive failures
stop the connector. Match end, elimination and signals terminate the model
process. The default CLI print timeout is 15 minutes and can be overridden with
`--print-timeout`. There is no outer `aoa run` relaunch loop.

Stream output is forwarded unchanged. `result.usage` is cumulative within a
conversation: use its latest value per conversation ID or calculate deltas;
do not sum every decision's cumulative usage.

## Persistent command transport

`cli` is the default transport. One MCP process remains connected for the whole
player session. A private Unix socket connects the temporary `bin/aoa-tool`
wrapper to that process. The wrapper accepts exactly a tool name and one JSON
object. It exposes the same eight tools, schemas, validation and responses:
`rules`, `state`, `act`, `script`, `run`, `chat`, `history` and `script_test`.

The bridge binds the server and player token at startup. Wrapper arguments and
environment overrides cannot redirect it. Scripts are inline JSON strings for
the game sandbox; the wrapper accepts no local file arguments or host commands.
Requests are never automatically retried.

Responses over 6,000 characters or 60 lines are saved intact in the player's
private `tool-output/` directory. For orders, script uploads and sent messages,
a short preview preserves the complete receipt, including every rejection and
mineral change; the next decision supplies a fresh full observation. The saved
response remains available when another action needs it within the same turn.
Unknown formats or large receipts fall back to reading the full saved result.
Rules, custom `run` values/logs and script reads are never reduced to previews.

Only the absolute wrapper command, tool schemas, private output directory and
own conversation's saved outputs are pre-approved. File writes and web access
are denied. Unlisted actions retain Antigravity's default approval behavior;
global customizations may still be discovered. This is a tool permission
boundary, not an OS sandbox. No global settings are edited.

On exit, the launcher closes the bridge and removes its project registration,
socket, wrapper and output files. Antigravity retains its normal conversation
logs. Replay metadata records the persistent conversation and bridge policies.

## Verify actual tool access

Executable/model-list checks do not prove that a model can use game tools. Run
this explicit diagnostic before committing to a match:

```sh
AGY_ADC_AUTH=true node connectors/loop-keepers/antigravity/preflight.mjs \
  --model gemini-4-argon-low --effort low --transport cli
```

It spends one model prompt against a disposable local server, never a game.
Success requires actual `rules` and `state` requests plus the fresh nonces from
both responses. CLI exit zero or `SUCCESS` alone is insufficient. A 60-second
host deadline stops the process and its children; temporary resources are
removed. Regression tests use fake model processes and never call paid models.

Native MCP remains available explicitly with `AOA_AGY_TRANSPORT=mcp`. In the
tested `agy 1.3.4`, MCP discovery succeeded but the model could not invoke the
tools, including with configuration produced by `agy mcp add`. Its underlying
cause is unresolved; use `--transport mcp` in the diagnostic to verify a future
CLI version before selecting it for a match. Native mode pre-approves only
`mcp(aoa/*)` and permitted output/schema reads; terminal commands are denied.

References: [headless mode](https://antigravity.google/docs/cli/headless/),
[MCP configuration](https://antigravity.google/docs/mcp?tab=cli),
[permissions](https://antigravity.google/docs/permissions?tab=cli), and
[Google Cloud authentication](https://antigravity.google/docs/enterprise).
