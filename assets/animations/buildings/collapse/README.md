# Building collapses

The outward Castle collapse below is superseded. Published healthy, mild and
intermediate Castle falls now break up inward, top to bottom, ending on a compact
final reference. See [the Castle damage pipeline](../README.md),
[new healthy source](../castle/damage-stages/death-healthy/generated.mp4) and
[current in-game preview](../castle/damage-stages/review/in-game-fire-and-inward-collapse.mp4).
The legacy exporter keeps that replacement.

Same pipeline, recovered through Pacifico: character animations in session
`01a0e3c0-ad11-70f1-b044-7c70cfc22f33`, Castle/Tower flags in
`01a0f5e1-841e-7f60-baff-b04700a82ae7` (2026-10-01).

MiniMax H3 Turbo LoRA on the public Hugging Face Space, `larry`,
544 × 544, 2 requested seconds, 6 steps, seed 42, upsampling off. Only the first
reference is given, so the building can fall and hold its rubble pose.

Each directory keeps the actual source sprite, magenta reference, ground mapping,
request parameters and original video. Authentication uses the local Hugging Face
login; credentials are never written here.

| Structure | Original video | Transparent source preview |
| --- | --- | --- |
| Wall | [video](wall/generated.mp4) | [sprite](wall/collapse-sprite.gif) |
| Wall post/corner | [video](wallpost/generated.mp4) | [sprite](wallpost/collapse-sprite.gif) |
| Closed gate | [video](door/generated.mp4) | [sprite](door/collapse-sprite.gif) |
| Open gate | [video](door-open/generated.mp4) | [sprite](door-open/collapse-sprite.gif) |
| Turret | [video](turret/generated.mp4) | [sprite](turret/collapse-sprite.gif) |
| Castle (superseded take) | [video](castle/generated.mp4) | [sprite](castle/collapse-sprite.gif) |

## Reproduce

```sh
node packages/web/scripts/building-collapse.mjs --prepare
uv run --with gradio_client==2.7.1 python assets/animations/generate-building-collapse.py
# Review the generated contact sheets before exporting.
node packages/web/scripts/building-collapse.mjs
pnpm exec vitest run packages/web/test/BuildingCollapse.test.ts packages/web/test/BuildingCollapseAssets.test.ts packages/web/test/BuildingAnimation.test.ts
CASTELLAN_WEB_URL=http://127.0.0.1:5174 node packages/web/scripts/check-building-collapse.mjs
# Save the renderer preview as MP4 and GIF too:
CASTELLAN_WEB_URL=http://127.0.0.1:5174 node packages/web/scripts/check-building-collapse.mjs --record
```

For 1 source, pass `--kind turret` to the preparation/export script and the
positional `turret` argument to the generator. Completed videos and saved remote
results are reused; downloads never regenerate a clip. Before changing a reference
or prompt, archive the entire old take under `rejected-*`.

## Export

The exporter keys magenta into alpha and keeps all rubble, including disconnected
stones. 1 source-to-game scale and ground anchor apply to every frame, with no
per-frame recentering or resizing.

- `export-settings.json` trims the reviewed hesitation at the start.
- The first sprite frame keeps the standing reference. The final 2 frames are
  identical.
- The Turret ends at the settled pile at 1.6 source seconds, before a later
  stone flies out of camera.
- Export fails if foreground touches a selected source-frame boundary. Rejected
  turret takes keep the failed edge/bottom debris cases; the accepted reference
  leaves more room for scattered stones.

Published atlases have 28 grayscale frames at 12 fps in a 7 × 4 grid, stored at
scale 3. Each texture stays under 4096 pixels in both dimensions. Collapses use
only a color texture and allocate no unused depth/x-ray masks. Castle and Turret
keep their existing idle metadata. Wall segments beside doors use the wall video
with the same end trims as the standing art. Separate post and open/closed gate
videos keep their actual silhouettes.

## Playback

The renderer remembers the barrier's last shape and mirrored axis before removal.
Destruction plays once at the authoritative death event, in the owner's color,
with the usual dithering.

Castle falls use 2 guides:

- First frame: the original castle.
- Last frame: the new imagegen `../castle/damage-stages/rubble-aoe-v2-reference.png`.
  It shows low architectural ruins with broken wall bases and loose courtyard masonry.

The previous mound-like endpoint is archived as rejected.

The generated fall plays unchanged at the original position. Its last frame holds
for 1.5 seconds. Then it fades in place over 3 seconds, with the linear alpha curve of
dead units. Masonry, flames and
sparks share 1 container. No runtime descent or ground clipping.

- Pause, replay speed and timeline seeking use the existing presentation clock.
- A seek destroys old remains.
- Vanishing into fog without a death event creates no collapse.
- Legacy `nexus` replays use the Castle atlas.
- Missing or unsupported animations keep the existing static fallback.

Reviewed renderer output: [in-game MP4](review/in-game-collapse.mp4),
[in-game GIF](review/in-game-collapse.gif), [standing](review/standing.png),
[mid-collapse](review/collapse.png), [held last frame](review/rubble.png),
[fade start](review/fade-start.png), [fading in place](review/fading.png) and
[disappeared](review/disappeared.png).

Browser QA checks fixed position and no mask during the whole collapse, hold and
fade. It covers all 4 owner colors and all 4 structure types.
