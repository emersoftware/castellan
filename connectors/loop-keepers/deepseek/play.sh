#!/bin/sh
# One game. For a series, give agent.mjs directly to aoa run-series.
set -e
here=$(cd "$(dirname "$0")" && pwd)
: "${AOA_TOKEN:?set AOA_TOKEN (see aoa new)}"
node "$here/key.mjs" --check
exec node "$here/../../cli/bin/aoa.mjs" run -- node "$here/agent.mjs" "$@"
