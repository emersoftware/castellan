# Tests

`pnpm test` checks the generated rules and runs every Vitest project. Tests do
not call paid models. Real-model matches are balance experiments, not the
regression suite.

## Run the relevant boundary

| Command | Owns |
| --- | --- |
| `pnpm test:engine` | Game rules, sandbox limits, simulation and replay determinism |
| `pnpm test:integration` | Server lifecycle/storage, HTTP, CLI, MCP and replay catalog |
| `pnpm test:agents` | Autonomous and Castellan policies, scripts and runtimes |
| `pnpm test:web` | Rendering, playback, spectator UI and asset contracts |

For one owner: `pnpm test --project server`. For one file:
`pnpm test packages/engine/test/projectiles.test.ts`. Combine project filters,
or add `-t 'test name'` to narrow a run. After changes, run `pnpm test` and
`pnpm typecheck`; use the relevant build for changes to application code.

Tests live beside their owning package in `test/`. Vitest's named projects
select those directories; adding a new package requires registering its test
directory in `vitest.config.ts`. `pnpm exec vitest list --filesOnly` shows the
discovery result. Two workers limit contention between QuickJS heaps, isolated
script workers and real servers. Override with `--maxWorkers` when needed.

For replay performance, run `pnpm exec tsx packages/engine/scripts/benchmark-replay.ts <replay.json[.gz]>` against the same recording before and after a change. Add
`--board-only` for the landing's decorative view. It measures simulation time to
the first frame, first casualty and completion while checking recorded hashes;
browser download/render time must be measured separately. Keep other test and
benchmark processes stopped when comparing timings.

## What deserves a test

Following [Bipbop test-audit](https://github.com/BipBop-Labs/bipbop-skills), identify
the observable contract, a credible regression, why existing coverage cannot
catch it, and whether the test needs a production hook that no real caller uses.
Prefer a case in the owning table over another copy in a different suite.
For bug fixes, demonstrate that the regression fails before the fix.

* Engine tests own game mechanics; `victory.test.ts` owns the timeout policy for
  duel, FFA and teams, including unequal scores and historical replay rules.
* Server tests own authorization, observation cursors, checkpoints and replay
  publication. Connector tests additionally protect argument forwarding and
  the real CLI/MCP transport. Keep both where those risks differ.
* Security, replay hashes, protocol tool lists and sprite byte equivalence are
  independent contracts. Do not remove them merely because they are exact or slow.
* Name a test for what it actually observes. A training test does not prove
  ranged combat. Do not manufacture expected output with the function under test.

## Fixtures and time

* Dispose every `Match`, including on failed assertions, using `finally` or a
  file-local registry drained in `afterEach`. Finishing a match does not dispose
  its QuickJS VMs.
* Close MCP clients before their server. Close servers before deleting their
  temporary directories. Restart tests retain the same directory until the last
  server closes. Keep servers scoped to a test unless sharing is intentional.
* Connect players explicitly, then observe `/status` for readiness. Polling
  `/state` consumes observations; retrying a mutation can hide its first failure.
  `packages/server/test/support/readiness.ts` supplies bounded assertions for
  injected HTTP tests; socket tests use the same pattern over real `fetch`.
* Use `vi.waitFor` with a deadline and assertions, not fixed sleeps or unbounded
  loops. Use fake clocks for the specific timer contract, not around real sockets.
* `finished` does not guarantee replay publication. Before deleting a finished
  game's directory, observe both `/replays/:id` and its `/replays` index entry.
* Do not edit source or tests while their runner is executing in this checkout.

## This audit

Removed two weaker timeout cases from `engine.test.ts` and `four-seats.test.ts`;
the duel/FFA/teams matrix in `victory.test.ts` retains their behavior plus result
and presentation checks. Removed the repeated `[rules, rules]` projectile rows;
10, 20 and 40 Hz remain covered once each. No production behavior changed.

Follow-up: isolate the sandbox heap-limit assertion from the gas limit. Its
current broad error assertion alone does not prove which guard interrupted the
script; strengthen it with a controlled mutation before claiming heap coverage.
