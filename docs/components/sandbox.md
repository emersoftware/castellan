# @castellan/sandbox
Runs bot scripts with `quickjs-emscripten` (QuickJS in WASM). Chosen over isolated-vm for isolation (WASM + interpreter), determinism and browser support. isolated-vm is in maintenance mode.

- 1 QuickJS runtime per player: `setMemoryLimit(8MB)`, `setMaxStackSize`.
- Script upload: ≤4 KB. The server strips TS types (esbuild `transform`) and compiles the script once.
- Per tick and unit, the sandbox builds `self` (data + functions returning plain objects) and runs the script. `setInterruptHandler` counts cycles against 2 budgets: the ruleset's `gasPerUnit`, and `gasPerPlayer` for the whole tick. Out of gas → `hold()` + error event. A failed upload keeps the previously installed script.
- `Date`, `WeakRef` and `FinalizationRegistry` are removed and `Math.random` is seeded (determinism). `eval` stays: it only runs more code inside the same metered VM. `self.random()` is the seeded PRNG. `self.memory` is JSON, ≤1 KB per unit.
- The first action call counts; none → `hold()`. The engine re-validates every action.
- Per tick, the world loads into the VM once (one JSON string), then one call runs per unit. After the trusted prelude bootstraps, every VM call is metered, including world loading and result/error serialization. Loading uses the player budget; unit execution also uses the unit budget. Intrinsics, their prototypes and global bindings are recursively frozen, so one script cannot replace the loader's `Array.prototype.map`, `Object.keys`, JSON functions or math helpers on later ticks.
- The deterministic budget counts interpreter interrupts, not milliseconds. QuickJS interruption is cooperative; see its [runtime interrupt contract](https://github.com/justjake/quickjs-emscripten/blob/main/doc/quickjs-emscripten/classes/QuickJSRuntime.md#setinterrupthandler). Live Node rooms also give each player a worker with an external 250 ms emergency deadline per VM request, enforced by the parent through `Atomics.wait` and worker termination. Worker startup has its own 10-second limit. After a timeout the VM stays terminated: actions hold and produce an explicit script error. Memory is never silently reset. Offline simulation and browser replay keep the synchronous adapter.
- Golden: per-unit scripts. Python is out (it widens the attack surface).

## Decision context

`self.attackReadyInTicks`, `moveReadyInTicks`, `aimReadyInTicks` and `gatherReadyInTicks` are measured before the current tick's actions. An attack needs both attack and aim readiness. `self.canMove(direction)` reports current local passability and ignores cooldown. It returns `true`, `false`, or `null` if the occupancy/corner check would need unseen tiles. It is a snapshot: another unit may move there first.

`self.lastActionResult` starts as null, then is `{tick, action, status, effect?, reason?}` for the latest script decision. Status is one of `acted`, `blocked`, `cooldown`, `aiming`, `held`, `invalid` and `arrived`. An attack request may have `effect: "move"` while the unit chases. An `attack` effect means a melee strike or projectile launch, not a guaranteed hit. Manual orders override scripts. While a manual order runs, the result keeps its original tick.

Visible entities include public combat stats and `ruin`. Opponents' cooldowns, orders and scripts stay hidden. Terrain queries and entity stats use the player's existing fog boundary.

## Testing scripts locally

After `await initSandbox()`, `testScript(code, kind, worlds, limits, seed)` runs 1 or more finite `ScriptWorld` scenarios in an isolated VM. Memory persists between frames. It returns compile failures or `{ok:true, frames:[{tick,runs}]}`. Each unit run holds its requested action, error/log and `gasUsed` (interrupt cycles). It does not simulate movement or combat between input worlds.

`Match.testScript(player, kind, code)` uses the player's current observed context and their own units of that kind. It starts with fresh memory and a fresh seeded random stream. It does not advance the match, install the code, change the live script VM or consume an event cursor. Compare its requests with readiness/passability and, once installed, the actual `lastActionResult`. A kind with no living units gives an empty run map, so a clean compile alone does not prove runtime behavior.

## Node supervision

`packages/server/src/script-isolation.ts` provides `createIsolatedScriptHost`, plus asynchronous `runOnceIsolated` and `validateScriptIsolated` for HTTP execution and compile checks. Match configuration injects the host factory, and probes reuse it. The server bundles the worker entry once from trusted repository sources with the server's esbuild. Workers run plain JavaScript without tsx/Vite/main-process loader hooks, which can deadlock when the parent waits synchronously. The WASM itself stays the pinned single-file dependency.

The persistent host transport uses a fixed 1 MiB buffer with validated lengths and atomic request/response states. Oversized requests fail explicitly. Node resource limits cap worker memory/stack, on top of QuickJS's configured heap/stack. Match/host disposal terminates the worker; a startup failure closes any players already allocated for that match. Rooms dispose their match's workers as soon as the game finishes, including when restoring a finished checkpoint; final views, scripts and replay data stay readable. Closing that room again does not dispose twice. One-shot timeouts return no orders.

Trusted adapter errors carry `operationalFailure: true`. User-thrown errors cannot set that flag or exclude a match by copying its message. Watchdog and worker failures go into `experiment.operationalFailures`. `runReplay` refuses those replays before it evaluates scripts, and battle extraction excludes them. A watchdog-triggered result is not deterministic evidence of strategic strength. Tests check that worker and inline runs give identical events and hashes.

Validation: `pnpm exec vitest run packages/server/test/script-isolation.test.ts packages/sandbox/test/sandbox.test.ts packages/engine/test/script-context.test.ts`. The finite emergency test raises gas limits on purpose and runs a large bounded loop. It verifies external termination and that the other player still acts. A separate compile-stage payload checks that upload validation is supervised too.

Real-process smoke: run `PORT=<free-port> HOST=127.0.0.1 REPLAY_DIR=<temporary-directory> PREP_MS=0 pnpm run server`, create a room, authenticate both `/state` calls, call `/run` and `/scripts/king/test`, and shut down.

Use `pnpm run server`: `pnpm server` collides with pnpm's own command.
