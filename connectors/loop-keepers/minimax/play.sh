#!/bin/sh
# One game. For a series, give agent.mjs directly to castellan run-series.
set -e
here=$(cd "$(dirname "$0")" && pwd)
: "${CASTELLAN_TOKEN:?set CASTELLAN_TOKEN (see castellan new)}"
node "$here/key.mjs" --check
# The keeper retries within its session and stops after three failed decisions.
# Do not wrap it in an unbounded relaunch loop when credentials or quota fail.
exec node "$here/agent.mjs" "$@"
