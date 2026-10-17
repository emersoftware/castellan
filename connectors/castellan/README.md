# Castellan — an autonomous Age of Agents player

Castellan plays a whole match on its own, from the first worker to victory or defeat
(including the time limit under v24), using only what a player is allowed to see and do (the HTTP API with
its own token: `/guide`, `/wait`, `/state`, `/act`, scripts and chat). It exists to study
concrete strategic decisions in complete games: everything is decided by rules in code, and
every plan, choice and outcome is written to a journal. It never calls a model.

## Run it

```sh
pnpm server                                   # http://localhost:4400 (or any AOA_SERVER)
pnpm aoa new --name castellan --bot eco       # a room; prints AOA_TOKEN for the player seat
AOA_TOKEN=<token> pnpm castellan
```

Flags: `--log <dir>` (default `runs/castellan`), `--name`, `--wait <s>` (long-poll per cycle,
default 1). The player works with `aoa run`, `aoa run-series`, teams and free-for-all rooms,
with or without chat. It never reads the spectator link.

Headless (no server, no real time), against the reference bots:

```sh
pnpm --filter @aoa/castellan bench --bots rush,eco,turtle,kite,archers --maps open,fortress --n 2
pnpm --filter @aoa/castellan bench --seats castellan,castellan,eco,rush --maps quad --mode teams   # 2v2 with chat
pnpm --filter @aoa/castellan bench --seats castellan,castellan,castellan,castellan --maps quad --mode ffa
```

Real-time evidence runs on a live server (one process per castellan seat, a `result.json`
and a journal per player under `evidence/<name>/`):

```sh
pnpm --filter @aoa/castellan evidence --name A1 --seats castellan,rush --map open
pnpm --filter @aoa/castellan evidence --name C2 --seats castellan,castellan,castellan,castellan --map quad --mode ffa --chat
```

Tests: `npx vitest run connectors/castellan/test` (unit tests, headless matches and a short
real-time match against an in-process server).

## How it is built

```
runtime.ts    real-time loop: GET /wait (≤1 s) → core.step(view) → POST /act
core.ts       one decision cycle = perceive → strategy → diplomacy → executor; pure over PlayerView + memory
perception.ts world model: own units, sightings with memory, threat groups, deposit clusters, strengths
strategy.ts   posture, keep, expansion, defence of the expansion, attack/retreat, research, scouting
executor.ts   economy (worker assignment), production, construction tasks, research, unit scripts, recovery
scripts.ts    parameterised unit scripts (worker/knight/archer/king/tower/castle), re-uploaded when params change
diplomacy.ts  team coordination and free-for-all truces
journal.ts    JSONL journal + Markdown summary: observed, decided, attempted, what happened
```

Only `@aoa/shared` types and the `@aoa/cli` HTTP client are imported; the engine is used by
tests alone. Rules come from `GET /guide` of the room, so other rulesets or maps work as long
as the kinds keep their names.

**Routine (always on).** Workers are assigned per deposit (home clusters, then the expansion),
re-balanced when deposits deplete or fighters sit next to a cluster (it becomes unsafe for 20 s).
Production trains workers to a target that follows the live deposits, then an army with a
composition that answers what has been seen (more knights against knights, archers and towers
against archers). Construction is a task list with priorities: a builder is chosen, walks until
the site is visible, builds, and the task is re-planned on `order_end`, builder death, threats
near the site or `not enough mineral`; a site rejected as occupied is dropped. Mineral is only
held back for a planned investment while home is quiet. Unit scripts carry roles: guard a post,
attack toward a target (fighters first, workers, then buildings, walls only when stuck), retreat
to the rally point, scout waypoints, or hold a tile inside the keep. Explicit orders are used
for building, moving a builder and stopping stale orders.

**Strategic layer (rules).**
- Posture `boom` → `defend` when a threat group is near home or the king; `attack` when the army is
  ready (after minute 3, or a counterattack right after a wave died at my walls); `retreat` when the
  attacking force lost half its strength, is outnumbered 1.3× at the target or makes no progress.
- The keep: after the first assault is repelled (or by minute 3), in a lull, eight walls and two doors
  close the corner around king and castle; a tower inside cannot be reached by melee. When a force at
  least as strong as the army arrives, workers and army hold inside (turtle) while archers, towers and
  the castle shoot over the walls; when it passes, mining resumes.
- Expansion: with eight or more army units and 45 s of quiet after minute 2:30 (earlier if home mines
  are below 65 %), a castle next to the safer flank mines. Four workers and a tower follow; losing it
  is recorded as a strategic failure. A threat at the expansion is met with the army when it is 1.2×
  stronger, otherwise the workers come home.
- Research: damage/cadence of the main unit, mobility first against archer-heavy enemies, bought only in
  a lull once eight units exist.
- Chat: in teams it reports attacks, defences and expansions with coordinates and joins an ally's
  `attack (x,y)`; in free-for-all it proposes truces until minute 5, accepts them, and marks them broken
  when that player's units hit mine (walking into a castle's range does not count).

## Journal

`<log>/<room>-<player>.jsonl` has one entry per event with `t` (wall clock), `tick` and `type`:
`init`, `posture`, `workers_assigned`, `mines_unsafe`, `evacuation`, `turtle`, `build_planned/started/done/
interrupted/failed`, `order_rejected`, `research`, `scout`, `expansion_*`, `attack_start/march/reinforce`,
`retreat`, `episode_start/end`, `expansion_candidates`, `expansion_threat`, `expansion_defense`,
`home_threat_choice`, `endgame`, `chat_sent/received`, `truce*`, `script_error`,
`runtime_error`, `match_end`. The Markdown summary lists the episodes (plans with a goal) with
their status: `completed`, `failed_execution` (the plan could not be carried out), `failed_outcome`
(carried out, bad result), `abandoned` (superseded or no longer worth it), plus rejected orders
by reason and the plan at the end.

## Evidence

See [EVIDENCE.md](EVIDENCE.md) for the recorded matches (headless benchmarks and real-time
rooms with replay links).

## Known limits

- Tuned against the reference bots under `v21d-no-unlocks` on the open map; fortress and quad are
  exercised less. The eco bot (nine workers, knights nonstop, waves of eight) usually ends in a draw:
  the keep holds but no window opens to take its king. The kite bot (eight kiting archers at minute 2)
  beats the player: knights are kited, and the tower arrives too late.
- In a 2v2 against eco+rush both allies attack the same corner too early and lose; coordination is
  limited to reporting and joining an ally's `attack (x,y)`.
- The turtle relies on the opponent not attacking walls; a player that breaches the keep gets in.
- Attack control is coarse: one target point, fighters before buildings, retreat by thresholds.
- Scripts share one source per kind, so roles are baked into the script (≤4 KB, about 20 units).
