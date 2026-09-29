# King head: outward fire

Reference: `assets/raw/king-head-inner-fire-v2.png`, resized to 384 x 384 and placed
at (16, 128) on a black 544 x 544 canvas, leaving room above and to the right.
The animation uses the existing MiniMax H3 Turbo LoRA pipeline through
our private ZeroGPU copy, `emersoftware/aoa-minimax-animation-worker`.

Prompt:

> Only fire and sparks blast from inside the hood, bottom-left to top-right. Strong continuous flow, all particles stay inside frame. Head, crown, hood and camera perfectly still.

Two seconds, six steps, seed 42, Larry LoRA, identical first and last reference
images. Exact parameters are in `request.json`.

Generate or resume without duplicating an already downloaded clip:

```sh
uv run --with gradio_client==2.7.1 --with pillow python assets/animations/generate-king-fire.py
```

The original undithered PNG stays unchanged. The MP4 uses a black background.

`generated.mp4` is the original model output. `king-fire.mp4` and `preview.webp`
composite only warm fire over the original static crown and hood. Regenerate:

```sh
uv run --with pillow --with numpy python assets/animations/finalize-king-fire.py
```

The first attempt extended past the right edge; it is kept locally in the ignored
`attempt-cropped/` directory. The current reference provides additional space.
Stray particles fade smoothly within 64 pixels of the boundary, with a clear
16-pixel outer margin, so they disappear before reaching the frame edge.

## Two-palette dithering

`king-fire-dithered.gif` is the looping preview; `king-fire-dithered.mp4` is the
video export, and `king-fire-dithered.png` is a still. These preserve the animation
and apply the game's Bayer 4x4 dithering separately to each layer at 256 x 256,
then enlarge to 768 x 768 with nearest-neighbor sampling.

- Fire: team A blue, `#000000`, `#2d63c8`, `#b4dcff`.
- King: team B red/orange, `#000000`, `#d24a1c`, `#ffcaa0`.
- Character contrast is normalized once on the static material layer.
- The lossless frames contain exactly those five distinct colors.

```sh
uv run --with pillow --with numpy python assets/animations/finalize-king-fire.py --layers
node --import tsx assets/icons/render-king-fire.mts
```

Intermediate layers and frames remain in ignored `layers-frames/` and
`dither-frames/` directories. The game renderer and its palettes are unchanged.

### Trimmed loop

The current exports are `king-fire-dithered-loop.gif` and
`king-fire-dithered-loop.mp4`: source frames 10 through 54 inclusive (45 frames,
1.875 seconds at 24 fps). The user selected removal of frames 0 through 9 and
frame 55. No reversed frames, freeze, or crossfade is used.
The earlier full-length exports remain available for comparison.

### Smoothed loop

`king-fire-dithered-smooth.gif` and `.mp4` overlap eight frames (0.333 s)
from the ends of the selected 10..54 range. A smoothstep crossfade runs on the
undithered fire layer, then the game dithering is applied. Both sequences run
forward, and the static King is composited unchanged. The result is 37 frames
(1.542 s at 24 fps), still using exactly five colors.

```sh
node --import tsx assets/icons/render-king-fire.mts --smooth
```

Compared on the isolated blue effect at 64 x 64 with a one-pixel Gaussian blur,
the endpoint mean squared difference fell from 771.41 to 43.27; the new loop's
median consecutive-frame difference is 40.67. This measures the seam's shape
change, not a guarantee that every viewer will perceive it as seamless.

## Landing decision

The user chose the actual match alone above the title, so this animation is not
loaded by the app. The artwork and previews remain here. The experimental
`assets/icons/export-hero-king.mts` can reproduce an undithered channel-keyed
atlas for future use; it is not part of the web build.
