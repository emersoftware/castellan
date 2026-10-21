# Balance experiments

[CURRENT-RULES.md](docs/CURRENT-RULES.md) holds the current numbers. It is generated from
`packages/shared/src/rules.ts`.
`GET /guide` returns the exact guide for a room. After you edit the rules, run `pnpm docs:rules`.
`pnpm docs:check` checks that the snapshot is current.
Everything from **Archived base economy and combat** onward is history, not current rules.

This is a playable experiment, not validated competitive balance. The first
arena should keep separate ratings for each ruleset, harness configuration and
memory policy. 2 games with swapped sides are useful observations, not a reliable model ranking.

## v25-castle-knight: local defense and melee mobility, 2026-10-10

| Value | v24 | v25 |
|---|---:|---:|
| Castle range | 6 | 5 |
| Knight movement per straight tile | 500 ms | 400 ms |
| Knight movement with mobility research | 400 ms | 300 ms |

Costs, damage, armor, health, training, maps and agent instructions are unchanged.
Only numeric rules change, not mechanics. Historical
replays keep their embedded rules.

**Hypothesis.** A Castle should defend its nearby economy; towers handle longer range. Range 5 removes 40 of the 136 neighboring tiles a Castle reaches on open
ground (29.4%). Base archers still enter return fire range. Range
research now lets them attack from outside Castle reach.
Knights should push ranged units to move and should catch workers.
Their mobility research stays a real improvement.

**Evidence.** The last 2 full games, `1abcc26e` and `314a03de`, produced 238
archers and 5 knights. In `314a03de`, Opus's 2 knights dealt no damage under
its defensive scripts/orders. Astra's 2 knights arrived separately and died within
4 seconds. Agent choices and unit behavior both explain this, not stats alone.

Fixed-policy probes test Castle range and Knight speed separately, from both seats.
Against an archer retreating inside 3 tiles, a baseline Knight took 16
shots and landed none in 20 seconds. At 400 ms it still did not hit the archer.
It forced the archer to keep retreating and took only 1 shot. Against a fleeing
worker, the first hit moved from none in 12 seconds to 9.1 seconds. These
probes measure contact, suppression and defense, not damage
parity or full-game balance.

The earlier `pressure` experiment also tried 400 ms movement, together with other
changes. It gave no convincing full-game evidence. This candidate
still needs fresh, unprompted LLM games before claiming more varied armies.
Watch for cheaper long-range siege via archer research.
To reproduce the isolated checks, run
`pnpm exec tsx reports/landing-balance-v25-20261010/probes.mts`.

## v24-no-draws: outcome rule, 2026-10-09

A match that ends without a winning side is a loss for every player. This includes
survivors at the time limit and simultaneous elimination of every side.
The same rule applies when opposing sides tie on wins in a 3-game series.
Scores stay informational. Unit stats, economy and match durations are unchanged.
Hypothesis: without draws, waiting out the clock is less attractive.
Its effect on LLM behavior still needs full-game tests.
Replays without `drawsAreLosses` keep the draw rules they recorded.

**Validation.** Deterministic tests cover 1v1, FFA, teams, unequal scores,
last-tick victory, mutual elimination, series losses and historical rules.
A short HTTP FFA ended with 4 living Kings and 4 losses. The original
Opus replay `0fccbf5b` still matches all 91 recorded hashes and its v23 draw.
These checks validate result handling, not a change in agent strategy.
Evidence is in
`reports/no-draws-20261009/`.

**First Opus rematch.** 4 fresh `claude-opus-5-5` sessions through Claude Code
2.1.294, effort `low`, played `04331fac`. Setup: `quad-contested`, seed 419, fixed
positions and the same player prompt as `0fccbf5b`. P2 won by King elimination
at 598.3 seconds. Against the original 900-second draw:

- Military combat deaths rose from 3 to 108 (not counting removal after King elimination).
- First military damage moved from 232.5 to 57 seconds.
- Chat rose from 0 to 3 private messages.
- Players built 3 expansion Castles and no towers, against 8 and 27 in the original.

