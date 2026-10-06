# Animation status — 2026-10-01 (Chile)

## Building destruction — 2026-10-06 (Chile)

Structures play their complete 28-frame collapse at the original position.
The last frame holds for 1.5 seconds, then fades in place over three seconds
using the same linear alpha curve as dead units. There is no runtime descent
or ground clipping. Pause/speed and seek preserve position and clean up the layer.
105 focused renderer/animation tests and web typecheck pass. Actual Pixi QA
checks fixed position throughout collapse, hold and fade for four structures
and all four owner colors, including pause and seek cleanup.
The local demo replay `castle-9c036372` has its fall at 1:09.

Castle has exactly two approved damage states, mild and intermediate. Fires
ignite at half HP. Four/five mapped source fire sites drive native sparks, and
both HF flame atlases and particles pass through an explicit white/gray three-tone fire
ordered-dither ramp. Castle's healthy and both damaged falls were regenerated
with upper masonry falling first and walls breaking inward into low architectural
ruins inspired by Age of Empires. The new imagegen endpoint retains short
perimeter walls and loose courtyard masonry; all three videos use both the
original initial image and this new final image.
The old outward/squashed takes and the severe damage image are rejected.

The focused suite passes 119 tests, including damage/HP boundaries, reproducible
particles, pause, matching falls, fixed masonry, fire pixel mapping, inward
footprints and held endpoints. Typecheck and production build pass. Actual Pixi
QA verifies both states in all four owner colors, the shader's three fire tones,
healing/seek cleanup and the final collapse cleanup.
Preview: `buildings/castle/damage-stages/review/in-game-fire-and-inward-collapse.mp4`.

Wall, wall post/corner, closed/open gate, Turret and Castle now have generated
one-shot collapses. Six MiniMax source videos produce nine published grayscale
atlases, including the three wall end trims beside gates. The four owner colors,
barrier axis, original ground position, replay pause/speed and seek cleanup are
preserved. Remains fade in place; legacy Nexus replays use Castle.

See [building collapse sources and previews](buildings/collapse/README.md).
The focused renderer/animation/asset suite passes (128 tests); types and the
production web build pass. Actual Pixi browser QA checks all four building kinds
in all four owner colors, standing-to-collapse scale, fading in place, pause, disappearance
and seeking. `check-building-collapse.mjs --record` also saves a rendered video.

## Integrated and reviewed

| Character | Actions in all eight directions |
| --- | --- |
| Ranger | idle, walking, shooting, death |
| Knight | idle, walking, melee attack, death |
| King | idle, walking, melee attack, death |
| Worker | idle, walking, mining, melee attack, death |

Five generated views (S, SE, E, NE, N) plus mirrored NW/W/SW cover each action.
All actions above are published under `packages/web/public/sprites/`.
Worker idle now uses five generated views, covering all eight directions, in the game and landing. No requested action remains pending.

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

## Worker idle update — 2026-10-01

Generated with the public MiniMax Space using the existing source sheet, four steps,
seed 42 and matching first/last references. Reviewed all five source contact sheets
and exported frames. The atlas contains 140 cells at 12 fps with the same ground
anchor and contrast normalization as the other Worker actions.

- 83 unit-animation tests pass, including walk/pause/seek, melee recovery and
  mining-to-idle transitions.
- The asset audit passes for 17 atlases and 2,380 cells in eight directions.
- Browser QA confirms an animated landing portrait, reduced-motion freeze,
  eight in-game facings with mirrored west views, and pause without errors.
- Production build (including web TypeScript) passes.
- Reproduce the browser check: `node packages/web/scripts/check-worker-idle.mjs`.

## Previous verification — 2026-09-28

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
