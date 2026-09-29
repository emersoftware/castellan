# Animation status — 2026-09-28 (Chile)

## Integrated and reviewed

| Character | Actions in all eight directions |
| --- | --- |
| Ranger | idle, walking, shooting, death |
| Knight | idle, walking, melee attack, death |
| King | idle, walking, melee attack, death |
| Worker | walking, mining, melee attack, death |

Five generated views (S, SE, E, NE, N) plus mirrored NW/W/SW cover each action.
All actions above are published under `packages/web/public/sprites/`.
The Worker keeps its existing static idle. No requested action remains pending.

New matches use `v9-worker-scripts`: Workers mine by default; their scripts may
choose resources, unload, fight, flee or hold. The King has attack 3, range 1 and
a 3-second cooldown. His default script only retaliates against a recent attacker
already in reach. Explicit orders override scripts; `stop` resumes the script.
The local server on :4400 was gracefully restarted with no active matches, and
its live `/rules` response confirms v9 and both scriptable kinds.

Walking frames follow interpolated distance: one tile per Ranger source loop,
two per Knight/King/Worker loop. Movement cadence, upgrades, diagonals, pause and replay
speed therefore affect translation and gait together. Ranger releases immediately
at the authoritative shot event and faces the target; its release markers remain
`[14,18,19,18,16]`. Knight contact markers remain `[6,9,6,8,11]`; Worker uses `[9,9,9,17,17]`
and King `[8,8,8,9,16]`. Mining faces the actual deposit and respects pause.

Deaths retain the last facing, play once and hold the fallen pose. Reviewed
leading hesitation is trimmed using each action's `export-settings.json`.
The fall and corpse fade follow replay speed and pause, continue after the final
snapshot, and disappear when seeking to another point in the replay. Death cells
have extra transparent space below the standing ground anchor, preserving scale.

Ranger/Knight/King/Worker sprites and portraits share shadow/midtone/highlight
targets. Each complete atlas is measured once, preventing per-frame brightness
pumping. Source art and alpha silhouettes remain unchanged.

## Verification

- Full project suite: 254 tests passed across 38 files.
- 82 unit-animation tests cover all directional deaths, contact markers, target
  facing, mining, pause, distance-driven walking and replay seeking.
- `pnpm typecheck` and production build passed. Vite retains its existing large
  bundle warning; jsdom reports its known unimplemented canvas method in tests.
- Independent published-asset audit: 16 atlases, 2,240 nonempty cells, eight
  direction mappings per action, matching dimensions, transparent cell borders,
  unchanged death ground anchors and held final death frames.
- Reviewed source contact sheets for all new views and the exported atlases.
  Checked the actual local renderer with both team colors using deterministic
  replay fixtures, including Worker mining, walking, combat and death.
- Three previously recorded v8 fixtures still verify without a hash mismatch;
  v9 reaction/projectile replay determinism is tested too.
- Rejected turning, diving, kneeling-only and background-drift takes are preserved
  under `attempt-*` directories with review notes where applicable; none is published.
- New `rejected-*` takes retain the mining-rock, attack-effect and cropping
  failures. Source-boundary checks pass for every new Worker/King export.
  King N uses padded input and compensating export scale to preserve its size.

## Generation and recovery

See [diagnostics/README.md](diagnostics/README.md) for the raw HTTP evidence.
The provider returned intermittent 500/502s on metadata, uploads, queues and
streams. The pinned recovery client retries individual safe stages and reconnects
streams to the same session; saved results prevent regenerating for download errors.

The private ZeroGPU worker `emersoftware/aoa-minimax-animation-worker` completed
the remaining clips. It uses `gradio==6.28.0`, `gradio-client==2.7.1` and platform
`spaces==0.51.3`; no paid GPU hardware was requested. Public Space generation is
still supported by omitting `--space`. No credentials are stored in this folder.

```sh
uv run --with gradio_client==2.7.1 python assets/animations/generate-units.py king --action death --space emersoftware/aoa-minimax-animation-worker
node assets/animations/package-units.mjs king walk
node assets/animations/package-units.mjs ranger death
node assets/animations/package-units.mjs knight death
node assets/animations/package-units.mjs king death
# Review before publishing regenerated takes:
node packages/web/scripts/ranger-animations.mjs
node packages/web/scripts/unit-animations.mjs --available
node assets/animations/diagnostics/validate-atlases.mjs
pnpm test && pnpm typecheck && pnpm build
```
