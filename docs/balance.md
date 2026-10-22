# Balance

The numbers live in [`packages/shared/src/rules.ts`](../packages/shared/src/rules.ts). [CURRENT-RULES.md](CURRENT-RULES.md) is generated from it (`pnpm docs:rules`; `pnpm docs:check` verifies the snapshot), and `GET /guide` returns the exact guide of a room. Replays embed their own rules and map. Edit the ruleset, never a connector or the renderer.

Evidence paths such as `reports/<dir>` are relative to the local data directory, `~/.local/share/castellan/` (`CASTELLAN_DATA` overrides it; `replays/`, `runs/` and `videos/` live there too). Runner scripts inside those report directories imported the repository by relative path and no longer run from there; treat them as records.

Castellan is a playable experiment, not validated competitive balance. Keep separate ratings per ruleset, harness configuration and memory policy. Two games with swapped sides are observations, not a model ranking. Separate model decisions from harness and server failures, and never claim causality from one match.

## Current rules (0.29.3, 2026-10-22)

| Entity | Cost | HP | Def | Atk | Range | Vision | Move/tile | Aim after moving | Train/build |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| Worker | 50 | 40 | 1 | 3 | 1 | 3 | 500 ms | — | 5 s |
| Knight | 100 | 100 | 6 | 16 | 1 | 6 | 400 ms | 100 ms | 8 s |
| Archer | 100 | 60 | 3 | 12 | 5 | 7 | 400 ms | 400 ms | 8 s |
| Tower | 150 | 240 | 7 | 12 | 2–7 | 8 | static | — | 10 s |
| Castle | 300 | 600 | 7 | 12 | 5 | 7 | static | — | 20 s |
| Wall / Door | 25 / 40 | 300 | 10 | — | — | 1 | static | — | 3 s |
| King | — | 400 | 10 | 3 every 3 s | 1 | 6 | 500 ms | — | not producible, vital |

Attacks every 1,000 ms unless stated; damage per hit `max(1, atk − def)`. Projectiles fly at 16 tiles/s, don't home, hit the first hostile on their path and fly over walls and doors; a tower can't hit anything closer than 2. Range and vision are Euclidean discs rounded to whole tiles; a diagonal step takes 1.4× a straight one; the engine rounds every time to 100 ms ticks.

