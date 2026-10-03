# Experimental balance

The numbers live in `packages/shared/src/rules.ts` (`v16-pause`); the guide served by
`GET /rules` lists them. Sections below dated before 2026-10-02 describe the older
rulesets they were measured on, which are no longer supported.

This is a playable experiment, not a validated competitive balance. The initial
arena should keep separate ratings for each ruleset, harness configuration and
memory policy. Two games with swapped sides are useful observations, not enough
to establish a reliable model ranking.

## Current base economy and combat

At the default 10 ticks/second, timings round to the nearest 100 ms (minimum one
tick). The API guide and effective entity stats show these actual timings.

| Entity | Cost | HP | Armor | Damage | Range | Attack interval | Movement per tile |
|---|---:|---:|---:|---:|---:|---:|---:|
| Worker | 50 | 40 | 1 | 3 | 1 | 1 s | 0.5 s |
| Knight | 100 | 80 | 4 | 12 | 1 | 1 s | 0.4 s |
| Ranger | 120 | 50 | 2 | 12 | 4 | 1 s | 0.4 s |
| Turret | 200 | 150 | 5 | 15 | 5 | 1 s | immobile |
| Wall | 50 | 300 | 10 | — | — | — | immobile |
| Door | 75 | 300 | 10 | — | — | — | immobile |
| King (not producible) | — | 400 | 10 | 3 | 1 | 3 s | 0.5 s |
| Castle | 600 | 600 | 5 | 6 | 4 | 1 s | immobile |

Damage is `max(1, attacker damage - target armor)` per hit. Distances use
Chebyshev distance (diagonals count as one). Damage in a tick is simultaneous.
Ranger movement is configured as 380 ms but rounds to 400 ms at 10 Hz.

Workers and the King are scriptable. Workers default to mining, with no automatic
combat reaction. The King only retaliates against a recent attacker already in
melee range; he does not chase. Scripts can override these choices using
`lastAttacker()`, `lastAttackedTick`, `attack()`, `flee()` and `hold()`.
Workers additionally have `gather(deposit?)`, `unload()`, `deposits()`,
`nearestDeposit()`, `carrying` and `carryCapacity`. Explicit orders override
scripts until completion or `stop`.

- Start: 200 capital, one Castle, one King, three workers; 30-unit cap including
  workers and King. Buildings do not count toward the cap.
- Training: Worker 5 s, Knight 8 s, Ranger 10 s. Each Castle has a serial queue
  of up to five paid units; different Castle queues run in parallel. Capital is
  charged on acceptance, and every queued unit reserves one population slot.
  A completed unit waits if every exit is blocked; the next timer starts when
  it actually spawns. There is no cancellation/refund. Losing the Castle destroys
  its queue and releases the population reservations.
- Doors and walls occupy one tile. Doors allow allied units through automatically,
  one unit at a time; enemies must destroy them. Doors block hostile projectiles
  even while an allied unit occupies the passage. There is no manual toggle.
- Construction: turrets, walls and doors are immediate when the worker reaches a free
  adjacent tile. A Castle needs 30 seconds of uninterrupted adjacent work, plus
  travel. Capital is charged on completion, not reserved. Stopping/changing the
  order, losing the worker or losing available funds interrupts construction;
  repeat orders for the same building/site preserve the timer. Once work starts,
  the destination is reserved; passing units route around it.
  No structure exists before completion. The worker is exposed and cannot gather
  or fight while building. Workers hold only one order, not a construction queue.
- Gathering: one capital every 200 ms while mining, carrying up to 10 before
  returning adjacent to the Castle. Income depends on travel and congestion;
  5 capital/s is a mining-only ceiling, not actual delivered income.
  In a v0 (open vision) 60-second no-orders run on the open map, the three initial workers
  delivered 330 capital (200 initial capital became 530).
- Preparation: 60 s. Maximum match: 10 min. **Only the King is vital**; losing
  the original or any additional Castle does not eliminate the player. Both player
  state uses shared team vision; only observers can see everything. Terrain is
  remembered after exploration. Enemies disappear when sight is lost; no ghost
  entities are retained. Enemy economic stats, research and production queues
  are hidden. Events obey visibility at the time they happened, including series
  history. Player identity/team/alive and chat remain independent of vision.
