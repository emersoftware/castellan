#!/bin/sh
# CASTELLAN_TOKEN=<token> ./play.sh --model gemini-3.6-flash-low
set -eu
here=$(cd "$(dirname "$0")" && pwd)
. "$here/../legacy-env.sh"
exec node "$here/play.mjs" "$@"
