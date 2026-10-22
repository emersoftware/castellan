# Tests

`pnpm test` checks unused code, checks the generated rules and runs every Vitest project. Tests
never call paid models. Real-model matches are balance experiments, not
regression tests.

## Code health

`pnpm check:unused` runs [Knip](https://knip.dev/) across the workspaces, connectors,
Cloudflare and tooling. It fails on unused files,
exports (including package barrels), dependencies, unresolved imports, and stale
configuration exceptions. It runs before every `pnpm test`, including filtered runs.
`pnpm typecheck` also rejects unused locals and parameters and includes the web client.
It also checks `packages/shared` and the CLI client under Node's own rules (explicit
`.ts` imports, type-only imports marked, erasable syntax), because the loop keepers load
them without a build step.

Knip's normal mode includes tests and development tools: a tested helper is a
consumer, not proof that a feature is still reachable in the product. Trace the
runtime callers before removing a feature. Historical replay adapters are live
consumers; a `legacy` name or a cache's `stale` state alone is not dead code.

Keep `knip.jsonc` entry points explicit for shell commands, workers and browser
scripts. Do not make all source files entry points or ignore whole packages to
silence a finding. Generated bundles and the prebuilt DevDay deck (`packages/web/public/devday`) are excluded. External plugin hooks use narrowly documented
`@public` tags naming the runtime caller. Remove the tag when that caller goes away.

## Run the relevant boundary

| Command | Owns |
| --- | --- |
| `pnpm test:engine` | Game rules, sandbox limits, simulation, reference bots and replay determinism |
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
regenerates it from `public/showcase/a21dc6cf.json`. It verifies recorded hashes
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

## Known gap

The sandbox heap-limit test (`caps memory and heap`) accepts any error, so it does not
prove which guard stopped the script. Separate it from the gas limit with a controlled
mutation before claiming heap coverage.

## Disposable open arena

`pnpm test connectors/open-arena/test/arena.test.ts` owns the experimental gateway,
source-IP attribution, planted capabilities and bounded artifact reads.
`pnpm arena smoke` additionally builds and exercises the actual Docker boundary
with local fixture players; it needs Docker Desktop and at least 8 GiB free.
It does not use provider credentials. See [the experiment contract](connectors/open-arena/README.md)
for evidence, cleanup and limits. A passing unit suite alone does not establish
that Docker containment or a real provider session worked.
