# Castellan · DevDay Concepción 2026

The public slide deck at <https://rts.emersoftware.cl/devday/>. This directory
keeps the deck, its runtime assets and the commands needed to open, build and
check it. Speaker notes, presenter mode and research documents are not included.

## Open locally

On macOS, double-click `iniciar.command`. Alternatively, run `python3 servir.py`
from this directory (`--no-open` serves without opening a browser). Stop with
Ctrl+C. The server supports HTTP Range requests for video and audio seeking.

Open through this server, not `file://`: the deck loads clips, atlases and audio
with `fetch`. Fonts, images, audio, video and recorded clips are local assets;
the presentation makes no model calls.

## Controls

- Right arrow, Space or Page Down: next step. Left arrow or Page Up: previous step.
- Home / End: first / last scene. A number followed by Enter jumps to that scene.
- `F`: fullscreen; `O`: overview; `?`: help; `M`: mute; `R`: repeat the current step.
- `B` or `.`: black screen; `W` or `,`: white screen; `V`: backup match video.

A URL hash selects a scene and step, such as `#diplomacy/2`. Sound starts after a
user gesture. Hidden scenes stop their media; reduced-motion preferences are
respected (`?motion=reduce` forces this mode).

## Source and assets

`index.html` owns slide content and step boundaries. `slides.css` owns styling,
`slides.js` owns navigation and media controls, and `scenes.js` owns animations.
`assets/` contains the images, fonts, sounds, videos, data and recorded board clips
used by the published deck. Keep those resources when cleaning supporting files.

`game.ts` uses the game's Pixi renderer and clip decoder. To rebuild its browser
bundle, run `node talks/devday-concepcion-2026/build-game.mjs` from the repository
root after generating the web runtime assets. The committed `game.js` works
without rebuilding the source recordings.

## Build and validate

From the repository root, `pnpm build:cloudflare` builds the site and copies the
runtime files into `packages/web/dist/devday/`. `tools/publish.mjs` only prepares
that local output; it does not deploy. Website deployment is a separate action.

`pnpm exec vitest run packages/web/test/Devday.test.ts` checks navigation across
all scene steps without presenter data. `tools/check.mjs` contains the standalone
visual/media check for an explicitly authorized browser automation environment.
