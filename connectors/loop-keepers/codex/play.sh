#!/bin/sh
# Automatic Codex decisions in one isolated conversation until elimination or match end.
#   AOA_TOKEN=<token from `aoa new`> ./play.sh [extra codex exec flags, e.g. -m gpt-5]
set -e
here=$(cd "$(dirname "$0")" && pwd)
: "${AOA_TOKEN:?set AOA_TOKEN (see aoa new)}"
exec "$here/agent.sh" "$@"
