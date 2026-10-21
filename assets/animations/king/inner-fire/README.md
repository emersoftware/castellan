# King head: outward fire

The app does not load this animation (see [Landing decision](#landing-decision)).

It uses the existing MiniMax H3 Turbo LoRA pipeline on our private ZeroGPU copy,
`emersoftware/aoa-minimax-animation-worker`. Reference: `assets/raw/king-head-inner-fire-v2.png`,
resized to 384 x 384 at (16, 128) on a black 544 x 544 canvas, with room above and right.

Prompt:

> Only fire and sparks blast from inside the hood, bottom-left to top-right. Strong continuous flow, all particles stay inside frame. Head, crown, hood and camera perfectly still.

Settings: 2 seconds, 6 steps, seed 42, Larry LoRA. The first and last reference images
are identical. `request.json` holds the exact parameters.

Generate, or resume without downloading a clip twice:

```sh
uv run --with gradio_client==2.7.1 --with pillow python assets/animations/generate-king-fire.py
```

The original undithered PNG stays unchanged. The MP4 uses a black background.

`generated.mp4` is the original model output. `king-fire.mp4` and `preview.webp` place
only the warm fire over the static crown and hood. Regenerate:

```sh
uv run --with pillow --with numpy python assets/animations/finalize-king-fire.py
```

The first attempt went past the right edge. It stays locally in the ignored
`attempt-cropped/` directory. The current reference gives more space. Stray particles
fade within 64 pixels of the boundary and a 16-pixel outer margin stays clear, so they
vanish before the frame edge.

## Two-palette dithering

`king-fire-dithered.gif` is the looping preview, `king-fire-dithered.mp4` the video
and `king-fire-dithered.png` a still. They apply the game's Bayer 4x4 dithering to each
layer separately at 256 x 256, then enlarge to 768 x 768 with nearest-neighbor sampling.

- Fire: team A blue, `#000000`, `#2d63c8`, `#b4dcff`.
- King: team B red/orange, `#000000`, `#d24a1c`, `#ffcaa0`.
- The script normalizes character contrast once, on the static material layer.
- The lossless frames contain exactly those 5 distinct colors.

```sh
uv run --with pillow --with numpy python assets/animations/finalize-king-fire.py --layers
node --import tsx assets/icons/render-king-fire.mts
```

Intermediate layers and frames stay in the ignored `layers-frames/` and
`dither-frames/` directories. The game renderer and its palettes are unchanged.

### Trimmed loop

The current exports are `king-fire-dithered-loop.gif` and `king-fire-dithered-loop.mp4`.
They use source frames 10 through 54 inclusive: 45 frames, 1.875 seconds at 24 fps. The
user chose to remove frames 0 through 9 and frame 55. The loop uses no reversed frames,
freeze or crossfade. The earlier full-length exports stay available for comparison.

### Smoothed loop

`king-fire-dithered-smooth.gif` and `.mp4` overlap 8 frames (0.333 s) from the ends of
the selected 10..54 range. A smoothstep crossfade runs on the undithered fire layer.
Then the game dithering applies. Both sequences run forward. The static King stays
unchanged on top. The result has 37 frames (1.542 s at 24 fps) and still uses
exactly 5 colors.

```sh
node --import tsx assets/icons/render-king-fire.mts --smooth
```

On the isolated blue effect at 64 x 64 with a 1-pixel Gaussian blur, the endpoint mean
squared difference fell from 771.41 to 43.27. The new loop's median consecutive-frame
difference is 40.67. This measures the seam's shape change. It does not guarantee every
viewer sees it as seamless.

## Landing decision

The user chose the actual match alone above the title, so the app skips this animation. The artwork and previews stay here. The experimental
`assets/icons/export-hero-king.mts` can reproduce an undithered channel-keyed atlas for
future use. It is not part of the web build.
