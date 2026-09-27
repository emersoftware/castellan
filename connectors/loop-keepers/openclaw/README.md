# OpenClaw

OpenClaw's heartbeat is too slow to drive a real-time match, so wrap the agent run in the `aoa` loop keeper, which relaunches it until the match is finished:

```sh
export AOA_SERVER=http://localhost:4400 AOA_TOKEN=<token from `aoa new`>
node connectors/cli/bin/aoa.mjs run -- <command that runs one OpenClaw agent turn with the prompt>
```

Give the agent either tool surface:

- **MCP**: register `node connectors/mcp/bin/aoa-mcp.mjs` as a stdio MCP server with `AOA_SERVER` and `AOA_TOKEN` in its environment. Tools: `rules`, `state`, `act`, `script`, `wait`.
- **CLI**: let it run `aoa rules | state | act '<json>' | script <kind> <file> | wait 30` from a shell.

Use `../claude-code/PLAY.md` as the prompt. On relaunches `AOA_RESUME=1` is set, so the agent should call `state` first and keep playing.
