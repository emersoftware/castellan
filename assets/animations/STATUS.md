# Animation status — 2026-10-01 (Chile)

## Building destruction — 2026-10-06 (Chile)

Structures play the full 28-frame collapse at the original position.
The last frame holds 1.5 seconds, then fades in place over 3 seconds with the same linear alpha curve as dead units. There is no runtime descent
or ground clipping. Pause/speed and seek keep the position and clean up the layer.
105 focused renderer/animation tests and the web typecheck pass. Actual Pixi QA
checks fixed position through collapse, hold and fade for 4 structures and
all 4 owner colors, including pause and seek cleanup.
The local demo replay `castle-9c036372` has its fall at 1:09.

Castle has exactly 2 approved damage states: mild and intermediate. Fires
ignite at half HP; 4–5 mapped source fire sites drive native sparks. Both HF
flame atlases and particles pass through an explicit white/gray 3-tone fire
ordered-dither ramp. Castle's healthy and both damaged falls were regenerated:
upper masonry falls first and walls break inward into low architectural
ruins, inspired by Age of Empires. The new imagegen endpoint keeps short
perimeter walls and loose courtyard masonry. All 3 videos use the original
initial image and this new final image.
The old outward/squashed takes and the severe damage image are rejected.

The focused suite passes 119 tests, covering damage/HP boundaries, reproducible
particles, pause, matching falls, fixed masonry, fire pixel mapping, inward
footprints and held endpoints. Typecheck and production build pass. Actual Pixi
QA checks both states in all 4 owner colors, the shader's 3 fire tones,
healing/seek cleanup and the final collapse cleanup.
Preview: `buildings/castle/damage-stages/review/in-game-fire-and-inward-collapse.mp4`.

Wall, wall post/corner, closed/open gate, Turret and Castle now have generated
one-shot collapses. 6 MiniMax source videos produce 9 published grayscale
atlases, including the 3 wall end trims beside gates. They keep the
4 owner colors, barrier axis, original ground position, replay pause/speed and
seek cleanup. Remains fade in place. Legacy Nexus replays use Castle.

See [building collapse sources and previews](buildings/collapse/README.md).
The focused renderer/animation/asset suite passes (128 tests). Types and
production web build pass. Actual Pixi browser QA checks all 4 building kinds
in all 4 owner colors: standing-to-collapse scale, fading in place, pause,
disappearance and seeking. `check-building-collapse.mjs --record` also saves a rendered video.

## Integrated and reviewed

| Character | Actions in all eight directions |
| --- | --- |
| Ranger | idle, walking, shooting, death |
| Knight | idle, walking, melee attack, death |
| King | idle, walking, melee attack, death |
| Worker | idle, walking, mining, melee attack, death |

Each action uses 5 generated views (S, SE, E, NE, N) plus mirrored NW/W/SW.
All actions above are published under `packages/web/public/sprites/`.
Worker idle now uses 5 generated views, covering all 8 directions in game and landing. No requested action is pending.

New matches use `v9-worker-scripts`. Workers mine by default. Their scripts can
choose resources, unload, fight, flee or hold. The King has attack 3, range 1 and
a 3-second cooldown. His default script only strikes back at a recent attacker
already in reach. Explicit orders override scripts; `stop` resumes the script.
The local server on :4400 was gracefully restarted with no active matches; its
live `/rules` response confirms v9 and both scriptable kinds.

Walking frames follow interpolated distance: 1 tile per Ranger source loop and
2 per Knight/King/Worker loop. Movement cadence, upgrades, diagonals, pause and
replay speed therefore change translation and gait together. Ranger releases at once
at the authoritative shot event, facing the target; its release markers stay
`[14,18,19,18,16]`. Knight contact markers stay `[6,9,6,8,11]`; Worker uses `[9,9,9,17,17]`
and King `[8,8,8,9,16]`. Mining faces the actual deposit and respects pause.

Deaths keep the last facing, play once and hold the fallen pose. Each action's
`export-settings.json` trims reviewed leading hesitation.
The fall and corpse fade follow replay speed and pause. They continue after the
final snapshot and disappear when seeking elsewhere in the replay. Death
cells have extra transparent space below the standing ground anchor, so scale stays the same.

Ranger/Knight/King/Worker sprites and portraits share shadow/midtone/highlight
targets. Each full atlas is measured once, so brightness does not pump per frame. Source art and alpha silhouettes stay unchanged.

## Worker idle update — 2026-10-01

Generated with the public MiniMax Space from the existing source sheet:
4 steps, seed 42 and matching first/last references. All 5 source
contact sheets and the exported frames were reviewed. The atlas has 140 cells at 12 fps, with the same ground anchor and contrast normalization as the other Worker actions.

- 83 unit-animation tests pass, including walk/pause/seek, melee recovery and
  mining-to-idle transitions.
- The asset audit passes for 17 atlases and 2,380 cells in 8 directions.
- Browser QA confirms an animated landing portrait, reduced-motion freeze,
  8 in-game facings with mirrored west views, and pause without errors.
- Production build (including web TypeScript) passes.
- Repeat the browser check: `node packages/web/scripts/check-worker-idle.mjs`.

## Previous verification — 2026-09-28

- Full project suite: 254 tests passed across 38 files.
- 82 unit-animation tests cover all directional deaths, contact markers, target
  facing, mining, pause, distance-driven walking and replay seeking.
- `pnpm typecheck` and production build passed. Vite keeps its existing large
  bundle warning. jsdom reports its known unimplemented canvas method in tests.
- Independent published-asset audit: 16 atlases, 2,240 nonempty cells, 8
  direction mappings per action, matching dimensions, transparent cell borders,
  unchanged death ground anchors and held final death frames.
- Reviewed source contact sheets for all new views and the exported atlases.
  Checked the actual local renderer with both team colors on deterministic
  replay fixtures, including Worker mining, walking, combat and death.
- 3 previously recorded v8 fixtures still verify with no hash mismatch.
  Tests also cover v9 reaction/projectile replay determinism.
- Rejected turning, diving, kneeling-only and background-drift takes stay
  in `attempt-*` directories, with review notes where applicable; none is published.
- New `rejected-*` takes keep the mining-rock, attack-effect and cropping
  failures. Source-boundary checks pass for every new Worker/King export.
  King N uses padded input and a compensating export scale to keep its size.

## Generation and recovery

[diagnostics/README.md](diagnostics/README.md) has the raw HTTP evidence.
The provider returned intermittent 500/502s on metadata, uploads, queues and
streams. The pinned recovery client retries single safe stages and reconnects
streams to the same session. Saved results avoid regenerating for download errors.

The private ZeroGPU worker `emersoftware/aoa-minimax-animation-worker` finished
the remaining clips. It uses `gradio==6.28.0`, `gradio-client==2.7.1` and platform `spaces==0.51.3`.
No paid GPU hardware was requested. Omit `--space` to use the public Space.
No credentials are stored in this folder.

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
