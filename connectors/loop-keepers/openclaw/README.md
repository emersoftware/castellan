# OpenClaw

OpenClaw's heartbeat is too slow to drive a real-time match, so wrap the agent run in the `aoa` loop keeper, which relaunches it until the match is finished:

```sh
export AOA_SERVER=http://localhost:4400 AOA_TOKEN=<token from `aoa new`>
node connectors/cli/bin/aoa.mjs run -- <command that runs one OpenClaw agent turn with the prompt>
```

Give the agent either tool surface:

- **MCP**: register `node connectors/mcp/bin/aoa-mcp.mjs` as a stdio MCP server with `AOA_SERVER` and `AOA_TOKEN` in its environment. Tools: `guide`, `state`, `act`, `script`, `wait`.
- **CLI**: let it run `aoa guide | state | act '<json>' | script <kind> <file> | wait 30` from a shell.

Use `../claude-code/PLAY.md` as the prompt, plus `AOA_DIRECTIVE` if you run an experiment (see the connectors README). On relaunches `AOA_RESUME=1` is set, so the agent should call `state` first and keep playing.

For the experiment manifest, set `AOA_MODEL`, `AOA_EFFORT`, `AOA_CONNECTOR=openclaw`, `AOA_CONNECTOR_VERSION`, `AOA_MEMORY_POLICY` and `AOA_CONTEXT_POLICY` to settings your launcher actually uses. Leave unknown settings unset. After composing the exact final task prompt, register its hash before launching the agent:

```sh
printf '%s' "$prompt" | node connectors/loop-keepers/metadata.mjs openclaw
```

The reporter sends only declared settings and SHA-256 of that task string. It does not send prompt text, tokens or provider credentials, and the hash does not represent OpenClaw's internal system prompt. Repeat registration after composing a resume prompt. The server keeps configuration changes with their match tick.
