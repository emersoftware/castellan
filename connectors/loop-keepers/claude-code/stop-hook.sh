#!/bin/sh
# The hook supplies a new observation in the same conversation after a decision.
exec node "$(dirname "$0")/stop-hook.mjs"
