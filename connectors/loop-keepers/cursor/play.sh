#!/bin/sh
set -e
here=$(cd "$(dirname "$0")" && pwd)
. "$here/../legacy-env.sh"
exec node "$here/agent.mjs" "$@"
