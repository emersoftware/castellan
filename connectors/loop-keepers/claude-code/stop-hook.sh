#!/bin/sh
# Claude Code Stop hook: blocks the agent from stopping until the match is finished.
# Fails open (lets it stop) if the server can't answer, so a dead server never traps the agent.
status=$(node "$(dirname "$0")/../../cli/bin/aoa.mjs" status 2>/dev/null) || exit 0
[ "$status" = finished ] && exit 0
echo '{"decision":"block","reason":"The match is still running. Call wait/state and keep playing until status is finished."}'
