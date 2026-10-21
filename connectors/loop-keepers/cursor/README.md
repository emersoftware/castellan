# Cursor terminal player

This player runs Cursor CLI (`agent`) against the Castellan MCP, 1 decision per
fresh observation. It resumes the same private conversation until elimination or
match end. The connector supplies the shared turns
(`../turns.mjs`) and observations, never a strategy.

```sh
agent login
agent models
agent about --format json                  # reports the actual subscription tier
pnpm server
pnpm castellan new --name grok --bot eco
CASTELLAN_TOKEN=<player-token> connectors/loop-keepers/cursor/play.sh --model grok-4.7 --effort low
```

The default is `grok-4.7-low`. As of October 2026, **Plus only permits Grok at
medium effort, standard speed**. Select it explicitly if desired:

```sh
CASTELLAN_TOKEN=<player-token> connectors/loop-keepers/cursor/play.sh --model grok-4.7 --effort medium
```

Exact model IDs also work (`--model grok-4.7-low`). It rejects
conflicting effort flags, `auto`, and arbitrary CLI flags. It never changes model
or effort to get around a plan restriction. A listed model may still be blocked
by your plan, so a short tool-free request checks access **before joining the
seat**. This request counts toward provider usage. Plan and auth errors fail
clearly before the game. It buys or upgrades nothing.

The connector supports `CASTELLAN_SERVER`, `CASTELLAN_DIRECTIVE`, and
`castellan run-series`, with a fresh session per game. `CASTELLAN_CURSOR_BIN`
selects another Cursor CLI executable.

## Isolation and authentication

Each launch gets a temporary HOME, config, data store and empty workspace, so
personal rules, MCP servers, plugins and previous sessions do not load. Cursor
permission rules deny shell commands, file reads/writes and web fetches. Only the
`castellan` MCP is configured and allowlisted. The connector does not use
`--force`/`--yolo`. Cursor may still show built-in tools: the connector relies on
permission enforcement, not on the CLI removing them from the model's schema.

Credentials come from `CURSOR_AUTH_TOKEN` / `CURSOR_API_KEY`, or the existing
Cursor login (macOS Keychain; Cursor's file credential store on other systems). The child uses Cursor's in-memory
credential store, so it does not try to read or write a Keychain in its temporary
HOME. The bearer token goes in the child environment, never in arguments, game
prompts, metadata or configuration files. It is not refreshed here. If it expires, renew the normal Cursor
login and restart.

The MCP configuration holds only the player's own game token and server address,
has mode 0600, and is deleted with the temporary directory on exit.
Logs redact known credentials.

## Lifecycle and errors

- The tool-free access check uses a separate conversation from the match.
- A complete successful `result` event is required, even when the CLI exits 0.
- A failed turn keeps its session (orders may already have run) and the last
  delivered observation cursor. Retries get a fresh view.
- Temporary failures use exponential backoff (2–30 seconds). After 8 failures in
  a row, the connector stops. Access and plan errors stop it at once.
- The watchdog stops a call after 3 minutes with no stream activity. Active
  reasoning and tool events reset it. There is no fixed 3-minute turn limit.
  Turns carry no extra lifecycle instruction. `guide` explains that each response
  is 1 decision. This sets no strategy and does not guarantee low latency.
  Match finish, elimination and signals cancel inference in progress, and force
  the CLI to stop if it does not exit.
- Experiment metadata records the requested model, effort, CLI version, prompt
  hash and isolation policy. CLI logs show the model the provider reports.

Use shell redirection to keep logs. The game server saves the match replay. Replay metadata includes no account credentials.

```sh
pnpm exec vitest run connectors/cli/test/cursor.test.ts
```

References: [Cursor permissions](https://cursor.com/docs/cli/reference/permissions),
[stream output](https://cursor.com/docs/cli/reference/output-format),
[Grok effort restrictions](https://cursor.com/docs/models/grok-4-7).
