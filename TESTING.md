# Tests

`pnpm test` checks the generated rules and runs every Vitest project. Tests
never call paid models. Real-model matches are balance experiments, not
regression tests.

## Run the relevant boundary

| Command | Owns |
| --- | --- |
| `pnpm test:engine` | Game rules, sandbox limits, simulation and replay determinism |
| `pnpm test:integration` | Server lifecycle/storage, HTTP, CLI, MCP and replay catalog |
| `pnpm test:agents` | Autonomous and Castellan policies, scripts and runtimes |
| `pnpm test:web` | Rendering, playback, spectator UI and asset contracts |

One owner: `pnpm test --project server`. One file:
`pnpm test packages/engine/test/projectiles.test.ts`. Combine project filters,
or add `-t 'test name'` to narrow a run. After changes, run `pnpm test` and
`pnpm typecheck`. For application code, also run the relevant build.

Tests live in each package's `test/`. Vitest's named projects select those
directories. A new package registers its test directory in `vitest.config.ts`.
`pnpm exec vitest list --filesOnly` shows what Vitest finds. 2 workers limit
contention between QuickJS heaps, isolated script workers and real servers.
Override with `--maxWorkers`.

For replay performance, run `pnpm exec tsx packages/engine/scripts/benchmark-replay.ts <replay.json[.gz]>` on the same recording before and after a change.
Add `--board-only` for the landing's decorative view. It measures simulation
time to the first frame, first casualty and completion, and checks recorded
hashes. Measure browser download and render time separately. Stop other test
and benchmark processes when you compare timings.

The landing plays a generated, board-only recording instead of running the
simulation in the browser. `pnpm --filter @castellan/web showcase:build`
regenerates it from `public/showcase/02eb6795.json`. It verifies recorded hashes
and every decoded frame, and caches the result by source/content hashes.
`predev` and `prebuild` run it automatically. Git ignores generated chunks and
smaller hero sprites. Watch and the full replay viewer keep their data paths
and full-size art. The first build computes the recording; unchanged builds
reuse it. For hero load, `castellan-hero-ready` marks the first presented
frame. Measure downloads and this mark in a fresh browser context, including
slow network runs.

## What deserves a test

Following [Bipbop test-audit](https://github.com/BipBop-Labs/bipbop-skills), identify:

1. the observable contract;
2. a credible regression;
3. why existing coverage cannot catch it;
4. whether the test needs a production hook that no real caller uses.

Prefer a case in the owning table over a copy in another suite.
For bug fixes, show that the test fails before the fix.

* Engine tests own game mechanics. `victory.test.ts` owns the timeout policy for
  duel, FFA and teams, including unequal scores and historical replay rules.
* Server tests own authorization, observation cursors, checkpoints and replay
  publication. Connector tests also protect argument forwarding and the real
  CLI/MCP transport. Keep both where their risks differ.
* Security, replay hashes, protocol tool lists and sprite byte equivalence are
  independent contracts. Keep them even when they are exact or slow.
  The full recorded-match recovery test keeps all 7,187 ticks, 73 hashes and
  spectator perspectives, with its own 180-second timeout for shared CI CPUs.
* Name a test for what it actually observes. A training test does not prove
  ranged combat. Never build the expected output with the function under test.

## Fixtures and time

* Dispose every `Match`, also when an assertion fails. Use `finally` or a
  file-local registry that `afterEach` drains. A finished match does not
  dispose its QuickJS VMs.
* Close MCP clients before their server. Close servers before you delete their
  temporary directories. Restart tests keep the same directory until the last
  server closes. Scope each server to one test unless you share it on purpose.
* Connect players explicitly, then check `/status` for readiness. Polling
  `/state` consumes observations. Retrying a mutation can hide its first
  failure. `packages/server/test/support/readiness.ts` gives bounded assertions
  for injected HTTP tests. Socket tests use the same pattern over real `fetch`.
* Use `vi.waitFor` with a deadline and assertions, not fixed sleeps or unbounded
  loops. Use fake clocks for the timer contract under test, not around real
  sockets.
* `finished` does not guarantee that the replay is published. Before you delete
  a finished game's directory, check both `/replays/:id` and its `/replays`
  index entry.
* Do not edit source or tests while their runner executes in this checkout.

## This audit

The audit removed 2 weaker timeout cases from `engine.test.ts` and
`four-seats.test.ts`. The duel/FFA/teams matrix in `victory.test.ts` keeps
their behavior plus result and presentation checks. It removed the repeated
`[rules, rules]` projectile rows; 10, 20 and 40 Hz stay covered once each. No production behavior changed.

Follow-up: separate the sandbox heap-limit assertion from the gas limit. Its
current broad error assertion does not prove which guard stopped the script.
Strengthen it with a controlled mutation before you claim heap coverage.
