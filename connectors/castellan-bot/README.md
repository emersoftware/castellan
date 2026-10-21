# Castellan Bot — an autonomous Castellan player

Castellan Bot plays a whole match on its own, from the first worker to victory or defeat (or the
time limit under v24). It uses only what a player may see and do: the HTTP API with its own token
(`/guide`, `/wait`, `/state`, `/act`, scripts and chat). It never calls a model. Rules in code
decide everything, and a journal records every plan, choice and outcome. Its purpose is to study
concrete strategic decisions in complete games.

## Run it

```sh
pnpm server                                   # http://localhost:4400 (or any CASTELLAN_SERVER)
pnpm castellan new --name castellan --bot eco       # a room; prints CASTELLAN_TOKEN for the player seat
CASTELLAN_TOKEN=<token> pnpm castellan-bot
```

Flags: `--log <dir>` (default `runs/castellan-bot`), `--name`, `--wait <s>` (long-poll per cycle,
default 1). The player works with `castellan run`, `castellan run-series`, teams and free-for-all
rooms, with or without chat. It never reads the spectator link.

Headless (no server, no real time), against the reference bots:

```sh
pnpm --filter @castellan/castellan-bot bench --bots rush,eco,turtle,kite,archers --maps open,fortress --n 2
pnpm --filter @castellan/castellan-bot bench --seats castellan,castellan,eco,rush --maps quad --mode teams   # 2v2 with chat
pnpm --filter @castellan/castellan-bot bench --seats castellan,castellan,castellan,castellan --maps quad --mode ffa
```

Real-time evidence runs use a live server: 1 process per castellan seat, and a `result.json` and
journal per player under `evidence/<name>/`:

```sh
pnpm --filter @castellan/castellan-bot evidence --name A1 --seats castellan,rush --map open
pnpm --filter @castellan/castellan-bot evidence --name C2 --seats castellan,castellan,castellan,castellan --map quad --mode ffa --chat
```

Tests: `npx vitest run connectors/castellan-bot/test` (unit tests, headless matches and a short
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

It imports only `@castellan/shared` types and the `@castellan/cli` HTTP client; only tests use the
engine. Rules come from the room's `GET /guide`. Other rulesets or maps work as long
as the kinds keep their names.

**Routine (always on).**
- Economy: workers go per deposit, home clusters first, then the expansion. The player re-balances
  them when deposits run out or fighters stand next to a cluster (unsafe for 20 s).
- Production: workers up to a target that follows the live deposits, then an army that answers
  what it has seen (more knights against knights, archers and towers against archers).
- Construction: a task list with priorities. A chosen builder walks until the site is visible and
  builds. The task is re-planned on `order_end`, builder death, threats near the site or
  `not enough mineral`. A site rejected as occupied is dropped.
- Mineral is held back for a planned investment only while home is quiet.
- Unit scripts carry roles: guard a post, attack toward a target (fighters, then workers, then
  buildings, walls only when stuck), retreat to the rally point, scout waypoints, or hold a tile
  inside the keep.
- Explicit orders build, move a builder and stop stale orders.

**Strategic layer (rules).**
- Posture: `boom` → `defend` when a threat group is near home or the king. `attack` when the army
  is ready (after minute 3, or a counterattack right after a wave died at my walls). `retreat` when
  the attacking force lost half its strength, is outnumbered 1.3× at the target or makes no progress.
- The keep: after the first assault is repelled (or by minute 3), in a lull, 8 walls and 2 doors
  close the corner around king and castle. Melee units cannot reach a tower inside. When a force at
  least as strong as the army arrives, workers and army hold inside (turtle). Archers, towers and
  the castle shoot over the walls. When the force passes, mining resumes.
- Expansion: with 8 or more army units and 45 s of quiet after minute 2:30 (earlier if home mines
  are below 65 %), a castle goes next to the safer flank mines. 4 workers and a tower follow. Losing
  it counts as a strategic failure. The army meets a threat at the expansion when it is 1.2×
  stronger. Otherwise the workers come home.
- Research: damage/cadence of the main unit, mobility first against archer-heavy enemies. Bought
  only in a lull, once 8 units exist.
- Chat: in teams, it reports attacks, defences and expansions with coordinates and joins an ally's
  `attack (x,y)`. In free-for-all, it proposes and accepts truces until minute 5. It marks a truce
  broken when that player's units hit its own (walking into a castle's range does not count).

## Journal

`<log>/<room>-<player>.jsonl` holds 1 entry per event with `t` (wall clock), `tick` and `type`:
`init`, `posture`, `workers_assigned`, `mines_unsafe`, `evacuation`, `turtle`, `build_planned/started/done/
interrupted/failed`, `order_rejected`, `research`, `scout`, `expansion_*`, `attack_start/march/reinforce`,
`retreat`, `episode_start/end`, `expansion_candidates`, `expansion_threat`, `expansion_defense`,
`home_threat_choice`, `endgame`, `chat_sent/received`, `truce*`, `script_error`,
`runtime_error`, `match_end`.

The Markdown summary lists the episodes (plans with a goal) and their status:
- `completed`
- `failed_execution`: the plan could not be carried out.
- `failed_outcome`: carried out, bad result.
- `abandoned`: superseded or no longer worth it.

It also lists rejected orders by reason and the plan at the end.

## Evidence

[EVIDENCE.md](EVIDENCE.md) lists the recorded matches (headless benchmarks and real-time rooms with
replay links).

## Known limits

- Tuned against the reference bots under `v21d-no-unlocks` on the open map. Fortress and quad get
  less testing.
- The eco bot (9 workers, knights nonstop, waves of 8) usually ends in a draw. The keep holds, but no
  window opens to take its king.
- The kite bot (8 kiting archers at minute 2) beats the player: knights are kited, and the tower
  arrives too late.
- In a 2v2 against eco+rush, both allies attack the same corner too early and lose. Coordination is
  limited to reporting and joining an ally's `attack (x,y)`.
- The turtle assumes the opponent does not attack walls. A player that breaches the keep gets in.
- Attack control is coarse: 1 target point, fighters before buildings, retreat by thresholds.
- Scripts share 1 source per kind, so the roles live inside the script (≤4 KB, about 20 units).
