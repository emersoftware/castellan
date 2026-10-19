# Runtime assets

`pnpm --filter @castellan/web assets:runtime` produces `public/game-assets/` from the
original `public/sprites/` and the two active tracks in `public/music/`.
Original art, music and composition archives are never overwritten.

The renderer stores art at 3x and caps normal camera zoom at 3x, with one dither
pixel per CSS pixel. Distribution therefore preserves dimensions, atlas cells,
anchors and scale; lossless WebP reduces transfer without discarding visible
pixels. Lower resolution needs a max-zoom visual comparison before adoption.
Music uses 64 kbps MP3 at 32 kHz and retains the padded loop and original timing.

Generated copies and their content signature are checked in. Dev/build verifies
the signature and regenerates only when inputs change (Sharp and FFmpeg required
for regeneration). Cloudflare excludes originals from the upload; local source
previews can still use them.

The social image uses an actual frame of `81483a0b`, captured through `/record`,
and the game title. Published replay metadata
adds the actual models, map and duration without revealing the outcome.
