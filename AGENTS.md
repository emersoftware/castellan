# Working on Castellan

## Session history

Use Pacifico (MCP or CLI) to recover earlier agent conversations. Start with
`search_sessions`, then use `read_session` on relevant candidates in bounded
ranges. Treat history as evidence; verify the current checkout and processes.

## Sources and package boundaries

Read [README.md](README.md), [TESTING.md](TESTING.md), and the affected component's
documentation before changing its contract. Prefer the existing implementation
and documented behavior over conventions imported from another project.

- `packages/shared` owns rules, wire types, the player guide and text views.
  Change game numbers in the ruleset, not in a connector or the renderer.
- `packages/engine` owns deterministic simulation and replay verification.
  Keep model/provider calls and wall-clock scheduling outside the simulation.
- `packages/sandbox` owns QuickJS script execution and deterministic budgets.
  `packages/server` owns live worker supervision, rooms, authorization and storage.
- `packages/web` presents recorded or observed state. Do not infer a successful
  action, installed script or running VM merely from a submitted command.
- `connectors` are clients of the same game API. Reuse the shared turn, seat and
  metadata helpers; do not duplicate game rules or give one harness extra state.

Follow the surrounding TypeScript/ESM style and existing package exports. Keep
changes focused; add an abstraction when it has a concrete caller or boundary.
Use English for code, tests and repository documentation, matching nearby files.

## Fairness, isolation and lifecycle

Read [connectors/README.md](connectors/README.md) for the shared turn contract and
[the sandbox contract](docs/components/sandbox.md) before changing execution.

- Preserve the common starting prompt and observation flow. Explicit experimental
  directives must be recorded; do not silently tune one model's strategy.
- Start each match with a fresh private harness session and empty workspace.
  Resume that session between decisions; do not load personal/project context or
  cross-match memory. Series history follows [SERIES.md](SERIES.md).
- Keep player credentials, spectator capabilities and private observations separate.
  Do not poll player `/state` to monitor a harness: it consumes observations.
  Use supervisor `/status` for readiness and termination checks.
- Keep credentials and native run directories outside the repository. Do not put
  keys or live access tokens in logs, replay fixtures, commits or reports. Use
  private file permissions and inspect fixtures before adding them.
- Document the actual tool allowlist and residual harness tools. Configuration
  isolation is not an OS sandbox; report the distinction accurately.
- Dispose matches/workers and close child processes, clients and servers at their
  lifecycle boundary, including failures. Retaining a replay must not retain VMs.
- Do not silently reset script memory, remove watchdogs or relax limits to make a
  match pass. Operational failures must remain explicit in recordings and UI.

## Experiments and replays

- Tests use local fixtures, never paid models. Run paid matches only within the
  user's requested scope; repeated failures call for local diagnosis before more
  spending. A paid match is an experiment, not a regression test.
- Record model, effort, harness version, prompt/configuration, ruleset, seed,
  sides and replay ID. Check actual metadata rather than display names.
- Deduplicate recordings by replay ID; report conflicting copies and the scope
  searched. Compute reported counts and timings from the data.
- Separate model decisions, harness failures and game-server failures. An observed
  timeout does not establish its root cause or the model's strategic strength.
- Preserve original recordings and exclusion reasons. Viewer recovery may show
  recorded interruptions, but must not turn an interrupted game into a valid
  balance comparison. Keep strict replay verification and hash checks intact.

## Validation and delivery

Follow [TESTING.md](TESTING.md): test the observable contract at its owning
boundary, demonstrate regressions for bug fixes, and clean up real resources.
Avoid tests that merely repeat the implementation or duplicate existing coverage.

Before committing code, run `pnpm test` and `pnpm typecheck`; for application
changes also run the relevant build (`pnpm build` for the web client). Do not edit
source/tests while a runner is using this checkout. Keep the default worker limit
unless the task specifically needs different concurrency. Report skips and failures.

Check the final diff, untracked files and `git diff --check`. Preserve unrelated
work and stage explicit paths. Use focused commits describing the resulting
behavior. Commit/push when authorized; deploying the site or publishing replays is
a separate action. Verify the remote head after pushing.

Report what changed, what was actually verified, and remaining limitations.
Distinguish local tests, committed code, a pushed branch and a deployed service.
