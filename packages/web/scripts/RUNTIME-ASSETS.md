# Runtime assets

`pnpm --filter @castellan/web assets:runtime` builds `public/game-assets/` from the
source art in `assets/sprites/` and the 2 active tracks in `assets/music/`.
It never overwrites source art, music or composition archives; `public/` holds
only what the site serves.

The renderer stores art at 3x and caps normal camera zoom at 3x, with 1 dither
pixel per CSS pixel. So the build keeps dimensions, atlas cells, anchors and scale.
Lossless WebP cuts transfer size without losing visible pixels.
Compare any lower resolution visually at max zoom before adopting it.
Music uses 64 kbps MP3 at 32 kHz and keeps the padded loop and original timing.

The repo tracks the generated copies and their content signature. Dev/build checks
the signature and regenerates only when inputs change (needs Sharp and FFmpeg).

The social image uses a real frame of `81483a0b`, captured through `/record`,
plus the game title. Published replay metadata adds the real models, map and
duration, never the outcome.
