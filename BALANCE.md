# Experimental balance: v1-upgrades

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
| Agent (not producible) | — | 400 | 10 | — | — | — | 0.5 s |
| Nexus (not producible) | — | 600 | 5 | 6 | 4 | 1 s | immobile |

Damage is `max(1, attacker damage - target armor)` per hit. Distances use
Chebyshev distance (diagonals count as one). Damage in a tick is simultaneous.
Ranger movement is configured as 380 ms but rounds to 400 ms at 10 Hz.

- Start: 200 capital, one Nexus, one Agent, three workers; 30-unit cap including
  workers and Agent. Buildings do not count toward the cap.
- Training: immediate on the processing tick, subject to capital, population
  and free neighboring spawn tiles. No production queue or training delay.
- Construction: immediate when the worker reaches a free adjacent tile. Travel
  is the only construction delay; capital is charged on completion. A worker
  holds only one order, so multiple build orders replace each other.
- Gathering: one capital every 200 ms while mining, carrying up to 10 before
  returning adjacent to the Nexus. Income depends on travel and congestion;
  5 capital/s is a mining-only ceiling, not actual delivered income.
  In a fresh 60-second no-orders run on the open map, the three initial workers
  delivered 330 capital (200 initial capital became 530).
- Preparation: 60 s. Maximum match: 10 min. Losing either vital entity loses the
  game. Both player state and spectator state see all entities; script perception
  is limited by each unit's vision.
- Attacks do not check line of sight. Walls obstruct movement, not shots.
- `buildExclusion` is currently **0**: offensive construction is allowed.
  A turret's range 5 exceeds the Nexus's range 4.
- Timeout score: units × 10 + buildings × 25 + capital + unit kills × 15 +
  building kills × 30. Research investment earns no extra timeout score.

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
- Rush, economy and defense openings; instant reinforcements and instant tower
  construction are likely larger influences than small price changes.
- Upgrade versus extra units at equal spend, including worker rushes and whether
  an upgrade pays back before a vital entity dies.
- Latency sensitivity and recovery failures, reported separately from strategy.
- Sides paired with the same seed, fresh processes, fixed model/effort/harness,
  identical information and no previous-game history for the independent ladder.
- Full-tool parity: Claude and DeepSeek filter to game tools; Codex's read-only
  sandbox is not the same as removing local-read tools. Until standardized, this
  evaluates the configured agents, not isolated model capability alone.

Legacy replays retain their embedded ruleset and their original hash algorithm.
The new ruleset adds research to replay verification and server checkpoints.

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
