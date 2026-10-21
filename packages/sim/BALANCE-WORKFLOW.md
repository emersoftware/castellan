# Reliable balance experiments

Run these commands from the repository root. They use the local engine and reference bots, not paid models.

```sh
pnpm exec vitest run packages/sim/test/sim.test.ts
pnpm exec tsx packages/sim/src/bot-smoke.mts 90
pnpm exec tsx packages/sim/src/bot-smoke.mts 180
# Optional comma-separated bot and map filters:
pnpm exec tsx packages/sim/src/bot-smoke.mts 180 rush,archers open,fortress
```

The smoke run plays each of the 5 reference bots on `open` and `fortress`, in both seats, with a 3-second decision interval and seed 7. The opponent makes no decisions, but its default unit scripts still run. Each JSON line reports military entities produced, attacks, and rejected orders with reasons. 0 rejections proves legal production, not competitive strength. The plain `pnpm sim` command also reports rejection totals and reasons. Bot factories take the match ruleset, so they respect custom costs, research prerequisites, queue limits and population caps.

The October 7 local check ran on `v21d-no-unlocks` with the redistributed map deposits. All 20 cases of 90 seconds finished with 0 rejected orders and 0 script errors. Military production was rush 6, eco 7, turtle 2, kite 5, archers 5 on either map and either seat. Rush attacked by 90 seconds (9 attacks on open, 34 on fortress). In the 180-second check, rush/eco/kite/archers fought on both maps. Turtle built 3 towers and 6 knights but had not launched its 8-knight attack. Results matched across seats. These are production/exploration checks against an inactive controller, not win-rate estimates against capable opponents.

## Recorded battles

```sh
mkdir -p /tmp/castellan-balance-run
REPLAYS="$PWD/replays" pnpm exec tsx packages/sim/src/extract-recent.mts > /tmp/castellan-balance-run/battles.json
BATTLES=/tmp/castellan-balance-run/battles.json OUT_DIR=/tmp/castellan-balance-run/results pnpm exec tsx packages/sim/src/balance-optimize.mts 25 1
```

The optimizer arguments are maximum generations and maximum search hours. `VARIANTS=1` limits evaluation to the original staging; the default adds open and jittered variants. `SYNTHETIC=0` leaves out designed scenarios. Use a new `OUT_DIR` for each experiment. `BATTLES` needs at least 3 independent replay IDs, with usable combat in the search partition.

`castellan-battle-v2` stores the source rules, seed, tick rate, player seats/teams, all orders before the battle boundary, and a hash at that boundary. Extraction checks every available replay hash and the final hash, and skips incompatible replays. Continuation re-runs the prefix and checks the boundary hash. This keeps the real QuickJS runtime, unit memory, cooldowns, aiming timers, projectiles, economy, production, construction, vision, elapsed time and orders. It does not rebuild them from a spectator view.

Extraction excludes any replay whose experiment manifest records `operationalFailures`, even for a battle before that failure. A live wall-clock watchdog can stop a player's VM at a nondeterministic time, and offline replay cannot rebuild that outcome faithfully. These matches are evidence about runtime reliability, not balance samples. Prefix creation and restoration apply the same rule.

View-only battle files from the old extractor fail with a re-extraction instruction. Designed scenarios carry the `synthetic` mark. Their setup is a new game, not a claim of continuation fidelity. Their initial vision refreshes before they accept attack orders. Metrics include combat on their first tick.

Exact prefix execution is slower than the old lossy reconstruction, mostly for late fights. The workflow pays that cost rather than claim reproducibility. The regression test compares later events, complete views and hashes against the original match. It covers memory-dependent actions and projectiles in flight.

A bounded October 7 check extracted 7 fights from 3 real archived games (`9d0b24bd`, v19; `e659c8f6`, v17; `eb16c5f4`, v21d). All replay hashes matched and none were skipped. Restoring `9d0b24bd#0` at tick 1630 reproduced `cd363e8b`. Applying the original later orders through tick 1700 reproduced the archive's next checkpoint, `2f4800f4`. A separate 60-tick autonomous continuation saw combat with 0 script errors and 0 rejected setup orders. Source rules stayed throughout. This verifies those 3 archives, not the full historical catalogue.

Candidate combat stats apply from the boundary. Current health scales with maximum health. Cooldown deadlines, paid production, economic history and shots already launched stay as recorded. Open/jittered variants change geometry on purpose. These are counterfactual tactical continuations, not full matches replayed under new economy costs. Script errors and rejected setup orders abort optimizer evaluation instead of silently adding to a score.

## Search, selection and final test

All fights and variants from a replay stay in 1 deterministic partition. With enough replays, the split is about 60% search, 20% validation and 20% final test. Small datasets keep at least 1 replay per partition. `split.json` records membership.

Order of work:

1. Search data drives candidate generation, starting-point selection and racing.
2. Validation picks among the improving candidates.
3. The optimizer writes the chosen values to `validated.json`.
4. Only then does the final partition evaluate the baseline and that frozen candidate, writing `final-test.json`.

No earlier step uses final-test games, not even the initial contact filter.

Validation performance is a selection result. Final-test performance is an independent estimate for that run. If its report guides more tuning, those games stop being an untouched test set. Collect new independent games for the next final test.

The parity/RPS objective and its economic assumptions are unchanged. A lower diagnostic score does not prove the RTS is more balanced or more interesting overall. This workflow fixes the evidence used to judge candidates. It does not publish rule changes automatically.