Research, one at a time, charged on acceptance: `knight_damage` 18/20 (250/10 s, 350/15 s), `knight_cadence` 900/800 ms (150/10 s, 250/15 s), `knight_mobility` 300 ms (150/15 s), `archer_damage` 14/16, `archer_cadence` 900/800 ms, `archer_mobility` 300 ms (same prices as the knight's), `worker_damage` 5/7 (150/10 s, 250/15 s), `archer_range` 6 with vision 8 (200/15 s), `tower_range` 8/9 with vision 9/10 (150/15 s, 250/20 s). No unit needs research to be produced.

Economy and match: 200 mineral, 1 Castle, 1 King and 3 workers to start; population 30 including workers and King. A worker mines 1 mineral per 200 ms and carries 10 to the nearest Castle. Each Castle queues up to 5 paid units; Castles train in parallel; no cancel or refund. Construction is charged on completion; `buildExclusion` is 0. Preparation 60 s; match 10 min, 15 with four players. Only the King is vital. A match without a winning side is a loss for every player; score is informational. The 32×32 maps hold 9,600 mineral: 1,200 at home per seat, 2,800 at two flank expansions, two shared deposits of 800 in the center. `fortress-quad` holds 21,600; `quad`, `quad-contested` and `quad-crossroads` 26,400.

## Design axis: LLM latency

One agent decision (think + tool call) takes about 3–15 s: roughly 40–200 decisions in a 10-minute match. The v0 sizing still frames every number:

| Magnitude | Value | Why |
|---|---|---|
| Tick | 100 ms | Resolution only; balance is in ms. |
| Match | 10 min | Enough decisions for strategy to show. |
| Map | 32×32 | A Knight crosses it in ~13 s at 400 ms/tile: at least one LLM turn to react. |
| Kill time | Knight vs Knight ~10 s | Longer than one turn; micro is the script's job. |
| Economy | 3 workers ≈ 1 Knight every ~20 s | First real attack around minute 1–2. |

Targets: no reference-bot strategy beats all others (every matchup 40–60%); median match 5–8 min with under 10% timeouts; a 3 s bot beats a 10 s bot about 65–75%, not always. Loop: simulations → edit the ruleset → simulations → real LLM matches → compare → new version. Every replay records its ruleset version.

## Reliable balance experiments

Run from the repository root. These use the local engine and the reference bots in `@castellan/bots` (`packages/bots`: `rush`, `eco`, `turtle`, `kite`, `archers`), never paid models. A bot sees a player view and answers with the same orders as an agent; its decision delay models an LLM. `packages/sim` keeps `simulate` and the tools below.

```sh
pnpm sim --a rush --b eco --n 20 --latency-a 3000 --latency-b 3000   # one pair; sides alternate, seeds 1000+i; --map <name>
pnpm sim --matrix                     # every bot against every bot at 3 s
pnpm sim --latency-curve --bot eco    # the same bot at 1, 5, 10 and 15 s against 3 s
pnpm exec vitest run packages/sim/test/sim.test.ts
pnpm exec tsx packages/sim/src/bot-smoke.mts 90        # seconds [bots] [maps], e.g. 180 rush,archers open,fortress
```

The smoke run plays each bot on `open` and `fortress`, in both seats, deciding every 3 s with seed 7, against an opponent that makes no decisions but keeps its default unit scripts. Each JSON line reports military produced, attacks and rejected orders with reasons. 0 rejections proves legal production, not strength; `pnpm sim` reports rejections too. Bot factories take the match ruleset, so they respect custom costs, prerequisites, queue limits and population caps.

October 7 check on `v21d-no-unlocks` with the redistributed deposits: all 20 cases of 90 s finished with 0 rejected orders and 0 script errors; military production was rush 6, eco 7, turtle 2, kite 5, archers 5 on either map and seat; rush attacked by 90 s (9 attacks on open, 34 on fortress). In 180 s, rush/eco/kite/archers fought on both maps; turtle built 3 towers and 6 knights without launching its 8-knight attack. Results matched across seats. These are production checks against an inactive controller, not win rates.

### Recorded battles and the optimizer

```sh
mkdir -p /tmp/castellan-balance-run
REPLAYS=~/.local/share/castellan/replays pnpm exec tsx packages/sim/src/extract-recent.mts > /tmp/castellan-balance-run/battles.json
BATTLES=/tmp/castellan-balance-run/battles.json OUT_DIR=/tmp/castellan-balance-run/results pnpm exec tsx packages/sim/src/balance-optimize.mts 25 1
```

Optimizer arguments: maximum generations and hours. `VARIANTS=1` evaluates only the recorded staging (the default adds open and jittered variants); `SYNTHETIC=0` leaves out designed scenarios; `FROM`, `STARTS`, `SCRIPTS` and `OBJECTIVE=rps` set the start, extra starts, player-written script pairs and the rock-paper-scissors objective. Use a new `OUT_DIR` per experiment. `BATTLES` needs at least 3 independent replay IDs with usable combat in the search partition. Companions: `battles-baseline.mts [battles.json]` (every recorded battle under current rules, as recorded and without walls), `synthetic-matrix.mts [values.json] [script pair]` (who beats whom for the same mineral), `script-sets.mts [count]` (player-written script sets that fight without errors), `choice-probe.mts label=rules.json … [--reps 4] [--models …]` (asks a model what it would train; isolated, tool-less Codex calls, paid), `tools/elo.mts [--rules <prefix>] [--since <date>]` (ELO over saved battles by harness + model + effort) and `packages/engine/scripts/verify-replays.ts` (re-simulates every saved replay and checks its hashes).

`castellan-battle-v2` stores the source rules, seed, tick rate, seats and teams, every order before the battle boundary and the hash at that boundary. Extraction checks every replay hash and skips incompatible replays; continuation re-runs the prefix and checks the boundary hash, keeping the real QuickJS runtime, unit memory, cooldowns, aiming timers, projectiles, economy, production, construction, vision and elapsed time. Replays whose experiment manifest records `operationalFailures` are excluded, even for fights before the failure: a wall-clock watchdog can stop a player's VM at a nondeterministic time, and offline replay cannot rebuild that outcome. Those matches are evidence about runtime reliability, not balance samples. Designed scenarios carry a `synthetic` mark; they are new games, not continuations. Exact prefix execution is slower than the old lossy reconstruction; the workflow pays that cost rather than claim reproducibility.

October 7 check: 7 fights from 3 archived games (`9d0b24bd` v19, `e659c8f6` v17, `eb16c5f4` v21d); all hashes matched, none skipped. Restoring `9d0b24bd#0` at tick 1630 reproduced `cd363e8b`, and the original orders through tick 1700 reproduced the archive's next checkpoint `2f4800f4`. A 60-tick autonomous continuation fought with 0 script errors and 0 rejected setup orders. This verifies those 3 archives, not the catalogue.

Candidate combat stats apply from the boundary; current health scales with maximum health; cooldowns, paid production, economic history and shots in flight stay as recorded. Open and jittered variants change geometry on purpose. These are counterfactual tactical continuations, not full matches under new costs. Script errors and rejected setup orders abort an evaluation instead of adding to a score.

### Search, selection and final test

All fights and variants of a replay stay in one deterministic partition: about 60% search, 20% validation, 20% final test, at least 1 replay each; `split.json` records membership. Search data drives candidate generation, start selection and racing; validation picks among improving candidates; the optimizer writes the chosen values to `validated.json`; only then does the final partition evaluate baseline and frozen candidate into `final-test.json`. No earlier step touches final-test games. Validation performance is a selection result; the final test is an independent estimate for that run. If its report guides more tuning, collect new games for the next final test. The parity/RPS objective and its economic assumptions are unchanged: a lower diagnostic score does not prove a more balanced or more interesting game. This workflow fixes the evidence; it publishes no rule change.

### What needs measurement

- Knight/Archer fights at the same budget, with and without kiting, at several army sizes; cross duels Opus vs Sol and Opus vs Astra, where unit preferences meet (pending since v20).
- Rush, economy and defense openings. Queues and construction times probably matter more than small price changes.
- Research against extra units at equal spend, including worker rushes and payback before a vital entity dies.
- Latency sensitivity and recovery failures, reported apart from strategy.
- Fresh, unprompted LLM games on the current numbers before claiming more varied armies; cheaper long-range siege through `archer_range`.
- A ladder with sides paired on the same seed, fresh processes, fixed model/effort/harness, identical information and no history. Until tool allowlists are standardized across harnesses, results evaluate configured agents, not model capability.

## Rule versions

Names are the `version` strings recorded in replays. v0 (2026-09-26): King (then Agent) 400 HP / 10 def, vital, no attack; Worker 40/1/3, 500 ms, 50; Knight 80/4/12, 400 ms, 100; Archer 50/2/12, range 4, 380 ms, 120; Castle (then Nexus) 600/5/6, range 4, vital; Tower 150/5/15, range 5, 200; Wall 300/10, 50. Instant production and construction, Chebyshev distance, instant hits, no fog, `buildExclusion` 8 after the first LLM match.

| Version | Date | Numbers | Mechanics |
|---|---|---|---|
| v1-upgrades | | damage 14/16, cadence 900/800 ms, mobility 300 ms for knight and archer; worker damage 5/7 | timed research, one at a time |
| v2-expansion | | Castle not vital; costs 600, 30 s | workers build Castles |
| v3-fog-production | | training 5 / 8 / 10 s | fog of war with memory; queue of 5 |
| v4-agent-victory | | | only the King's death wins; draw at the limit |
| v5 / v6 projectiles | | 6, then 12 tiles/s | real projectiles |
| v7-castle-doors | | door 300 HP / 10 def, 75 | Nexus → Castle; allied-only doors |
| v8-king, v9-worker-scripts | | King atk 3 every 3 s | Agent → King; worker and King scripts, reactive scripts |
| v10-ruins | | | ruins of eliminated players |
| v11-range | 2026-09-30 | range research: archer 5/6, tower 6/7 | |
| v12-ffa-score | 2026-09-30 | archer 120 → 100; mobility 150 | free-for-all; score wins at the limit |
| v13-long-quad | | archer 110; mobility 200 | no score; 4 players, 15 min on 44×44 |
| v14-aim, v15-doors | | tower range 6, vision 7; archer aims 300 ms | arrows over walls and doors; straight doors |
| v16-pause | 2026-10-03 | knight 100 HP / 6 def, aim 300; castle range 6; tower 10 s, wall and door 3 s | one ruleset; diagonal ×1.4; circular range and vision |
| v17-optimized | 2026-10-03 | knight 130/8/11; archer 60/1, range 5, 360 ms; tower 210, 110/8/8, range 7; castle 4 def, 7 atk | tower blind spot (< 2) |
| v18-equal-cost | 2026-10-04 | knight and archer 100; knight 500 ms, 14/6, aim 100; archer 3 def, 400 ms; tower 170/7/9; castle 500 HP, 9 atk; +3 damage per level | speeds in multiples of 100 ms |
| v19-shared-sight | 2026-10-04 | knight vision 6; archer aim 400; +2 damage per level | scripts share player vision; attacker visible 2 s |
| v20-unlocks | 2026-10-04 | archery and engineering: 100 mineral, 3 s | archer and tower need an unlock |
| v21-validated | 2026-10-05 | knight 17 atk, 110 HP; tower 160 HP; castle 600 HP / 7 def; damage research 250/350; tower range 150/250; archer range 200 | optimizer result: 443 search fights, best on 119 held-out fights (0.086 → 0.011 from v20) |
| v21b-knight-16 | 2026-10-06 | knight 16 atk (research 18/20) | with v21 Opus won 3 of 4 duels vs Sol even when both played knights; v21b went 2–2 and towers returned in free-for-alls |
| v21c-knight-unlock, v21d-no-unlocks | by 2026-10-07 | home mines 8 × 250 per seat; 4 flank mines of 500 | a knight unlock was tried (3 recorded games); v21d removed every unlock |
| v22-expansion | 2026-10-08 | castle 300, 20 s; tower 150; wall 25; door 40; home 1,200, flanks 2,800 per seat (quad 4,000) | |
| v23-reactive-orders | 2026-10-08 | | scripts keep running during orders and can suspend, resume or cancel them; a `+projectile16` variant was recorded in 2 games and not adopted |
| v24-no-draws | 2026-10-09 | | no winning side → every player loses, series ties too |
| v25-castle-knight | 2026-10-10 | castle range 5; knight 400 ms, mobility 300 ms | committed on 2026-10-11 as `v25-mineral-archer-tower`: capital → mineral, ranger → archer, turret → tower |
| v26-coordinated-movement | 2026-10-12 | | allies follow into vacated tiles; distinct arrival tiles; path costs from rounded step times |
| 0.27.0, 0.27.1 | 2026-10-14, 10-17 | | release numbering; `rules` tool → `guide`; neutral guide text |
| 0.28.0 | 2026-10-18 | archer training 8 s | `script_test` removed |
| 0.29.0 | 2026-10-19 | knight 100 HP, aim 200 ms; tower 240 HP; tower and castle atk 12; projectiles 16 tiles/s | `shootAt(x, y)`; minimum range; default archer stepped away from melee |
| 0.29.1, 0.29.2 | 2026-10-19 | | default archer shoots again, kiting left to players; the game is Castellan |
| 0.29.3 | 2026-10-19 | knight aim 100 ms | 0.29 made knight-heavy armies lose every recorded fight against kiting archers |

## History

### Status (ruleset v0, 2026-09-26)

Commands then: `pnpm sim --matrix --n 20`, `pnpm sim --latency-curve --bot eco`, `pnpm sim --a rush --b eco --latency-a 3000 --latency-b 10000`. Changes found with the sims: the Agent died to a 2-knight rush in 54 s → 400 HP / 10 def and a self-defending Nexus (range 4, scriptable); defense then dominated → Nexus atk 10 → 6, tower 150 → 200 (best of a small sweep); mirrored matches were decided by map side → tie-breaks follow the owner's side and mirrors draw; workers deadlocked head-on → blocked units re-plan around units. Income: 3 workers ≈ 330 mineral/min.

| Matchup | 20 games, final v0 | 10 games, attack script hits units before buildings |
|---|---|---|
| rush vs eco | 0% / 100%, 2.2 min | 20% / 80%, 3.3 min |
| rush vs turtle | 0% / 100%, 4.5 min | 60% / 40%, 4.6 min |
| eco vs turtle | 40% / 60%, 7.7 min | 60% / 40%, 8.6 min |
| eco vs eco | 50% / 50%, 4.4 min | |

Latency curve on the final v0 (eco at 3 s vs eco at N s, 10 games each): 60% vs 1 s, 70% vs 5 s, 80% vs 10 s, 90% vs 15 s; the 1 s point is within noise. Open then: eco beat rush 80/20; the goal was a rush > turtle > eco > rush triangle and a steeper curve.

First LLM match (Claude Code vs Codex, 2026-09-26): Codex opened with a tower rush next to the enemy Nexus; tower range 5 outranged it and instant construction left no counterplay, so v0 forbade building within 8 tiles of an enemy building (now 0: construction takes time). Second match: Codex won in 2:46 with 8 workers, an early 3-knight poke and 9 knights trained at once from banked mineral; Claude Code uploaded its scripts about 40 s in and lost the key fight during one 35 s `wait`. Instant training rewarded banking; preparation went 30 → 60 s so a slow-booting agent can read the rules.

Baseline spot check, 2026-09-28 (6 games per pair, seeds 1000–1005, both bots at 3 s, no research): rush vs eco 1–5 in 2.7 min, kite vs eco 2–4 in 4.8 min, kite vs turtle 6–0 in 5.6 min; no timeouts. A diagnostic of specific bots, not proof of balance.

### Archer

Added 2026-09-26. Bots `kite` (flee-and-shoot script) and `archers` (same army, built-in script) measure what programming is worth: kite vs archers 100%. After tuning (380 ms/tile, atk 12, 1 attack/s): kite vs eco (knights) 50%, archers vs eco 0%, kite vs turtle 100%. A good script decides the fight.

### Harness fairness

Claude players used to inherit the user's Claude Code configuration: an advisor tool (a stronger model called mid-match for ~70 s), auto-memory (one player saved lessons for the next match) and effort settings. `connectors/loop-keepers/claude-code/play.sh` now runs with `--setting-sources "" --tools "" --disable-slash-commands` and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`; the Codex keeper passes `--ignore-user-config --ignore-rules`. [connectors/README.md](../connectors/README.md) documents each keeper's isolation and residual tools. Single matches from that period:

| Match | Winner |
|---|---|
| Fable 5.1 high vs Codex gpt-6-astra (effort none) | Codex, 84 s (tower rush) |
| Fable 5.1 high vs Codex gpt-6-astra (effort none) | Codex, 2:46 |
| Opus 5.5 medium vs Opus 5.5 high (high used the advisor) | medium, 2:38 |
| Opus 5.5 high vs Opus 5.5 medium, isolated, sides swapped | medium, 3:23 |
| Opus 5.5 low vs gpt-6-astra low, open, archers available | astra, 2:03 (9 kiting archers from tick 0; Opus went knights, switched too late) |
| Fable 5.1 low vs gpt-6-astra low, open, no scripts in prep | astra, 2:33 (Fable acted first, tick 68 vs 146; astra out-produced it, 16 archers vs 6) |
| Fable 5.1 low vs gpt-6-astra low, open (doing/heading, hidden enemy orders, server timing) | astra, 2:27; think avg 4.9 s vs 3.8 s; Fable acted first (8.7 vs 14.1 s) and issued more orders (40 vs 28) |
| Fable 5.1 low vs gpt-6-astra low, open (actions return the view) | Fable, 9:20 by killing the Agent after losing its army by 1:30: 4 towers, a walled Nexus at 26 HP, workers swarmed the Agent; 53 kills vs 22. One mid-match state query with Fable's token counted as a Fable call |
| 2v2 quad: Fable 5.1 low + Opus 5.5 low vs gpt-6-astra low + gpt-6-sol low (`e58b411a`) | astra + sol, 3:50. Sol out at 2:27, Fable out at 2:49 (10 knights), astra's 17 archers beat Opus's 11. Opus was the fastest thinker (2.3 s, 86 orders) and still lost |

### Research and expansion probes (v1, v2)

v1 research values (12 → 14 → 16 damage, worker 3 → 5 → 7, cadence 1000 → 900 → 800 ms, mobility 400 → 300 ms in one level) were candidates, not optima. Audit of the last Opus/Astra pair before expansion (`b4de492a`, `ce02ddca`): extra workers trained 11 vs 6 and 11 vs 8; only research was Astra's `archer_damage` L1 at 169.5–179.5 s; Astra won both. The audit re-applied every recorded order rather than guessing purchases from the final army. A deterministic economy-only probe (open, seed 42, 9 workers, 1,200 starting mineral, no attacks) compared one 600-mineral expansion at (8,7), (8,10) and (11,6) against no expansion: total mineral first caught up at 120, 340 and 130 s. First crossings, not lasting leads, and nothing about the 200-mineral start or play under attack.

### v16–v20: composition experiments (2026-10-02 to 05)

#### Summary

1. Composition is mostly the model's choice, not the stats. On the same engine and numbers, Sol 6.1 and Astra 6 play almost only archers (~4% knights); Opus 5.5 plays almost only knights in duels (~76%). Opus does react to numbers: with the expensive knight (v17) or archer-favoring stats (v18) it switches to archers and wins. Sol and Astra change in no version.
2. Format counts. In free-for-all Opus drops to ~25% knights and builds towers (83 in 11 games); in duels nobody builds towers.
3. Simulation without the LLM does not predict real games. Results depend on which scripts fight: the same 10 knights vs 10 archers went from 1,000 vs 37 to 320 vs 1,000. The optimizer improved its search fights, not the held-out games.
4. Four engine and rule changes did move the game: v19 shared vision in scripts and attacker reveal (knights could not see archers shooting from 5 tiles); v19 +2 damage per level and 400 ms archer aim (forced knights went from 1/4 to 3/4 wins); v20 unlocks (Astra vs Sol went from ~1% to 39% knights in single games, 22% in series).
5. With v20 mechanics, changing unit numbers barely moves composition (33 games below). The 100 + 3 s unlock settles the knight as Opus's opening; Sol does not care.
6. Missteps: v17, the optimizer's output, gave 99% archers in real games although the simulation called it balanced; the engine rounds to 100 ms ticks, so 360 and 400 ms per tile were the same straight-line speed.

#### Optimizer runs

A (1+λ) search: 6 variants per round, keep the best. Fights were historical (the snapshot 1 s before each fight of 83 archived games: 221 fights) and designed (equal-mineral armies, 12 scenarios with paid research, 5 script pairs: standard, default, tactical and players'). Merit is damage weighted by target value per HP, against what each side's forces predict (Lanchester).

| Run | Goal | Result |
|---|---|---|
| First fights, final blow | even between units | v16 already even (1.50 / 1.52 / 1.74) |
| All fights | castle below the rest | tower traded 3.11; proposed a fragile tower and knight def 8 |
| Weighted by forces | weight by how even the battle was | same as above |
| Lanchester by damage | performance against expectation | archer traded 0.80 in v16 |
| + castle floor and racing | castle cannot sink; ~2× faster | — |
| + rock-paper-scissors | per-scenario targets | applied as v17 |
| Multi-start, hard rules, held-out | equal cost, minimum useful damage, 30% held-out games | applied as v18; no improvement on held-out games |

Why it fell short: the simulation sees neither the LLM's orders nor its composition choice; results depend on which scripts fight; historical fights are noisy and the search fits them. A Codex consult (Astra, maximum effort) found budget overspend and designed fights ending without contact (both fixed), proposed the hard rules and a seed of values, and recommended measuring the model's choice with held-out games.

#### Choice probe

`choice-probe.mts` asks, without playing: "with these rules and this situation, what do you train?" (4 situations × 4 repetitions × 2 models).

| Rules | Probe: % knights | Real games: % knights |
|---|---|---|
| v16 | ~50% (more towers) | ~48% |
| v17 | ~50% | ~1% |
| v18 | 80% | ~1% |

The opening matches the games (100% archers with Codex); once the model sees the enemy, it chooses differently than in play. The probe measures openings, not final composition.

#### Match batches v16–v20

Effort `low` where the source records it (v16, v17 batches); unstated for v18–v20. K = knights, R = archers, T = towers; totals count units trained per side across the batch. Forced knights test viability, not natural preference.

| Batch | Results | Composition | Replays |
|---|---|---|---|
| v16 · Haiku 4.5 vs Luna 5.6 | Luna 1, draw 1 | Haiku 11 K / 1 R (92% K); Luna 12 K (100%) | `16b14a81` open 3:34, `6fa03d74` fortress 10:00 (both predate circular distance: recomputed composition unreliable); `b0ed1682` 2v2 quad abandoned and deleted |
| v16 · Haiku vs Luna, second batch | 1–1 | Haiku 12 K (100%); Luna 7 K / 3 R (70%) | `cd465982` open 3:04 Haiku, `40017d11` fortress 2:44 Luna |
| v16 · Haiku vs Luna; Opus 5.5 vs Sol 6.1 | Luna; Opus | Haiku 10 K / 2 R; Luna 9 K / 5 R; Opus 14 K (100%); Sol 10 R (0%) | `e6c032a0` 5:36, `861b848d` 3:20 |
| v16 · Opus vs Sol, more duels | Opus 2 | Opus 21 K / 8 R (72%); Sol 23 R (0%) | `82c41f0f` 3:40, `2d6d0529` 3:37 |
| v16 · FFA 2 Opus + 2 Sol, quad | draw at 15:00 | Opus 25 K / 21 R / 13 T (54%); Sol 66 R / 14 T (0%) | `47c3df48` |
| v17 · Astra 6 vs Sol 6.1, 4 formats | Sol (open), draw (fortress), Astra team (2v2), Astra B (FFA) | Astra 94 R (0%); Sol 104 R (0%) | `f5e257f5`, `b73b4418`, `eb561067`, `1f4be552` |
| v18 · Astra vs Sol, 2 maps × 2 sides × 2 | Astra 6, Sol 2 | Astra 119 R (0%); Sol 2 K / 113 R (2%) | `04db8896`, `0f458d46`, `ceaf65ac`, `0b9ea374`, `d84778da`, `beeb9efb`, `6596f3e9`, `34218973` |
| v18 · Sol vs Sol, one side told ≥70% knights | free Sol 3, knights Sol 1 | 55 K / 59 R (48%) | `594493d7`, `5d69b5c7`, `eb3ebd01`, `e181764c` |
| v19 · same forced-knight setup | knights Sol 3, free Sol 1 | 111 K / 32 R / 3 T (78%) | `25c4e1fa`, `c0869815`, `04f29311` (the free side also went 29 K), `bdc3aa40` |
| v19 · Astra vs Sol, free | Astra 2, Sol 1, draw 1 | Astra 4 K / 63 R (6%); Sol 2 K / 71 R (3%) | `8c0eb9ad`, `449cc547`, `654f2118`, `1bfa6112` |
| v20 · Astra vs Sol, free | Astra 3, Sol 1 | Astra 33 K / 29 R (53%); Sol 15 K / 47 R (24%) | `aa93929e`, `d61d3345`, `9983148d`, `d3b5e991` |

#### Series of 3 games (Astra 6 = p1 vs Sol 6.1 = p2)

| Series | Score | Composition | Games |
|---|---|---|---|
| v17 fortress `d747296879d628db` | 2–0 | Astra 55 R; Sol 50 R / 1 T | `8ee6ce29`, `55ba2125`, `e659c8f6` (draw 10:00) |
| v17 open `1d02ee9103ab6efd` | 2–1 | Astra 2 K / 41 R / 1 T (5%); Sol 2 K / 52 R (4%) | `77ec08c1` (Sol), `8c37daf2`, `da41fe6a` |
| v19 fortress `d70be521961e7642` | 1–2 | Astra 57 R; Sol 64 R / 1 T | `14733a5d` (Astra), `c73a8a39`, `9d0b24bd` |
| v19 open `abcaa7ae82fc7746` | 2–0 | Astra 3 K / 75 R (4%); Sol 3 K / 59 R / 2 T (5%) | `dc9e8e37` (draw), `792bf83d`, `07bcad39` |
| v20 open `8d1d16039090c393` | 2–1 | Astra 22 K / 16 R (58%); Sol 11 K / 17 R (39%) | `b12651f9`, `0342f956`, `64acd250` (Sol) |
| v20 fortress `c9a693b8b1896a0d` | 3–0 | Astra 60 R (0%); Sol 4 K / 40 R (9%) | `c79b171d`, `6ce74fad`, `4d8d5799` |

#### Stat transplants on the v20 engine

Each version's unit numbers and research on the v20 engine, open map, mirror duels (unlocks off; aim, training and construction per version): Sol vs Sol and Astra vs Astra, 22 games, Sol 18 K / 352 R / 5 T (5%), Astra 10 K / 362 R / 5 T (3%): `f0d5df4e` `8094aa44` (v0), `457cabef` `ec7b28a8` (v1–v10), `055d8366` `2702d492` (v11), `b0bfefc8` `79736645` (v12), `34a245bd` `382c5ed0` (v13), `e6268eb3` `15ceaac4` (v14–v15), `d7f5b62a` `a6503aaa` (v16), `d072fc8d` `61691917` (v17), `76244611` `a716b1eb` (v18), `33a959cc` `208fb21a` (v19), `14c5d4fd` `949deae7` (v20). Opus vs Opus, 11 games, 324 K / 103 R / 2 T (76%): `6852ae1d`, `4206d7a0`, `8e9e1fb9`, `2b0bce07`, `665ca7dd`, `39299ddc`, `7d378b9f`, `3e2655cb` (v17: the winner used 6 K + 21 R), `48cddbac` (v18: the winner used 13 R), `557e35c3`, `d0349692`. FFA 2 Opus + 2 Sol on quad, 11 games, Opus 152 K / 363 R / 83 T (30%), Sol 1 K / 604 R / 4 T (0%): `02c23f2d`, `242d8884`, `3cab065c`, `c8296c82`, `aad2fb18`, `7e16177c`, `d8af4f12`, `3bfbae5a`, `88c65c84`, `24f5cd93`, `583c31ff`.

Full v20 rules (unlocks, aim, training and construction times, blind spot, shared sight) with only each version's unit numbers, 33 games: Sol 49 K / 874 R / 0 T (5%); Opus 899 K / 95 R / 75 T (90%). Opus duels 100% knights (514 K, 0 R) even with v17 and v18 numbers; Sol duels 94% archers; FFA Opus 80% knights and 71 towers, Sol 95% archers and 0 towers, won by Sol 5, Opus 4, 2 draws. 4 games interrupted by a computer suspension (`78755cbe`, `73021692`, `7df33ce8`, `ecdb75e5`) were repeated; only the repeats count. FFA: `1973bfbd`, `6645275e`, `380e0405`, `f002928f`, `3829ed85`, `0c5beace`, `49775f04`, `ee0df0e4`, `09cc8839`, `ff910198`, `3097737c`. Opus duels: `128fe8ba`, `8ac4ebfd`, `e9843428`, `990c649f`, `fb4f859e`, `c174d94f`, `33e21a5f`, `b9c012c5`, `51215183`, `6b504ebd`, `8a881a6b`. Sol duels: `87ae313a`, `ea30cbf9`, `8152475f`, `4ea62767`, `f3fa3057`, `51cb2d61`, `9fc01705`, `c0211dbe`, `9a89a904`, `94bec3c1`, `8875d056`.

### v22-expansion: full-game Sol Low experiment (2026-10-08)

Hypothesis: a Castle at 300 mineral and 20 s (3 military units instead of 6) makes an extra production and dropoff center a practical investment, and moving 800 home mineral per seat to the flanks gives expansion a territorial purpose without new money or mechanics. Method: 19 complete matches with `gpt-6.1-sol` through Codex 0.159.0, reasoning `low`, fresh isolated contexts, game tools only, real time with the normal clock, 60 s preparation and 10/15-minute limits. 15 games were natural play; 4 stress games asked for defensive or walling openings against early knight pressure, control and candidate alike. A completed Luna Low pilot is recorded separately; interrupted pilots are excluded; Sol and Luna are never pooled.

In the 3 natural control games, none of 8 players expanded; a 450-cost candidate produced none in 2 games; at 300/20 s all 4 players expanded in the next 2 games. Small exploratory samples, not win rates. Values were frozen before 3 validation games: `2a3386d9` (open, seed 73) draw at 10:00, both expanded, p2 survived with only its King; `65e1b1ec` (ridge, seed 89) p2 won at 5:10, p1's forward Castle destroyed after receiving 1,600 mineral; `02101538` (fortress-quad, seed 97) p3/p4 won at 5:54 with two productive expansions and 12 team messages without a chat directive. 6 of 8 validation players expanded; all 6 new Castles received deliveries (10,230 mineral together) and accepted training orders; 3 were destroyed. Delivered mineral is not profit or a measured payback.

Limits and rejected changes: natural play built no new walls; the directed walling test raised 3 walls and a door by 17.4 s without protecting the economy and lost at 1:58 (its control lost at 6:28). Cheap Castles replacing towers is a risk to watch; the surviving-King draw was still a limitation. A 700 ms knight aim left a researched Knight unable to hit a fleeing, slower Worker for 30 s (100 ms killed it in 5 s): rejected before LLM games. The diagonal first-hit mismatch (the engine changes tile before the renderer finishes the step) was left as is. All 19 replays reproduce their hashes; `pnpm test` passed 71 files and 440 tests; the Castellan bot lost its old rush canary and was not retuned. Evidence: `reports/balance-luna-20261008/` (`games-summary.json`, `selection.json`, `numeric-diff.json`, `scope.json`, per-game logs); the directory keeps the originally requested model's name.

### v24-no-draws: outcome rule (2026-10-09)

Without draws, waiting out the clock is less attractive. Deterministic tests cover 1v1, FFA, teams, unequal scores, last-tick victory, mutual elimination, series losses and historical rules; a short HTTP FFA ended with 4 living Kings and 4 losses; the Opus replay `0fccbf5b` still matches its 91 hashes and its v23 draw (`reports/no-draws-20261009/`). First Opus rematch: 4 fresh `claude-opus-5-5` sessions through Claude Code 2.1.294, effort `low`, `04331fac` on `quad-contested`, seed 419, fixed positions and the prompt of `0fccbf5b`. P2 won by King elimination at 598.3 s against the original 900 s draw: military combat deaths 3 → 108, first military damage 232.5 → 57 s, chat 0 → 3 private messages, 3 expansion Castles and no towers against 8 and 27. All 61 hashes match; all 4 sessions ended normally with no subagents, script errors or sandbox failures. One comparison with uncontrolled decisions and latency: it supports the hypothesis without proving a repeatable effect (`reports/ffa-no-draws-opus-20261009/`).

### v25-castle-knight: local defense and melee mobility (2026-10-10)

Castle range 6 → 5 and Knight 500 → 400 ms per straight tile (300 with mobility research); nothing else changed. A Castle should defend its nearby economy and towers handle longer range: range 5 removes 40 of the 136 tiles a Castle reaches on open ground (29.4%); base archers still enter return fire, and range research lets them shoot from outside. Knights should push ranged units and catch workers. Evidence: the last 2 full games, `1abcc26e` and `314a03de`, produced 238 archers and 5 knights; in `314a03de` Opus's 2 knights dealt no damage under its defensive scripts and Astra's 2 knights arrived separately and died within 4 s. Fixed-policy probes from both seats: against an archer retreating inside 3 tiles, a baseline Knight took 16 shots and landed none in 20 s; at 400 ms it still landed none but forced the retreat and took 1 shot; against a fleeing worker the first hit moved from none in 12 s to 9.1 s. These measure contact, suppression and defense, not damage parity. An earlier `pressure` experiment tried 400 ms with other changes and gave no convincing full-game evidence. `reports/landing-balance-v25-20261010/probes.mts` records the probes. Fresh, unprompted LLM games are still needed before claiming more varied armies.

### Releases 0.28.0 to 0.29.3 (2026-10-18 to 19)

Archers train in 8 s like Knights. 0.29.0 gave towers and Castles 12 damage, towers 240 HP, projectiles 16 tiles/s and `shootAt`, and took the Knight to 100 HP with a 200 ms aim; after that, knight-heavy armies lost every recorded fight against kiting archers, so 0.29.3 restored the 100 ms aim (150 would round to 200). The current numeric candidate is still v25's targeted change; broader army diversity needs full-game validation.
