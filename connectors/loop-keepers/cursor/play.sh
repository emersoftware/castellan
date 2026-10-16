#!/bin/sh
set -e
here=$(cd "$(dirname "$0")" && pwd)
exec node "$here/agent.mjs" "$@"
