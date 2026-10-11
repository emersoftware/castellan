# Balance experiments

Current numbers are generated from
`packages/shared/src/rules.ts` into [CURRENT-RULES.md](docs/CURRENT-RULES.md).
`GET /rules` returns the exact guide for a room. Run `pnpm docs:rules` after edits;
`pnpm docs:check` checks that the snapshot is current.
Everything from **Archived base economy and combat** onward is historical and
must not be used as a current rules reference.

This is a playable experiment, not a validated competitive balance. The initial
arena should keep separate ratings for each ruleset, harness configuration and
memory policy. Two games with swapped sides are useful observations, not enough
to establish a reliable model ranking.

## v25-castle-knight: local defense and melee mobility, 2026-10-10

| Value | v24 | v25 |
|---|---:|---:|
| Castle range | 6 | 5 |
| Knight movement per straight tile | 500 ms | 400 ms |
| Knight movement with mobility research | 400 ms | 300 ms |

Costs, damage, armor, health, training, maps and agent instructions are unchanged.
These are numeric rules; the simulation mechanics have not changed. Historical
replays continue using their embedded rules.

**Hypothesis.** A Castle should defend its immediate economy, with longer-range
defense belonging to towers. Reducing range to 5 removes 40 of its 136 reachable
neighboring tiles on unobstructed ground (29.4%). Base archers still enter return
fire range; range research can now let them attack from outside Castle reach.
Knights should be able to pressure ranged units into moving and catch workers.
Their mobility research remains a real improvement instead of becoming redundant.

**Evidence.** The last two full games, `1abcc26e` and `314a03de`, produced 238
archers and 5 knights. In the latter, Opus's two knights dealt no damage under
its defensive scripts/orders; Astra's two arrived separately and died within
four seconds. This is a combination of agent choices and unit behavior, not proof
that stats alone caused the composition.

Fixed-policy probes separate Castle range from Knight speed, using both seats.
Against a archer retreating inside three tiles, a baseline Knight received 16
shots and landed none in 20 seconds. At 400 ms it still did not hit the archer,
but forced continuous retreat and received only one shot. Against a fleeing
worker, its first hit changed from none in 12 seconds to 9.1 seconds. These
probes assess contact, suppression and defense; they do not optimize damage
parity or establish full-game balance.

The earlier `pressure` experiment also tried 400 ms movement alongside other
changes and was not retained as convincing full-game evidence. This candidate
still needs fresh, unprompted LLM games before claiming more diverse armies.
In particular, cheaper long-range siege via archer research is a risk to watch.
Reproduce the isolated checks with
`pnpm exec tsx reports/landing-balance-v25-20261010/probes.mts`.

## v24-no-draws: outcome rule, 2026-10-09

A match ending without a winning side is a loss for every player, including
surviving players at the time limit and simultaneous elimination of every side.
The same policy applies when opposing sides tie on wins in a three-game series.
Scores remain informational. Unit stats, economy and match durations are unchanged.
The hypothesis is that removing the draw outcome makes waiting out the clock
less attractive. Its effect on LLM behavior still needs full-game evaluation.
Replays without `drawsAreLosses` keep their recorded draw semantics.

**Validation.** Deterministic tests cover 1v1, FFA, teams, unequal scores,
last-tick victory, mutual elimination, series losses and historical rules.
A short HTTP FFA ended with four living Kings and four losses. The original
Opus replay `0fccbf5b` still matches all 91 recorded hashes and its v23 draw.
These initial checks validate result handling, not a change in agent strategy.
Evidence is in
`reports/no-draws-20261009/`.

**First Opus rematch.** Four fresh `claude-opus-5-5` sessions through Claude Code
2.1.294, effort `low`, played `04331fac` on `quad-contested`, seed 419, fixed
positions and the same player prompt as `0fccbf5b`. P2 won by King elimination
at 598.3 seconds. Compared with the original 900-second draw, military combat
deaths rose from 3 to 108 (excluding removal after King elimination), first
military damage moved from 232.5 to 57 seconds, and chat rose from 0 to 3 private
messages. Players built 3 expansion Castles and no towers, versus 8 and 27 in
the original. P2 added knights during the final King chase; one landed three
hits while its archers continued firing.

