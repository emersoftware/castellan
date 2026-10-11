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
the recorder's configured macOS path, FFmpeg and FFprobe. Set `AOA_VIDEO_SERVER`
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