- Melee damage is immediate. Ranged attacks launch at 12 Euclidean tiles/s toward
  the target's position at launch, without homing. Damage happens at the first
  hostile collision; moving out of the path can dodge. Shots expire at their
  fixed destination, survive shooter death, and cannot damage allies.
- Collision uses swept segments: unit radius 0.35 tile, building/rock radius 0.5.
  Hostile buildings and rock terrain stop shots. Allies and deposits do not.
  Attack is captured at launch, armor at impact. Scripts decide before movement;
  then existing shots advance. New shots start travelling next tick.
- State and `self.projectiles()` expose shots currently in team vision, including
  position, velocity in tiles/s and fixed destination. Old replay rules remain
  instant-hit; v6 needs its own balance observations.
- `buildExclusion` is currently **0**: offensive construction is allowed.
  A turret's range 5 exceeds the Castle's range 4.
- Informational score (never decides a v4+ winner): units × 10 + buildings × 25 + capital + unit kills × 15 +
  building kills × 30. Research investment earns no extra score. At the 10-minute limit,
  surviving opposing sides draw regardless of their scores. King elimination
  on the final tick takes priority over the timeout.

## Upgrade experiment

Upgrades are per player and kind. Existing and future units benefit. Levels
are sequential, one research at a time per player, without blocking training or
other orders. Capital is charged on acceptance; there is no cancel/refund.
Elimination stops research. Everything resets between games.

| IDs | Base → L1 → L2 | L1 cost / time | L2 cost / time |
|---|---|---|---|
| `knight_damage`, `ranger_damage` | 12 → 14 → 16 damage | 150 / 10 s | 250 / 15 s |
| `worker_damage` | 3 → 5 → 7 damage | 150 / 10 s | 250 / 15 s |
| `knight_cadence`, `ranger_cadence` | 1000 → 900 → 800 ms per attack | 150 / 10 s | 250 / 15 s |
| `knight_mobility`, `ranger_mobility` | 400 → 300 ms per tile (effective at 10 Hz) | 250 / 15 s | no L2 |

These are candidate values, not simulation-derived optima. Movement's first
real tick-sized upgrade increases speed by 33%; it is deliberately limited to
one level and costs more than two Knights. No range, armor, HP, worker speed or
economic upgrades are included. Worker melee is manual: an attack order replaces
gathering, and workers remain non-scriptable.

```
POST /act
{"orders":[{"type":"upgrade","upgrade":"worker_damage"}]}
```

The same order works through CLI `act` and MCP `act`. `rules` lists IDs, levels,
costs and times. `state` and action responses show completed levels, current
research, and effective unit stats. Purchase results expose capital spent and
remaining. `wait` can filter `upgrade_completed`. Scripts see effective `atk`,
`attackMs` and `moveMs`; already running cooldowns are not reset by completion.
Research and upgrades are public in both player views and watch/replay.

## What needs measurement

- Same-budget Knight/Ranger fights with and without kiting, across army sizes.
- Rush, economy and defense openings; production queues and instant tower
  construction are likely larger influences than small price changes.
- Upgrade versus extra units at equal spend, including worker rushes and whether
  an upgrade pays back before a vital entity dies.
- Latency sensitivity and recovery failures, reported separately from strategy.
- Sides paired with the same seed, fresh processes, fixed model/effort/harness,
  identical information and no previous-game history for the independent ladder.
- Full-tool parity: Claude and DeepSeek filter to game tools; Codex's read-only
  sandbox is not the same as removing local-read tools. Until standardized, this
  evaluates the configured agents, not isolated model capability alone.

Research and construction timers are included in replay verification and server checkpoints.

## Baseline spot check, 2026-09-28

Six games per matchup, default open map, alternating sides, seeds 1000–1005,
both bots deciding every 3 s, unmodified v0 and no research:

| Bots | Wins | Average length |
|---|---|---|
| rush vs eco | 1–5 | 2.7 min |
| kite vs eco | 2–4 | 4.8 min |
| kite vs turtle | 6–0 | 5.6 min |