All 61 recorded hashes and the final outcome match. All four sessions ended
normally, with no subagents, script errors or sandbox operational failures.
This is one historical/new-game comparison: decisions and inference latency
remain uncontrolled, so it supports the hypothesis without establishing a
repeatable causal effect. Evidence, frozen source and the comparison are in
`reports/ffa-no-draws-opus-20261009/`.

## v22-expansion: full-game Sol Low experiment, 2026-10-08

The change makes an additional production/dropoff center a practical investment
and moves existing mineral toward exposed mines. Runtime edits are limited to
numeric rules and deposit amounts. The engine, unit capabilities, combat stats,
map geometry, total resources, victory conditions and production player prompt are unchanged.

| Value | Before | v22 |
|---|---:|---:|
| Castle cost | 600 | 300 |
| Castle construction | 30 s | 20 s |
| Tower cost | 200 | 150 |
| Wall cost | 50 | 25 |
| Door cost | 75 | 40 |
| Home mineral per seat | 2,000 | 1,200 |
| Existing flank mineral per seat | 2,000 | 2,800 |
| Flank mineral on `quad`, including its extra mines | 3,200 | 4,000 |

A Castle now competes with three military units instead of six. Its economic
benefit still depends on workers, travel distance and surviving enemy attacks.
Moving 800 mineral per seat from home to the existing flanks gives expansion a
territorial purpose without adding money, new mines or new mechanics.

**Method.** Nineteen complete matches used actual `gpt-6.1-sol` players through
Codex 0.159.0, reasoning `low`, fresh isolated contexts and only game tools. Fifteen
were natural play; four separately marked stress games requested defensive or
walling openings against early knight pressure. Those instructions were paired
across control and candidate and left positions, spending and adaptation to the
LLMs. A completed Luna Low pilot is recorded separately; interrupted pilots are
excluded. Real time continued during inference, with the normal 10 Hz clock,
60-second preparation and 10/15-minute limits.

In the three natural control games, none of eight players built an expansion.
The 450-cost Castle candidate also produced none in two games. At 300/20 s,
all four players expanded in the next two games. These are small exploratory
samples of stochastic agents, not estimates of competitive win rates.

The selected values were frozen before three fresh validation games, with no
further retuning from their results:

