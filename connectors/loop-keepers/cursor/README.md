# Cursor terminal player

Runs Cursor CLI (`agent`) against the AoA MCP, one decision per fresh observation,
resuming the same private conversation until elimination or match end. The
connector supplies observations and the shared `PLAY.md`, never a strategy.

```sh
agent login
agent models
agent about --format json                  # reports the actual subscription tier
pnpm server
pnpm aoa new --name grok --bot eco
AOA_TOKEN=<player-token> connectors/loop-keepers/cursor/play.sh --model grok-4.7 --effort low
```

The default is `grok-4.7-low`. As of October 2026, **Plus only permits Grok at
medium effort, standard speed**. Select it explicitly if desired:

```sh
AOA_TOKEN=<player-token> connectors/loop-keepers/cursor/play.sh --model grok-4.7 --effort medium
```

Exact model IDs also work (`--model grok-4.7-low`); conflicting effort flags,
`auto`, and arbitrary CLI flags are rejected. The connector never changes model
or effort to bypass a plan restriction. Listing a model does not prove your plan
can use it. A short tool-free request checks access **before joining the seat**;
this request counts toward provider usage. Plan/auth errors fail clearly before
starting the game. This is not a subscription purchase or upgrade.

Supports `AOA_SERVER`, `AOA_DIRECTIVE`, and `aoa run-series` with a fresh session
per game. `AOA_CURSOR_BIN` can select another Cursor CLI executable.

## Isolation and authentication

Each launch gets a temporary HOME, config, data store and empty workspace, so
personal rules, MCP servers, plugins and previous sessions are not loaded.
Shell commands, file reads/writes and web fetches are denied by Cursor permission
rules. Only the `aoa` MCP is configured and allowlisted. No `--force`/`--yolo` is
used. Cursor may still display built-in tools: this uses permission enforcement,
not a claim that the CLI removes every built-in tool from the model's schema.

Credentials come from `CURSOR_AUTH_TOKEN` / `CURSOR_API_KEY`, or the existing
Cursor login (macOS Keychain; Cursor's file credential store on other systems).
The child uses Cursor's in-memory credential store, so it does not attempt to
read or write a Keychain in its temporary HOME. The bearer token is passed in
the child environment, never in arguments, game
prompts, metadata or configuration files. It is not refreshed by this connector;
if it expires, renew the normal Cursor login and restart. The MCP configuration
contains only the player's own game token and server address, is mode 0600, and
is deleted with the temporary directory on exit. Logs redact known credentials.

## Lifecycle and errors

- The tool-free access check uses a separate conversation from the match.
- A complete successful `result` event is required, even when the CLI exits 0.
- Failed turns keep their session (orders may already have executed) and the
  last successfully delivered observation cursor. Retries receive a fresh view.
- Temporary failures use exponential backoff (2–30 seconds), with a maximum of
  eight consecutive failures. Access/plan errors stop immediately.
- The watchdog stops a call after three minutes without stream activity. Active
  reasoning and tool events reset it; there is no fixed three-minute turn cutoff.
  Each prompt explicitly asks Cursor to finish one decision so the connector can
  deliver the next observation. This does not impose a strategy or guarantee low
  model latency. Match finish, elimination and signals
  cancel in-flight inference, with forced termination if the CLI does not exit.
- Experiment metadata records the requested model, effort, CLI version, prompt
  hash and isolation policy. The provider's reported model appears in CLI logs.

Capture logs with shell redirection if needed. The normal match replay is saved
by the game server. No account credentials are included in replay metadata.

```sh
pnpm exec vitest run connectors/cli/test/cursor.test.ts
```

References: [Cursor permissions](https://cursor.com/docs/cli/reference/permissions),
[stream output](https://cursor.com/docs/cli/reference/output-format),
[Grok effort restrictions](https://cursor.com/docs/models/grok-4-7).
