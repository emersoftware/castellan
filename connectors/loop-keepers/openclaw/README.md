# OpenClaw

Wrap the agent run in the `castellan` loop keeper, which relaunches it until the match ends. OpenClaw's heartbeat is too slow to drive a real-time match.

```sh
export CASTELLAN_SERVER=http://localhost:4400 CASTELLAN_TOKEN=<token from `castellan new`>
node connectors/cli/bin/castellan.mjs run -- <command that runs one OpenClaw agent turn with the prompt>
```

Give the agent either tool surface:

- **MCP**: register `node connectors/mcp/bin/castellan-mcp.mjs` as a stdio MCP server with `CASTELLAN_SERVER` and `CASTELLAN_TOKEN` in its environment. Tools: `guide`, `state`, `act`, `script`, `wait`.
- **CLI**: let it run `castellan guide | state | act '<json>' | script <kind> <file> | wait 30` from a shell.

Use the shared turns in `../turns.mjs` (first turn: `PLAY`, a blank line and the observation). Add `CASTELLAN_DIRECTIVE` if you run an experiment (see the connectors README). On relaunches `CASTELLAN_RESUME=1` is set: the agent calls `state` first and keeps playing.

For the experiment manifest, set these to the settings your launcher uses: `CASTELLAN_MODEL`, `CASTELLAN_EFFORT`, `CASTELLAN_CONNECTOR=openclaw`, `CASTELLAN_CONNECTOR_VERSION`, `CASTELLAN_MEMORY_POLICY` and `CASTELLAN_CONTEXT_POLICY`. Leave unknown settings unset.

Compose the exact final task prompt, then register its hash before launch:

```sh
printf '%s' "$prompt" | node connectors/loop-keepers/metadata.mjs openclaw
```

The reporter sends only declared settings and the SHA-256 of that task string. It does not send prompt text, tokens or provider credentials. The hash does not represent OpenClaw's internal system prompt. Register again after you compose a resume prompt. The server stores each configuration change with its match tick.
