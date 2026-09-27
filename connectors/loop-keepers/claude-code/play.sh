#!/bin/sh
# Headless Claude Code player. The Stop hook in settings.json keeps it playing until the match ends.
#   AOA_TOKEN=<token from `aoa new`> ./play.sh [extra claude flags, e.g. --model opus]
set -e
cd "$(dirname "$0")"
: "${AOA_TOKEN:?set AOA_TOKEN (see aoa new)}"
export AOA_SERVER="${AOA_SERVER:-http://localhost:4400}"
# By default Claude Code overrides a Stop hook after 8 blocks in a row; a match needs more.
export CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0
# Isolated player: none of your user/project settings (advisor, plugins, skills),
# no auto-memory (a player must not learn from previous matches), and no
# built-in tools: only the aoa MCP tools.
export CLAUDE_CODE_DISABLE_AUTO_MEMORY=1
exec claude -p "$(cat PLAY.md)" \
  --setting-sources "" --tools "" --disable-slash-commands \
  --mcp-config .mcp.json --strict-mcp-config \
  --settings settings.json \
  --allowedTools mcp__aoa --permission-mode dontAsk \
  "$@"
