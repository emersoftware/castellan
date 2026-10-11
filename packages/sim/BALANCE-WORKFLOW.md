# Reliable balance experiments

Run from the repository root. These commands use the local engine and reference bots; they do not call paid models.

```sh
pnpm exec vitest run packages/sim/test/sim.test.ts
pnpm exec tsx packages/sim/src/bot-smoke.mts 90
pnpm exec tsx packages/sim/src/bot-smoke.mts 180
# Optional comma-separated bot and map filters:
pnpm exec tsx packages/sim/src/bot-smoke.mts 180 rush,archers open,fortress
```

The smoke run plays each of the five reference bots on `open` and `fortress`, in both seats, with a three-second decision interval and seed 7. Its opponent makes no decisions; the opponent's default unit scripts still run. Each JSON line reports military entities produced, attacks, and rejected orders with reasons. Zero rejections establishes legal production, not competitive strength. The ordinary `pnpm sim` command also reports rejection totals and reasons. Bot factories accept the match ruleset, so custom costs, research prerequisites, queue limits and population caps are respected.

The October 7 local check, on `v21d-no-unlocks` with the redistributed map deposits, completed all 20 ninety-second cases with zero rejected orders and zero script errors. Military production was rush 6, eco 7, turtle 2, kite 5, archers 5 on either map and either seat. Rush attacked by 90 seconds (9 attacks on open, 34 on fortress). In the 180-second check, rush/eco/kite/archers engaged on both maps; turtle produced three towers and six knights but had not launched its eight-knight attack. Results were symmetric across seats. These are production/exploration checks against an inactive controller, not win-rate estimates against capable opponents.

## Recorded battles

```sh
mkdir -p /tmp/aoa-balance-run
REPLAYS="$PWD/replays" pnpm exec tsx packages/sim/src/extract-recent.mts > /tmp/aoa-balance-run/battles.json
BATTLES=/tmp/aoa-balance-run/battles.json OUT_DIR=/tmp/aoa-balance-run/results pnpm exec tsx packages/sim/src/balance-optimize.mts 25 1
```

The optimizer arguments are maximum generations and maximum search hours. `VARIANTS=1` restricts evaluation to the original staging; the default includes open and jittered variants. `SYNTHETIC=0` omits designed scenarios. Use a new `OUT_DIR` for each experiment. `BATTLES` must contain at least three independent replay IDs, with usable combat in the search partition.

`aoa-battle-v2` stores the source rules, seed, tick rate, player seats/teams, all orders before the battle boundary, and a hash at that boundary. Extraction verifies every available replay hash and the final hash; incompatible replays are skipped. Continuation re-executes the prefix and verifies the boundary hash. This preserves the actual QuickJS runtime, unit memory, cooldowns, aiming timers, projectiles, economy, production, construction, vision, elapsed time and orders. It does not reconstruct them from a spectator view.

Any replay whose experiment manifest records `operationalFailures` is excluded before extraction, even for a battle preceding that failure. A live wall-clock watchdog can stop a player's VM at a nondeterministic time; offline replay cannot faithfully reconstruct that operational outcome. Such matches are evidence about runtime reliability, not balance samples. Prefix creation and restoration enforce the same restriction.

View-only battle files from the old extractor are rejected with a re-extraction instruction. Designed scenarios are explicitly marked `synthetic`; their setup is a new game, not a claim of continuation fidelity. Their initial vision is refreshed before accepting attack orders, and combat on their first tick is included in metrics.

Exact prefix execution is slower than the old lossy reconstruction, particularly for late fights. It deliberately pays that cost rather than claim reproducibility. The regression test compares subsequent events, complete views and hashes against the original match, including memory-dependent actions and projectiles already in flight.

A bounded October 7 check extracted seven fights from three actual archived games (`9d0b24bd`, v19; `e659c8f6`, v17; `eb16c5f4`, v21d), with all replay hashes verified and no skips. Restoring `9d0b24bd#0` at tick 1630 reproduced `cd363e8b`; applying the original subsequent orders through tick 1700 reproduced the archive's next checkpoint, `2f4800f4`. A separate 60-tick autonomous continuation registered combat with zero script errors and zero rejected setup orders. Source rules were retained throughout. This verifies those three archives, not the full historical catalogue.

Candidate combat stats take effect at the boundary. Current health scales with maximum health; cooldown deadlines, paid production, economic history and shots already launched remain historical. Open/jittered variants intentionally alter geometry. These are counterfactual tactical continuations, not full matches replayed under new economy costs. Script errors and rejected setup orders abort optimizer evaluation instead of silently contributing a score.

## Search, selection and final test

All fights and variants from a replay stay in one deterministic partition. With enough replays, the split is approximately 60% search, 20% validation, and 20% final test; small datasets retain at least one replay per partition. `split.json` records membership.

Search data drives candidate generation, starting-point selection and racing. Validation selects among improving candidates. The chosen values are written to `validated.json` before the final test runs. Only then are the baseline and that frozen candidate evaluated on the final partition, producing `final-test.json`. Final-test games are not used even for the initial contact filter.

Validation performance is a selection result. Final-test performance is an independent estimate for that run. If its report informs further tuning, those games are no longer an untouched test set: collect new independent games for the next final test.

The parity/RPS objective and its economic assumptions have not been changed. A lower diagnostic score does not establish that the RTS is globally more balanced or more interesting. This workflow repairs the evidence used to assess candidates; it does not automatically publish rule changes.
