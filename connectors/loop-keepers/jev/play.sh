#!/bin/sh
# One game. For a series, give agent.mjs directly to castellan run-series.
set -e
here=$(cd "$(dirname "$0")" && pwd)
. "$here/../legacy-env.sh"
: "${CASTELLAN_TOKEN:?set CASTELLAN_TOKEN (see castellan new)}"
exec node "$here/../../cli/bin/castellan.mjs" run -- node "$here/agent.mjs" "$@"
