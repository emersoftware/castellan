# Replay videos

Remotion compositions reuse the game's HUD, colors and recorded battlefield.
`Promo` is a vertical reel; `Highlights` selects moments from one replay.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter video typecheck
pnpm --filter video dev
```

## Local media

Recorded clips, timelines, sound mixes and final renders stay outside Git.
The compositions require those inputs before previewing or rendering.

For `Promo`, keep the original replays in `replays/<id>.json.gz`, load them in the
local server, and run `pnpm server` and `pnpm web`. Then:

```sh
bash packages/video/scripts/prepare-promo.sh
```

The script recreates the existing five shots sequentially, generates timelines,
mixes their sound effects and copies the accompaniment. It requires Chrome at
the recorder's configured macOS path, FFmpeg and FFprobe. Set `CASTELLAN_VIDEO_SERVER`
to use a web URL other than `http://localhost:5173`.

For `Highlights`, generate `public/<id>.json` with
`packages/sim/src/video-timeline.mts` and record `public/<id>.mp4` at 2× with
`packages/web/scripts/record.mjs`. Pass that replay ID to the composition.

## Export

```sh
pnpm --filter video exec remotion render Promo out/promo.mp4
node packages/video/scripts/dither.mjs packages/video/out/promo.mp4 packages/video/out/promo-dithered.mp4
```

`pnpm --filter video build` checks bundling; it does not render a video.

## Horizontal post video

`PromoHorizontal` uses the approved v7 moments and music in native 1920×1080,
with the current hero's white outlined lettering. It keeps the player's opening
perspective, subtle speed indicator, and game-style unit/map dissolves.
The charge holds for an extra musical bar so the king's fall remains visible;
the landscape version is 47.13 seconds at 30 fps.
Each shot is also available under `Horizontal-scenes` in Studio.

With the same five original replays loaded in the local server and the web
running, prepare the landscape footage and mix the current game sound samples:

```sh
bash packages/video/scripts/prepare-horizontal.sh
pnpm --filter video exec remotion render PromoHorizontal out/horizontal-raw.mp4
node packages/video/scripts/dither.mjs packages/video/out/horizontal-raw.mp4 packages/video/out/horizontal-dithered.mp4
ffmpeg -i packages/video/out/horizontal-dithered.mp4 -c:v copy -af loudnorm=I=-14:TP=-1.5:LRA=11 -ar 48000 -c:a aac -b:a 192k -movflags +faststart videos/castellan-promo-horizontal.mp4
```

`--ending-cues` in the sound mixer adds the current king/end samples at a lower
gain. Existing vertical exports retain their original sound-mix defaults.
