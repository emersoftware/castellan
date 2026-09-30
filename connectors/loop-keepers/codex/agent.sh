#!/bin/sh
# One `codex exec` session. `aoa run` (play.sh) relaunches it with AOA_RESUME=1 if it exits mid-match.
here=$(cd "$(dirname "$0")" && pwd)
prompt=$(cat "$here/../claude-code/PLAY.md")
if [ -n "$AOA_RESUME" ]; then
  prompt="You were restarted in the middle of the match: call state first, then keep playing.

$prompt"
fi
# Optional experiment instruction for this player only (see connectors/README.md).
if [ -n "$AOA_DIRECTIVE" ]; then
  echo "aoa codex: directive: $AOA_DIRECTIVE" >&2
  prompt="$prompt

$AOA_DIRECTIVE"
fi

# Isolated player: a private CODEX_HOME that only reuses your login (no personal AGENTS.md,
# config, memories, plugins or sessions) and an empty working directory (no project docs).
real_home="${CODEX_HOME:-$HOME/.codex}"
[ -f "$real_home/auth.json" ] || { echo "aoa codex: log in with \`codex login\` first" >&2; exit 1; }
run=$(mktemp -d "${TMPDIR:-/tmp}/aoa-codex-XXXXXX")
mkdir -p "$run/home" "$run/workspace"
ln -s "$real_home/auth.json" "$run/home/auth.json"
trap 'rm -rf "$run"' EXIT
trap 'kill -TERM "$pid" 2>/dev/null' INT TERM

# Only the aoa MCP tools: Codex's shell, unified exec, browser, computer use, images, apps,
# plugins, subagents, memories and web search are off. Code mode stays on because it is
# how Codex calls MCP tools; without a shell it cannot run commands, read files or fetch.
CODEX_HOME="$run/home" codex exec --skip-git-repo-check --ephemeral --ignore-user-config --ignore-rules \
  -s read-only -C "$run/workspace" \
  --disable shell_tool --disable unified_exec --disable view_image \
  --disable browser_use --disable browser_use_external --disable in_app_browser --disable computer_use \
  --disable image_generation --disable apps --disable plugins --disable remote_plugin --disable hooks \
  --disable multi_agent --disable memories --disable skill_search --disable tool_suggest --disable goals --disable sleep_tool \
  -c 'web_search="disabled"' -c project_doc_max_bytes=0 \
  -c approval_policy=never \
  -c 'mcp_servers.aoa.command="node"' \
  -c "mcp_servers.aoa.args=[\"$here/../../mcp/bin/aoa-mcp.mjs\"]" \
  -c 'mcp_servers.aoa.env_vars=["AOA_SERVER","AOA_TOKEN"]' \
  -c 'mcp_servers.aoa.tool_timeout_sec=60' \
  -c 'mcp_servers.aoa.default_tools_approval_mode="approve"' \
  "$@" "$prompt" </dev/null &
pid=$!
wait "$pid"; status=$?
# A signal interrupts the first wait; collect the real exit status.
kill -0 "$pid" 2>/dev/null && { wait "$pid"; status=$?; }
exit "$status"
