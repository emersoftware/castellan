#!/bin/sh
# One `codex exec` session. `aoa run` (play.sh) relaunches it with AOA_RESUME=1 if it exits mid-match.
here=$(cd "$(dirname "$0")" && pwd)
prompt=$(cat "$here/../claude-code/PLAY.md")
if [ -n "$AOA_RESUME" ]; then
  prompt="You were restarted in the middle of the match: call state first, then keep playing.

$prompt"
fi
exec codex exec --skip-git-repo-check --ephemeral --ignore-user-config -s read-only -C "$here" \
  -c approval_policy=never \
  -c 'mcp_servers.aoa.command="node"' \
  -c "mcp_servers.aoa.args=[\"$here/../../mcp/bin/aoa-mcp.mjs\"]" \
  -c 'mcp_servers.aoa.env_vars=["AOA_SERVER","AOA_TOKEN"]' \
  -c 'mcp_servers.aoa.tool_timeout_sec=60' \
  -c 'mcp_servers.aoa.default_tools_approval_mode="approve"' \
  "$@" "$prompt" </dev/null
