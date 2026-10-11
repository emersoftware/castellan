# @aoa/sandbox
Runs bot scripts with `quickjs-emscripten` (QuickJS in WASM). Chosen over isolated-vm for isolation (WASM + interpreter), determinism and browser support. isolated-vm is in maintenance mode.

- One QuickJS runtime per player: `setMemoryLimit(8MB)`, `setMaxStackSize`.
- Script upload: ≤4 KB; TS is type-stripped on the server (esbuild `transform`); compiled once.
- Per tick, per unit: construct `self` (data + functions returning plain objects), run the script. Budget via `setInterruptHandler` counting cycles: the ruleset's `gasPerUnit`, and `gasPerPlayer` for the whole tick. Out of gas → `hold()` + error event. A failed script upload keeps the previously installed script.
- `Date`, `WeakRef` and `FinalizationRegistry` are removed and `Math.random` is seeded (determinism). `eval` stays: it can only run more code inside the same metered VM. `self.random()` is the seeded PRNG. `self.memory` is JSON ≤1 KB per unit.
- The first action call counts; none → `hold()`. The engine re-validates every action.
- Per tick the world is loaded into the VM once (one JSON string); then one call per unit. Every VM call after the trusted prelude bootstraps is metered, including world loading and result/error serialization. Loading consumes the player budget; unit execution additionally consumes the unit budget. Intrinsics, their prototypes and global bindings are recursively frozen so one script cannot replace the loader's `Array.prototype.map`, `Object.keys`, JSON functions or math helpers on later ticks.
- The deterministic budget counts interpreter interrupts, not milliseconds. QuickJS interruption is cooperative; see its [runtime interrupt contract](https://github.com/justjake/quickjs-emscripten/blob/main/doc/quickjs-emscripten/classes/QuickJSRuntime.md#setinterrupthandler). Live Node rooms additionally use a dedicated worker per player with an external 250 ms emergency deadline per VM request, enforced by the parent through `Atomics.wait` and worker termination. Worker startup is bounded separately at 10 seconds. The VM stays terminated after a timeout: actions hold and produce an explicit script error; memory is never silently reset. Offline simulation and browser replay retain the synchronous adapter.
- Golden: per-unit scripts. Python is out (it widens the attack surface).

## Decision context

`self.attackReadyInTicks`, `moveReadyInTicks`, `aimReadyInTicks` and `gatherReadyInTicks` are measured before the current tick's actions. Attacking requires both attack and aim readiness. `self.canMove(direction)` reports current local passability, ignoring cooldown, as `true`, `false`, or `null` if the occupancy/corner check would require unseen tiles. It is a snapshot, so another unit may occupy the destination before this unit moves.

`self.lastActionResult` is null initially, then `{tick, action, status, effect?, reason?}` for the most recent script decision. Status distinguishes `acted`, `blocked`, `cooldown`, `aiming`, `held`, `invalid` and `arrived`. An attack request may have `effect: "move"` while chasing. An `attack` effect means a melee strike or projectile launch, not a guaranteed hit. Manual orders override scripts; the result retains the original tick while a manual order runs.

Visible entities include public combat stats and `ruin`. Cooldowns, orders and scripts of opponents are not exposed. Terrain queries and entity stats use the player's existing fog boundary.

## Testing scripts locally

After `await initSandbox()`, `testScript(code, kind, worlds, limits, seed)` runs one or more finite `ScriptWorld` scenarios with memory retained between those frames in an isolated VM. It returns compile failures or `{ok:true, frames:[{tick,runs}]}`; each unit run contains its requested action, error/log and `gasUsed` (interrupt cycles). It does not simulate movement or combat between input worlds.

`Match.testScript(player, kind, code)` uses the player's current observed context and own units of that kind. It starts with fresh memory and a fresh seeded random stream; it does not advance the match, install the code, mutate the live script VM, or consume an event cursor. Compare requests with readiness/passability and, once installed, actual `lastActionResult`. A kind with no living units produces an empty run map, so compilation success alone is not evidence of runtime behavior.

## Node supervision

`packages/server/src/script-isolation.ts` provides `createIsolatedScriptHost`, plus asynchronous `runOnceIsolated` and `validateScriptIsolated` for HTTP execution and compile checks. Match configuration injects the host factory, and probes reuse it. The worker entry is bundled once from trusted repository sources with the server's existing esbuild dependency. Workers execute plain JavaScript without inheriting tsx/Vite/main-process loader hooks; those can otherwise deadlock when the parent waits synchronously. The WASM itself remains the pinned single-file dependency.

Persistent host transport has a fixed 1 MiB buffer with validated lengths and atomic request/response states. Oversized requests fail explicitly. Worker memory/stack have Node resource limits in addition to QuickJS's configured heap/stack. Match/host disposal terminates the worker, and a startup failure closes any players already allocated for that match. One-shot timeouts return no orders. Trusted adapter errors carry `operationalFailure: true`; user-thrown errors cannot supply that flag or exclude a match just by imitating its error message. Watchdog/worker failures are recorded in `experiment.operationalFailures`; `runReplay` refuses those replays before evaluating scripts, and battle extraction excludes them. A watchdog-triggered result must not be treated as deterministic evidence of strategic strength. Normal worker and inline runs are tested for identical events and hashes.

Validation: `pnpm exec vitest run packages/server/test/script-isolation.test.ts packages/sandbox/test/sandbox.test.ts packages/engine/test/script-context.test.ts`. The finite emergency test deliberately raises gas limits, runs a large bounded loop, verifies external termination, and checks that the other player still acts. A separate compile-stage payload verifies that upload validation is also supervised. Real-process smoke: `PORT=<free-port> HOST=127.0.0.1 REPLAY_DIR=<temporary-directory> PREP_MS=0 pnpm run server`, then create a room, authenticate both `/state` calls, call `/run` and `/scripts/king/test`, and shut down. Use `pnpm run server`: `pnpm server` collides with pnpm's own command.