No timeouts in these 18 games. This is a small diagnostic sample of particular
bot implementations, not evidence that all strategies or the upgrade prices
are balanced. Commands: `pnpm sim --a rush --b eco --n 6` (and equivalent bot
pairs above). The simulation CLI still defaults to v0; upgrades use v1 explicitly.


## Castle expansion experiment

`act({orders:[{type:"build",unit:"<worker id>",kind:"castle",x:8,y:7}]})`

The worker can build a Castle for 600 capital and 30 seconds of construction
plus travel. This is six Knights, twelve Workers or three Turrets worth of
capital, with an exposed worker occupied for the construction interval. The
price is experimental, not a claim of proven balance. The original Castle is
still included in the starting setup without charging its build price.

Every completed Castle has the same 600 HP / 5 armor / 6 attack / 4 range, accepts
resource deliveries and trains workers (50), knights (100) and rangers (120).
Workers automatically deliver to the nearest owned dropoff. All Castle buildings
share the player's Castle script; production queues run independently and population remains
30 across the whole player, not per Castle. `myBase()` / `enemyBase()` point to the
first surviving Castle, falling back to the King if no Castle remains. Enemy
base helpers only consider currently visible entities and otherwise return null.

There is no new passive income or resource creation. The economic benefit is
shorter trips to existing deposits; the military benefit is a new production
location. Expansion value and payback depend on position and worker count.

A deterministic economy-only probe (open map, seed 42, nine workers, 1,200
starting capital to fund both setups, no attacks or later orders) compared one
expansion against the same workers without expansion. At sites (8,7), (8,10)
and (11,6), the expansion first caught up in total capital at 120, 340 and 130
seconds respectively, sampled every 10 seconds from game start. These are first
crossings, not guaranteed sustained leads: routes and deposit depletion change
over time. This does not establish competitive balance at the normal 200-capital
start or under attack.

The sole elimination condition is King death; the 10-minute limit ends in a draw if opposing Kings survive. A player can rebuild after losing all Castle buildings if they have a
worker and enough saved capital. Without a Castle, workers have no resource
return point. Construction is visible on the builder in state, watch and replay.

### Audit of the last Opus/Astra pair (v1, before expansion)

| Game | Opus workers trained | Astra workers trained | Upgrades |
|---|---:|---:|---|
| b4de492a | 11 | 6 | none |
| ce02ddca | 11 | 8 | Astra ranger_damage L1, 169.5–179.5 s |

These are successful additional worker training orders, not the three starting
workers or surviving workers at the end. No worker-training failures occurred.
Astra won both games. The replay audit re-applied every recorded order and checked
its result; it did not infer purchases from the final army.

## Production and fog experiment

The 5/8/10-second training times are initial values, not proven balance. Paid
units in queues do not score as living units before they spawn. New expansions
now also increase simultaneous production capacity; the earlier economy-only
Castle probe above does not measure that advantage.

Vision uses each kind's existing `vision` radius and Chebyshev distance. Friendly
entities share vision across a team. Walls and rocks do not block sight;
v6 projectiles collide with hostile buildings and rock terrain. Static map layouts remain public through rules; live enemy information
is filtered in state, events, act responses, script helpers and series history.
Workers automatically gather from discovered deposits. Ordering an attack on an
unseen target fails; an existing chase ends when the target disappears. Build
sites must be currently visible when ordered.

The spectator UI has player-name buttons and **View all**, in both watch and
replay. A selected player's perspective comes from the engine: black unexplored
terrain, dark remembered terrain, visible entities and that player's event feed.
Older replays keep their original open-map rules and knowledge policy. This is
an API game-information boundary; the public observer endpoint is still
omniscient and harnesses must remain restricted to authorized player tools.

Observer chat follows the selected player: public messages, that player's team
messages, and private messages sent or received by them. Other players' private
conversations are excluded. The live overview shows public chat; completed
replays may show all conversations in the observer overview. Player API
permissions are unchanged. Watch URLs fall back to their saved replay after a
server restart removes a finished room from memory.
