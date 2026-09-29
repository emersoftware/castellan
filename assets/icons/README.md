# King head icon

Generated with the built-in image generation tool on 2026-09-29, using
`assets/raw/king_sheet.png` as the character reference.

Prompt:

> Create one square game icon: close-up of only this King's crowned head, centered and fully inside the frame. Preserve the same ornate medieval crown, black hood, gold edging and completely dark faceless opening. Slight three-quarter view like the second sprite. No shoulders, torso, scepter, text or border. Same detailed 3D sprite style, strong readable silhouette, neutral grayscale shading for later game dithering. Transparent background, generous 12% clear margin. Do not apply dithering yet.

- Source: `../raw/king-head-icon.png` (generated alpha preserved).
- Icon: `king-head-dithered.png`, 256 x 256 with transparent background.
- Preview: `king-head-preview.png`, enlarged 3x with nearest-neighbor sampling on black.

Regenerate with `node --import tsx assets/icons/render-king-icon.mts`.
The script imports the game's actual contrast normalization, Bayer 4x4
three-tone dithering, and team A palette, with the portrait renderer's 1.1 lift.
This is a candidate asset; it is not installed as the site's favicon.

## Fire variant

`../raw/king-head-fire.png` is an undithered edit made with the built-in image
generation tool, using `../raw/king-head-icon.png` as the edit target.

Prompt:

> Edit this King head icon: add flickering tongues of fire and drifting glowing ember sparks rising from behind the crown and along the hood edges. Keep the exact crown, hood, faceless dark opening, three-quarter angle and detailed 3D style. Warm orange-gold flames, a few bright sparks, subtle reflected firelight; keep the head clearly readable. Fit the whole icon and effects inside the square frame with breathing room. Transparent background. No dithering, pixelation, text, border, body or new facial features.

## Corrected fire variant: inside the hood

`../raw/king-head-inner-fire.png` was edited with the built-in image generation
tool from the original `../raw/king-head-icon.png`, without dithering.

Prompt:

> Edit this exact image. Add a small cluster of orange flames and glowing ember sparks emerging ONLY from deep INSIDE the dark FACE OPENING of the hood, flowing forward OUT THROUGH that opening toward the right of the image. The dark hollow contains the fire source; a few sparks drift just beyond its rim. Keep most of the cavity dark. Crown, hood exterior, silhouette, framing and grayscale materials remain unchanged. Absolutely no fire on, above, around or behind the crown, no burning fabric, no surrounding halo. No face or eyes. Transparent background. No dithering.

## Stronger inner fire

`../raw/king-head-inner-fire-v2.png`: built-in ImageGen edit of
`../raw/king-head-inner-fire.png`, without dithering.

Prompt:

> Intensify this exact image's fire: a much fuller, brighter mass of orange-gold flames inside the hood, with several longer flame tongues and many more glowing sparks pouring outward through the FACE OPENING toward the right. All fire originates ONLY inside the hood opening. Keep the crown and exterior fabric intact, unchanged and unburning; no flames behind or above the crown, no surrounding fire halo. Preserve the same head, pose, detailed materials, transparent background and square composition; keep the flames inside the frame. No face, eyes, text or dithering.