P2 added knights during the final King chase. One knight landed 3
hits while its archers kept firing.

All 61 recorded hashes and the final outcome match. All 4 sessions ended
normally: no subagents, script errors or sandbox operational failures.
This is 1 historical/new-game comparison with uncontrolled decisions and inference latency.
It supports the hypothesis without proving a
repeatable causal effect. Evidence, frozen source and the comparison are in
`reports/ffa-no-draws-opus-20261009/`.

## v22-expansion: full-game Sol Low experiment, 2026-10-08

This change makes an extra production and dropoff center a practical investment
and moves existing mineral toward exposed mines. Runtime edits only touch
numeric rules and deposit amounts. Unchanged: the engine, unit capabilities, combat stats,
map geometry, total resources, victory conditions and production player prompt.

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

A Castle now costs 3 military units instead of 6. Its economic
benefit still depends on workers, travel distance and surviving enemy attacks.
Moving 800 mineral per seat from home to the existing flanks gives expansion a
territorial purpose without new money, mines or mechanics.

**Method.** 19 complete matches used real `gpt-6.1-sol` players through
Codex 0.159.0, reasoning `low`, fresh isolated contexts and only game tools.

- 15 games were natural play.
- 4 stress games, marked separately, asked for defensive or walling openings against early knight pressure.
  Control and candidate got the same instructions; the LLMs chose positions, spending and adaptation.
- A completed Luna Low pilot is recorded separately. Interrupted pilots are excluded.
- Real time kept running during inference, with the normal 10 Hz clock,
  60-second preparation and 10/15-minute limits.

In the 3 natural control games, none of 8 players built an expansion.
The 450-cost Castle candidate also produced none in 2 games. At 300/20 s,
all 4 players expanded in the next 2 games. These are small exploratory
samples of stochastic agents, not win-rate estimates.

The chosen values were frozen before 3 fresh validation games, with no retuning after:

| Replay | Result | Observation |
|---|---|---|
| [open, seed 73](http://localhost:5173/replay/2a3386d9) | Draw, 10:00 | Both expanded; both lost armies and workers; p1 rebuilt its economy and army. p2 survived with only its King. |
| [ridge, seed 89](http://localhost:5173/replay/65e1b1ec) | p2 wins, 5:10 | Both expanded; p1's forward Castle was destroyed after receiving 1,600 mineral. |
| [fortress-quad, seed 97](http://localhost:5173/replay/02101538?t=145) | p3/p4 win, 5:54 | Two productive expansions, attacks on opposite fronts, King evacuations and 12 team messages without a special chat directive. |

6 of 8 validation players expanded. All 6 new Castles received resource
deliveries and accepted training orders. Together they received 10,230 mineral,
and 3 were destroyed. Delivered mineral is **not** extra profit or a
measured payback against a game without expansion. Chat in one game
shows the resulting play, not that these numeric changes caused chat use.

**Limits and rejected changes.** Natural play still built no new walls in
these validation games. In the explicit walling test, v22 built 3 walls and
a door by 17.4 s. The position took no damage and did not protect the economy.
The player lost at 1:58; the control also lost, at 6:28. Cheaper construction does
not prove that wall placement or defensive play is solved. Cheap Castles replacing towers
is a risk to watch. The surviving-King draw
is still an observed limitation.

Knight movement and aim stay original. A 700 ms aim experiment
left a researched Knight unable to hit a fleeing, slower Worker for 30 seconds.
The original 100 ms killed it in 5 seconds. It was rejected before LLM games.
The diagonal first-hit mismatch is real: the engine changes tile before the
renderer finishes animating the step. This pass leaves that mechanic as is. A separate faster-Knight candidate gave no convincing full-game
evidence for inclusion.

**Verification and artifacts.** All 19 Sol replays reproduce their recorded
hashes. `pnpm test`: 71 files and 440 tests pass. The root typecheck keeps the
same 96 existing video JSX/module diagnostics and adds none.
Construction/charge tests keep their behavior checks. Fixed-outcome Castellan tests
now set the original economy explicitly. With v22, Castellan lost its old rush
canary; its strategy was not tuned to regain it. The tower
scenario now probes after construction and a delivery, before an early victory
can break its fixture. It holds competing attackers back for the firing check.

`reports/balance-luna-20261008/` holds
[game results](reports/balance-luna-20261008/games-summary.json),
[frozen selection](reports/balance-luna-20261008/selection.json),
[numeric diff](reports/balance-luna-20261008/numeric-diff.json) and
[scope/test notes](reports/balance-luna-20261008/scope.json). Also per-game
logs, full rules, configuration manifests and replay analyses. The directory keeps the originally requested
model's name. Sol and Luna results are never pooled.

## Archived base economy and combat

At the default 10 ticks/second, timings round to the nearest 100 ms (minimum 1
tick). The API guide and effective entity stats show the real timings.

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

Each hit deals `max(1, attacker damage - target armor)`. Distances use
Chebyshev distance (a diagonal step counts as 1). All damage in a tick happens at once.
Archer movement is set to 380 ms but rounds to 400 ms at 10 Hz.

Workers and the King are scriptable. Workers mine by default, with no automatic
combat reaction. The King only strikes back at a recent attacker already in
melee range, without chasing. Scripts can change these choices with
`lastAttacker()`, `lastAttackedTick`, `attack()`, `flee()` and `hold()`.
Workers also have `gather(deposit?)`, `unload()`, `deposits()`,
`nearestDeposit()`, `carrying` and `carryCapacity`. Explicit orders override
scripts until completion or `stop`.

- Start: 200 mineral, 1 Castle, 1 King, 3 workers. The cap is 30 units, counting
  workers and King. Buildings do not count toward the cap.
- Training: Worker 5 s, Knight 8 s, Archer 10 s.
  - Each Castle has a serial queue of up to 5 paid units. Queues of different Castles run in parallel.
  - Mineral is charged on acceptance. Every queued unit reserves 1 population slot.
  - A finished unit waits if every exit is blocked. The next timer starts when
    it actually spawns.
  - There is no cancel or refund. Losing the Castle destroys
    its queue and frees the population reservations.
- Doors and walls take 1 tile. Doors let allied units through automatically,
  1 unit at a time; enemies must destroy them. Doors block hostile projectiles
  even while an allied unit stands in the passage. There is no manual toggle.
- Construction:
  - Towers, walls and doors appear at once when the worker reaches a free
    adjacent tile.
  - A Castle needs 30 seconds of uninterrupted adjacent work, plus travel.
  - Mineral is charged on completion, not reserved.
  - Stopping or changing the order, losing the worker or running out of funds stops construction.
    Repeating the order for the same site keeps the timer.
  - Started sites are reserved; passing units walk around them.
  - No structure exists before completion. The worker is exposed and cannot gather
    or fight while it builds. Workers hold 1 order only, not a construction queue.
- Gathering: a worker mines 1 mineral every 200 ms, carries up to 10, then
  returns next to the Castle. Income depends on travel and congestion.
  5 mineral/s is a mining-only ceiling, not delivered income.
  In a v0 (open vision) 60-second run on the open map with no orders, the 3 starting workers
  delivered 330 mineral (200 starting mineral became 530).
- Preparation: 60 s. Maximum match: 10 min.
  - **Only the King is vital.** Losing
    any Castle does not eliminate the player.
  - Player state uses shared team vision; only observers see everything.
  - Explored terrain stays remembered. Enemies disappear when sight is lost; no ghost
    entities remain.
  - Enemy economic stats, research and production queues
    are hidden.
  - Events follow the visibility at the time they happened, including series
    history. Player identity, team, alive status and chat do not depend on vision.
- Melee damage is immediate. Ranged shots fly at 12 Euclidean tiles/s toward
  the spot where the target was at launch. They do not home in.
  Damage happens at the first hostile collision; leaving the path dodges it.
  Shots expire at their fixed destination, survive the shooter's death and cannot damage allies.
- Collision uses swept segments: unit radius 0.35 tile, building/rock radius 0.5.
  Hostile buildings and rock terrain stop shots. Allies and deposits do not.
  Attack is read at launch, armor at impact. Scripts decide before movement,
  then existing shots move. New shots move from the next tick.
- State and `self.projectiles()` show the shots currently in team vision:
  position, velocity in tiles/s and fixed destination. Old replay rules keep
  instant hits. v6 needs its own balance observations.
- `buildExclusion` is currently **0**, so building near the enemy is allowed.
  A tower's range 5 is longer than the Castle's range 4.
- Informational score (it never decides a v4+ winner): units × 10 + buildings × 25 + mineral + unit kills × 15 +
  building kills × 30. Research spending earns no extra score. At the 10-minute limit,
  surviving opposing sides draw whatever their scores. A King elimination
  on the final tick wins over the timeout.

## Upgrade experiment

Upgrades apply per player and unit kind, to existing and future units.
Levels go in order, 1 research at a time per player, without blocking training or
other orders. Mineral is charged on acceptance; there is no cancel or refund.
Elimination stops research. Everything resets between games.

| IDs | Base → L1 → L2 | L1 cost / time | L2 cost / time |
|---|---|---|---|
| `knight_damage`, `archer_damage` | 12 → 14 → 16 damage | 150 / 10 s | 250 / 15 s |
| `worker_damage` | 3 → 5 → 7 damage | 150 / 10 s | 250 / 15 s |
| `knight_cadence`, `archer_cadence` | 1000 → 900 → 800 ms per attack | 150 / 10 s | 250 / 15 s |
| `knight_mobility`, `archer_mobility` | 400 → 300 ms per tile (effective at 10 Hz) | 250 / 15 s | no L2 |

These are candidate values, not simulation-derived optima. The first
movement upgrade that fits the tick size raises speed by 33%. It has only
1 level on purpose and costs more than 2 Knights. There are no range, armor, HP, worker speed or
economy upgrades. Worker melee is manual: an attack order replaces
gathering, and workers stay non-scriptable.

```
POST /act
{"orders":[{"type":"upgrade","upgrade":"worker_damage"}]}
```

The same order works through CLI `act` and MCP `act`. `guide` lists IDs, levels,
costs and times. `state` and action responses show finished levels, current
research and effective unit stats. Purchase results show mineral spent and
left. `wait` can filter `upgrade_completed`. Scripts see effective `atk`,
`attackMs` and `moveMs`. Completion does not reset running cooldowns.
Research and upgrades are public in player views and watch/replay.

## What needs measurement

- Knight/Archer fights with the same budget, with and without kiting, at several army sizes.
- Rush, economy and defense openings. Production queues and instant tower
  construction probably matter more than small price changes.
- Upgrade against extra units at equal spend. Include worker rushes and whether
  an upgrade pays back before a vital entity dies.
- Latency sensitivity and recovery failures, reported apart from strategy.
- For the independent ladder: sides paired with the same seed, fresh processes, fixed model/effort/harness,
  identical information and no history from earlier games.
- Full-tool parity: Claude and DeepSeek filter down to game tools. Codex's read-only
  sandbox is not the same as removing local-read tools. Until standardized, results
  evaluate the configured agents, not model capability alone.

Replay verification and server checkpoints include research and construction timers.

## Baseline spot check, 2026-09-28

6 games per matchup on the default open map. Sides alternate, seeds are 1000–1005,
both bots decide every 3 s, rules are unmodified v0 and there is no research:

| Bots | Wins | Average length |
|---|---|---|
| rush vs eco | 1–5 | 2.7 min |
| kite vs eco | 2–4 | 4.8 min |
| kite vs turtle | 6–0 | 5.6 min |

None of these 18 games timed out. This is a small diagnostic sample of specific
bot implementations, not proof that all strategies or upgrade prices
are balanced. Command: `pnpm sim --a rush --b eco --n 6` (same form for the other bot
pairs above). The simulation CLI still defaults to v0; upgrades need v1 explicitly.


## Castle expansion experiment

`act({orders:[{type:"build",unit:"<worker id>",kind:"castle",x:8,y:7}]})`

A worker builds a Castle for 600 mineral and 30 seconds of work plus travel. That equals 6 Knights, 12 Workers or 3 Towers, and the worker
is exposed and busy while building. The
price is experimental, not proven balance. The original Castle stays free in the starting setup.

Every finished Castle has the same 600 HP / 5 armor / 6 attack / 4 range. It accepts
resource deliveries and trains workers (50), knights (100) and archers (120).
Workers deliver to the nearest owned dropoff.

- All Castle buildings share the player's Castle script.
- Production queues run independently. The population cap stays at
  30 for the whole player, not per Castle.
- `myBase()` / `enemyBase()` point to the
  first surviving Castle. If no Castle remains, they point to the King.
- Enemy base helpers only see currently visible entities, else they return null.

There is no new passive income or resource. The economic benefit is
shorter trips to existing deposits. The military benefit is a new production
site. Expansion value and payback depend on position and worker count.

A deterministic economy-only probe compared 1 expansion against the same workers without one.
Setup: open map, seed 42, 9 workers, 1,200
starting mineral to fund both setups, no attacks and no later orders. Total mineral was sampled every 10 seconds from game start.
At sites (8,7), (8,10)
and (11,6), the expansion first caught up at 120, 340 and 130
seconds. These are first
crossings, not guaranteed lasting leads: routes and deposit depletion change
over time. This says nothing about balance at the normal 200-mineral
start or under attack.

The only elimination condition is King death. At the 10-minute limit the game is a draw if opposing Kings survive. A player who loses all Castle buildings can rebuild with a
worker and enough saved mineral. Without a Castle, workers cannot return resources. State, watch and replay show construction on the builder.

### Audit of the last Opus/Astra pair (v1, before expansion)

| Game | Opus workers trained | Astra workers trained | Upgrades |
|---|---:|---:|---|
| b4de492a | 11 | 6 | none |
| ce02ddca | 11 | 8 | Astra archer_damage L1, 169.5–179.5 s |

The table counts successful extra worker training orders, not the 3 starting
workers or survivors at the end. No worker training failed.
Astra won both games. The replay audit re-applied every recorded order and checked
its result. It did not guess purchases from the final army.

## Production and fog experiment

The 5/8/10-second training times are starting values, not proven balance. Paid
units in queues do not score as living units before they spawn. New expansions
also add parallel production, which the economy-only
Castle probe above does not measure.

Vision uses each kind's existing `vision` radius and Chebyshev distance.

- Friendly entities share vision across a team.
- Walls and rocks do not block sight.
  v6 projectiles collide with hostile buildings and rock terrain.
- Static map layouts stay public through rules. Live enemy information
  is filtered in state, events, act responses, script helpers and series history.
- Workers gather from discovered deposits automatically.
- An attack order on an unseen target fails. A running chase ends when the target disappears.
- Build sites must be visible when ordered.

The spectator UI has player-name buttons and **View all**, in both watch and
replay. The engine builds the selected player's view: black unexplored
terrain, dark remembered terrain, visible entities and that player's event feed.
Older replays keep their original open-map rules and knowledge policy. This is
a game API information boundary. The public observer endpoint still
sees everything, so harnesses must stay limited to authorized player tools.

Observer chat follows the selected player: public messages, that player's team
messages, and private messages they sent or received. Other players' private
conversations are hidden. The live overview shows public chat. Finished
replays may show all conversations in the observer overview. Player API
permissions are unchanged. After a server restart removes a finished room from memory,
watch URLs fall back to its saved replay.
