#!/bin/sh
# Headless Claude Code player. The Stop hook in settings.json keeps it playing until the match ends.
#   AOA_TOKEN=<token from `aoa new`> ./play.sh [extra claude flags, e.g. --model opus]
set -e
here=$(cd "$(dirname "$0")" && pwd)
: "${AOA_TOKEN:?set AOA_TOKEN (see aoa new)}"
# By default Claude Code overrides a Stop hook after 8 blocks in a row; a match needs more.
export CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0
# Isolated player: none of your user/project settings (advisor, plugins, skills),
# no auto-memory (a player must not learn from previous matches), and no
# built-in tools: only the aoa MCP tools.
export CLAUDE_CODE_DISABLE_AUTO_MEMORY=1
# The instruction (AOA_PROMPT or the shared default, plus AOA_DIRECTIVE) is built by turns.mjs.
if [ -n "$AOA_DIRECTIVE" ]; then echo "aoa claude-code: directive: $AOA_DIRECTIVE" >&2; fi
# Run from an empty directory outside any git repo, so no project files, CLAUDE.md or
# git status reach the player. Config paths are made absolute for that directory.
work=$(mktemp -d "${TMPDIR:-/tmp}/aoa-claude-XXXXXX")
trap 'rm -rf "$work"' EXIT
trap 'kill -TERM "$pid" 2>/dev/null' INT TERM
sed "s|\.\./\.\./mcp/bin/aoa-mcp.mjs|$here/../../mcp/bin/aoa-mcp.mjs|" "$here/.mcp.json" > "$work/mcp.json"
sed "s|\$CLAUDE_PROJECT_DIR|$here|" "$here/settings.json" > "$work/settings.json"
node --input-type=module -e 'import { promptOf } from "'"$here"'/../turns.mjs"; process.stdout.write(promptOf())' | node "$here/../metadata.mjs" claude-code "$@"
cd "$work"
# Like every keeper: the first turn goes out once the room reaches prep.
first=$(node "$here/first-turn.mjs") || exit 0
claude -p "$first" \
  --setting-sources "" --tools "" --disable-slash-commands \
  --mcp-config "$work/mcp.json" --strict-mcp-config \
  --settings "$work/settings.json" \
  --allowedTools mcp__aoa --permission-mode dontAsk \
  "$@" &
pid=$!
set +e
wait "$pid"; status=$?
kill -0 "$pid" 2>/dev/null && { wait "$pid"; status=$?; }
exit "$status"
