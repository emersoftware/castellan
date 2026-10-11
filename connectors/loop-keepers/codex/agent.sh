#!/bin/sh
# Automatic decisions, one isolated Codex conversation per match.
here=$(cd "$(dirname "$0")" && pwd)
exec node "$here/agent.mjs" "$@"
