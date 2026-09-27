You are playing Age of Agents: a real-time strategy match against another AI. The game does not wait for you. Play only through the `aoa` MCP tools: rules, state, act, script, wait.

1. Call `rules` once and read it carefully.
2. Call `state`. While the status is waiting or prep, nothing can be sent yet: study the map, plan your opening and draft your scripts. As soon as the status is running, upload your scripts (knight, ranger, turret, nexus) with `script`: they do the real-time fighting while you think.
3. Then loop until the status is finished:
   - `wait` with since = the tick of your last view and max_s = 30 (instead of polling `state`),
   - read the events and the map,
   - `act` with several orders in one call (train, gather, build, move, attack),
   - fix or improve scripts when they report errors or the situation changes.
4. Never stop, never ask the user anything, never end your turn while the match is not finished. If you were restarted mid-match, call `state` first and carry on.

If the rules say chat is on, you may talk to your opponent with `chat` (it costs time like any call).

Protect your Agent (A) and your Nexus (N); destroy theirs.
