# Replay videos

Remotion compositions reuse the game's HUD, colors and recorded battlefield.
`Promo` is a vertical reel. `Highlights` picks moments from 1 replay.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter video typecheck
pnpm --filter video dev
```

## Local media

Recorded clips, timelines, sound mixes and final renders stay outside Git.
The compositions need them to preview or render.

To prepare `Promo`:

1. Load the original replays from `replays/<id>.json.gz` in the local server.
2. Run `pnpm server` and `pnpm web`.
3. Run:

```sh
bash packages/video/scripts/prepare-promo.sh
```

The script recreates the existing 5 shots one by one and generates timelines.
It mixes their sound effects and copies the accompaniment. It needs FFmpeg, FFprobe
and Chrome at the recorder's configured macOS path. Set `CASTELLAN_VIDEO_SERVER`
to use a web URL other than `http://localhost:5173`.

To prepare `Highlights`:

1. Generate `public/<id>.json` with `packages/sim/src/video-timeline.mts`.
2. Record `public/<id>.mp4` at 2× with `packages/web/scripts/record.mjs`.
3. Pass that replay ID to the composition.

## Export

```sh
pnpm --filter video exec remotion render Promo out/promo.mp4
node packages/video/scripts/dither.mjs packages/video/out/promo.mp4 packages/video/out/promo-dithered.mp4
```

`pnpm --filter video build` checks bundling; it does not render a video.

## Horizontal post video

`PromoHorizontal` uses the approved v7 moments and music in native 1920×1080.
Lettering is the current hero's white outline. It keeps the player's opening
perspective, the subtle speed indicator and game-style unit/map dissolves.
The charge holds 1 extra musical bar so the king's fall stays visible.
The landscape version runs 47.13 seconds at 30 fps.
Studio also shows each shot under `Horizontal-scenes`.

With the same 5 replays loaded and the web running,
prepare the landscape footage and mix the current game sound samples:

```sh
bash packages/video/scripts/prepare-horizontal.sh
pnpm --filter video exec remotion render PromoHorizontal out/horizontal-raw.mp4
node packages/video/scripts/dither.mjs packages/video/out/horizontal-raw.mp4 packages/video/out/horizontal-dithered.mp4
ffmpeg -i packages/video/out/horizontal-dithered.mp4 -c:v copy -af loudnorm=I=-14:TP=-1.5:LRA=11 -ar 48000 -c:a aac -b:a 192k -movflags +faststart videos/castellan-promo-horizontal.mp4
```

`--ending-cues` makes the sound mixer add the current king/end samples at a lower
gain. Existing vertical exports keep their original sound-mix defaults.
