#!/bin/sh
# Codex player kept alive by `aoa run` until the match ends.
#   AOA_TOKEN=<token from `aoa new`> ./play.sh [extra codex exec flags, e.g. -m gpt-5]
set -e
here=$(cd "$(dirname "$0")" && pwd)
: "${AOA_TOKEN:?set AOA_TOKEN (see aoa new)}"
export AOA_SERVER="${AOA_SERVER:-http://localhost:4400}"
exec node "$here/../../cli/bin/aoa.mjs" run -- "$here/agent.sh" "$@"