| Replay | Result | Observation |
|---|---|---|
| [open, seed 73](http://localhost:5173/replay/2a3386d9) | Draw, 10:00 | Both expanded; both lost armies and workers; p1 rebuilt its economy and army. p2 survived with only its King. |
| [ridge, seed 89](http://localhost:5173/replay/65e1b1ec) | p2 wins, 5:10 | Both expanded; p1's forward Castle was destroyed after receiving 1,600 mineral. |
| [fortress-quad, seed 97](http://localhost:5173/replay/02101538?t=145) | p3/p4 win, 5:54 | Two productive expansions, attacks on opposite fronts, King evacuations and 12 team messages without a special chat directive. |

Six of eight validation players expanded. All six new Castles received resource
deliveries and accepted training orders; together they received 10,230 mineral,
and three were destroyed. Delivered mineral is **not** incremental profit or a
measured payback relative to a no-expansion counterfactual. Chat in one game
demonstrates the resulting play, not that these numeric changes caused chat use.

**Limits and rejected changes.** Natural play still produced no new walls in
these validation games. In the explicit walling test, v22 built three walls and
a door by 17.4 s, but the position took no damage and failed to protect the economy;
the player lost at 1:58. The control also lost, at 6:28. Cheaper construction does
not establish that wall placement or defensive play is solved. Cheap Castles
displacing towers remains a balance risk to monitor. The surviving-King draw
also remains an observed limitation.

Knight movement and aim stay at their original values. A 700 ms aim experiment
made a researched Knight unable to hit a fleeing, slower Worker for 30 seconds;
the original 100 ms killed it in five seconds. It was rejected before LLM games.
The diagonal first-hit mismatch is real: the engine changes tile before the
renderer finishes interpolating the step. This numeric pass does not alter that
mechanic. A separate faster-Knight candidate did not provide convincing full-game
evidence for inclusion.

**Verification and artifacts.** All 19 Sol replays reproduce their recorded
hashes. `pnpm test`: 71 files and 440 tests pass. The root typecheck retains the
same 96 pre-existing video JSX/module diagnostics, with no new diagnostics.
Construction/charge tests retain their behavioral checks; fixed-outcome Castellan
tests now explicitly fix the original economy. Castellan lost its old rush
canary with v22; its strategy was not optimized to regain that result. The tower
scenario now probes after construction and a delivery, before an early victory
can invalidate its fixture, and holds competing attackers for the firing check.

Detailed [game results](reports/balance-luna-20261008/games-summary.json),
[frozen selection](reports/balance-luna-20261008/selection.json),
[numeric diff](reports/balance-luna-20261008/numeric-diff.json) and
[scope/test notes](reports/balance-luna-20261008/scope.json) accompany per-game
logs, full rules, configuration manifests and replay analyses in
`reports/balance-luna-20261008/`. The directory retains the originally requested
model's name; Sol and Luna results are never pooled.

## Archived base economy and combat

At the default 10 ticks/second, timings round to the nearest 100 ms (minimum one
tick). The API guide and effective entity stats show these actual timings.

| Entity | Cost | HP | Armor | Damage | Range | Attack interval | Movement per tile |
|---|---:|---:|---:|---:|---:|---:|---:|
| Worker | 50 | 40 | 1 | 3 | 1 | 1 s | 0.5 s |
| Knight | 100 | 80 | 4 | 12 | 1 | 1 s | 0.4 s |
| Archer | 120 | 50 | 2 | 12 | 4 | 1 s | 0.4 s |
| Tower | 200 | 150 | 5 | 15 | 5 | 1 s | immobile |
| Wall | 50 | 300 | 10 | — | — | — | immobile |
| Door | 75 | 300 | 10 | — | — | — | immobile |
| King (not producible) | — | 400 | 10 | 3 | 1 | 3 s | 0.5 s |
| Castle | 600 | 600 | 5 | 6 | 4 | 1 s | immobile |

Damage is `max(1, attacker damage - target armor)` per hit. Distances use
Chebyshev distance (diagonals count as one). Damage in a tick is simultaneous.
Archer movement is configured as 380 ms but rounds to 400 ms at 10 Hz.

Workers and the King are scriptable. Workers default to mining, with no automatic
combat reaction. The King only retaliates against a recent attacker already in
melee range; he does not chase. Scripts can override these choices using
`lastAttacker()`, `lastAttackedTick`, `attack()`, `flee()` and `hold()`.
Workers additionally have `gather(deposit?)`, `unload()`, `deposits()`,
`nearestDeposit()`, `carrying` and `carryCapacity`. Explicit orders override
scripts until completion or `stop`.

- Start: 200 mineral, one Castle, one King, three workers; 30-unit cap including
  workers and King. Buildings do not count toward the cap.
- Training: Worker 5 s, Knight 8 s, Archer 10 s. Each Castle has a serial queue
  of up to five paid units; different Castle queues run in parallel. Mineral is
  charged on acceptance, and every queued unit reserves one population slot.
  A completed unit waits if every exit is blocked; the next timer starts when
  it actually spawns. There is no cancellation/refund. Losing the Castle destroys
  its queue and releases the population reservations.
- Doors and walls occupy one tile. Doors allow allied units through automatically,
  one unit at a time; enemies must destroy them. Doors block hostile projectiles
  even while an allied unit occupies the passage. There is no manual toggle.
- Construction: towers, walls and doors are immediate when the worker reaches a free
  adjacent tile. A Castle needs 30 seconds of uninterrupted adjacent work, plus
  travel. Mineral is charged on completion, not reserved. Stopping/changing the
  order, losing the worker or losing available funds interrupts construction;
  repeat orders for the same building/site preserve the timer. Once work starts,
  the destination is reserved; passing units route around it.
  No structure exists before completion. The worker is exposed and cannot gather
  or fight while building. Workers hold only one order, not a construction queue.
- Gathering: one mineral every 200 ms while mining, carrying up to 10 before
  returning adjacent to the Castle. Income depends on travel and congestion;
  5 mineral/s is a mining-only ceiling, not actual delivered income.
  In a v0 (open vision) 60-second no-orders run on the open map, the three initial workers
  delivered 330 mineral (200 initial mineral became 530).
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
  A tower's range 5 exceeds the Castle's range 4.
- Informational score (never decides a v4+ winner): units × 10 + buildings × 25 + mineral + unit kills × 15 +
  building kills × 30. Research investment earns no extra score. At the 10-minute limit,
  surviving opposing sides draw regardless of their scores. King elimination
  on the final tick takes priority over the timeout.

## Upgrade experiment

Upgrades are per player and kind. Existing and future units benefit. Levels
are sequential, one research at a time per player, without blocking training or
other orders. Mineral is charged on acceptance; there is no cancel/refund.
Elimination stops research. Everything resets between games.

| IDs | Base → L1 → L2 | L1 cost / time | L2 cost / time |
|---|---|---|---|
| `knight_damage`, `archer_damage` | 12 → 14 → 16 damage | 150 / 10 s | 250 / 15 s |
| `worker_damage` | 3 → 5 → 7 damage | 150 / 10 s | 250 / 15 s |
| `knight_cadence`, `archer_cadence` | 1000 → 900 → 800 ms per attack | 150 / 10 s | 250 / 15 s |
| `knight_mobility`, `archer_mobility` | 400 → 300 ms per tile (effective at 10 Hz) | 250 / 15 s | no L2 |

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
research, and effective unit stats. Purchase results expose mineral spent and
remaining. `wait` can filter `upgrade_completed`. Scripts see effective `atk`,
`attackMs` and `moveMs`; already running cooldowns are not reset by completion.
Research and upgrades are public in both player views and watch/replay.

## What needs measurement

- Same-budget Knight/Archer fights with and without kiting, across army sizes.
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

The worker can build a Castle for 600 mineral and 30 seconds of construction
plus travel. This is six Knights, twelve Workers or three Towers worth of
mineral, with an exposed worker occupied for the construction interval. The
price is experimental, not a claim of proven balance. The original Castle is
still included in the starting setup without charging its build price.

Every completed Castle has the same 600 HP / 5 armor / 6 attack / 4 range, accepts
resource deliveries and trains workers (50), knights (100) and archers (120).
Workers automatically deliver to the nearest owned dropoff. All Castle buildings
share the player's Castle script; production queues run independently and population remains
30 across the whole player, not per Castle. `myBase()` / `enemyBase()` point to the
first surviving Castle, falling back to the King if no Castle remains. Enemy
base helpers only consider currently visible entities and otherwise return null.

There is no new passive income or resource creation. The economic benefit is
shorter trips to existing deposits; the military benefit is a new production
location. Expansion value and payback depend on position and worker count.

A deterministic economy-only probe (open map, seed 42, nine workers, 1,200
starting mineral to fund both setups, no attacks or later orders) compared one
expansion against the same workers without expansion. At sites (8,7), (8,10)
and (11,6), the expansion first caught up in total mineral at 120, 340 and 130
seconds respectively, sampled every 10 seconds from game start. These are first
crossings, not guaranteed sustained leads: routes and deposit depletion change
over time. This does not establish competitive balance at the normal 200-mineral
start or under attack.

The sole elimination condition is King death; the 10-minute limit ends in a draw if opposing Kings survive. A player can rebuild after losing all Castle buildings if they have a
worker and enough saved mineral. Without a Castle, workers have no resource
return point. Construction is visible on the builder in state, watch and replay.

### Audit of the last Opus/Astra pair (v1, before expansion)

| Game | Opus workers trained | Astra workers trained | Upgrades |
|---|---:|---:|---|
| b4de492a | 11 | 6 | none |
| ce02ddca | 11 | 8 | Astra archer_damage L1, 169.5–179.5 s |

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
