# Medieval brutalist buildings

For one-shot destruction of Castle, Turret, walls and gates, see
[collapse/README.md](collapse/README.md).

## Castle damage

Castle damage uses exactly 2 approved images: mild (`25`) and intermediate
(`50` visual destruction). The severe ruin was rejected.

- Fire ignites at 50% remaining HP.
- The intermediate material appears at 25% remaining HP.
- Masonry is fixed. Flames are independent HF loops.
- `castle/damage-stages/fire-pixels.json` maps 4/5 fire sites from source pixel
  bounds to sprite-local coordinates. Collapse frames also map moving fires.
- Native particles use the simulation clock and a 3-tone white/gray fire ramp
  through the game's ordered-dither shader.
- Orange source fires export as grayscale heat, to keep the game monochrome.
- Healing, fog and replay seeking clear overlays. Pause freezes flames, sparks
  and the fall.

## Castle falls

Castle falls break the upper masonry first, then tip walls inward. An imagegen
last-frame reference gives Age of Empires inspired low ruins: short broken
perimeter walls and loose courtyard masonry inside the foundation. No
whole-building scaling or outward-spreading slabs. The healthy Castle has a
matching generated fall too.

HF settings: `larry`, 544 × 544, 2 seconds. Falls use 10 steps and seed 93.
Fire loops use 6 steps and seed 42. First and last frames guide every clip.
Requests and reviewed source references are kept.

The collapse plays at the original ground position. The final frame holds for
1.5 seconds, then fades in place over 3 seconds with the linear alpha curve of
dead units. No runtime descent or ground clipping. Pause, speed and seek affect
fall and fade together.

```sh
node packages/web/scripts/castle-damage.mjs --prepare
uv run --with gradio_client==2.7.1 python assets/animations/generate-castle-damage.py
node packages/web/scripts/castle-damage.mjs
node packages/web/scripts/check-castle-damage.mjs --record
```

Reruns keep the prepared references. The in-game review video is
`castle/damage-stages/review/in-game-fire-and-inward-collapse.mp4`.

## Source art

The built-in `image_gen` tool made the Castle and Tower source art, with the
previous `public/sprites/castle.png` and `tower.png` as edit references. Source
PNGs keep transparency in `castle/source.png` and `turret/source.png`.

### Source prompts

Castle:

> Use case: style-transfer. Edit target: the castle sprite in the reference. Create a replacement game sprite, a MEDIEVAL BRUTALIST CASTLE. Same elevated isometric camera looking at front and right side, grayscale sculptural game art ready for tinting and ordered dithering. Compact massive fortress of rough monolithic stone/concrete, bold stepped rectangular volumes, thick buttresses, deep narrow arrow slits, imposing recessed medieval gate, flat crenellated battlements instead of pitched roofs, simple powerful readable silhouette. One tall mast on highest keep with a broad plain light gray cloth banner extending to the RIGHT in wind, completely above roof silhouette, visible gap below cloth so it can animate. No symbols. Neutral grayscale shading, dark shadows with clear midtones and bright upper left light. Single isolated building, whole base and flag visible, transparent background, centered with generous margin, no floor or cast shadow, no labels, no other objects. Retain medieval character, not modern apartment building. Source reference is low-resolution: produce clean detailed 3D-render-style source art, no baked dithering.

Tower:

> Use case: style-transfer. Edit target: tower sprite. Replace with a medieval brutalist defensive TOWER matching a fortress of massive gray stone. Single tall square monolithic keep with thick sloping buttress base, deep narrow arrow slits, flat crenellated battlements and machicolations, no cone roof. Bold architectural masses, rough concrete-like stone blocks, austere and unmistakably medieval. Elevated isometric front/right view matching reference. One mast on top and a plain light-gray rectangular fabric flag flowing RIGHT in wind entirely above the parapet, with space below cloth for movement. Grayscale 3D game sprite shading, strong upper-left light and readable shadows/midtones, no baked pixelation or dithering (applied by game). Isolated whole tower including complete foot and flag, centered generous transparent margin, transparent background, no ground shadow, no other buildings or objects, no labels. Compact width vs height, readable at 60 px game height.

## Flag loops

Same MiniMax H3 Turbo LoRA pipeline as the characters: `larry`, 544 × 544,
2 seconds, 4 steps, seed 42, identical first/last reference. The private worker
timed out loading metadata; the public Space completed both clips. Each folder
keeps the request, magenta reference, generated video and contact sheet. No
token is stored here.

```sh
uv run --with gradio_client==2.7.1 python assets/animations/generate-buildings.py
node packages/web/scripts/building-animations.mjs
```

The exporter takes only cloth pixels above the roof from the video. Masonry and
mast stay the fixed reference, so generator camera/building drift cannot leak
into the game. It removes magenta, exports 28 frames at 12 fps and keeps a common
ground anchor for sprite/depth/x-ray passes.

Runtime uses simulation time, including pause and replay speed. Both building
kinds have 1 isometric view, with no directional mirroring.

Published assets: `packages/web/public/sprites/{castle,turret}/` plus static
fallbacks `castle.png` and `tower.png`. Landing portraits use the same atlas with
all 4 player ramps. The Worker also uses its directional idle atlas.

Building asset tests check transparent borders, moving cloth and unchanged
masonry. Browser QA checks the landing and a real replay.
`node packages/web/scripts/check-landing-audio.mjs` needs local web/server
processes.
