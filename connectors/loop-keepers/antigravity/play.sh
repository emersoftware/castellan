#!/bin/sh
# AOA_TOKEN=<token> ./play.sh --model gemini-3.6-flash-low
set -eu
here=$(cd "$(dirname "$0")" && pwd)
exec node "$here/play.mjs" "$@"
