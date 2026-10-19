#!/bin/sh
# Automatic Codex decisions in one isolated conversation until elimination or match end.
#   CASTELLAN_TOKEN=<token from `castellan new`> ./play.sh [extra codex exec flags, e.g. -m gpt-5]
set -e
here=$(cd "$(dirname "$0")" && pwd)
: "${CASTELLAN_TOKEN:?set CASTELLAN_TOKEN (see castellan new)}"
exec "$here/agent.sh" "$@"
