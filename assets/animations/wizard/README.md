# Wizard animation generation

MiniMax H3 Turbo LoRA, using the same pipeline as Knight, King, Worker and
Ranger. Source design: [`assets/wizard`](../../wizard/README.md), a faceless
pointed hood flowing into one plain robe. No beard, hair or separate hat brim.

## Casting replacement pass — 2026-10-24 (partial; provider stopped)

**Heal is final in all five source views.** The previous hack atlas was restored
and now has measured per-frame crystal positions with no burst pulses. A new
hack and a complete convert action remain pending. No more provider requests or
downloads were made after the HTTP 403 below; retrying needs user direction.

| Action | Result | Atlas and metadata | Crystal tracks and marked review |
| --- | --- | --- | --- |
| Heal | New final, five views/eight display directions | [atlas](heal-directions/export/wizard-heal.png), [manifest](heal-directions/export/manifest.json) | [cast-points.json](heal-directions/export/cast-points.json), [contact sheet](heal-directions/export/cast-points-contact-sheet.png) |
| Hack | Previous published image retained; new tracking only | [atlas](hack-directions/export/wizard-hack.png), [manifest](hack-directions/export/manifest.json) | [cast-points.json](hack-directions/export/cast-points.json), [contact sheet](hack-directions/export/cast-points-contact-sheet.png) |
| Convert | Reviewed SE pilot only; NE candidate exported but not final | [partial SE manifest](convert-directions/export-se/manifest.json) | [partial SE points](convert-directions/export-se/cast-points.json), [partial SE sheet](convert-directions/export-se/cast-points-contact-sheet.png) |

Heal source sheets, eight directional GIFs, the exported frame sequence and the
[four-palette dither review](heal-directions/review-contact-sheet.png) were
reviewed. The [dithered video](heal-directions/wizard-dithered.mp4) and
[GIF](heal-directions/wizard-dithered.gif) use the renderer's contrast and Bayer
filters. All 140 cells are nonempty with transparent borders, exact matching
first/last frames and constant foot/hem bottoms within each view. The format
remains 28 frames, 12 fps, 112 px cells, stored scale 3, ground at 101.5.

### Pulses and crystal measurement

Heal burst frames, zero-based in S/SE/E/NE/N order, are **13, 16, 0, 13, 14**.
S uses the forward push plateau; SE uses the furthest forward staff extension;
NE uses the raised/forward crest; N uses the forward tilt crest. E starts in its
most extended pose, so frame 0 pulses once at the loop boundary, with no duplicate
at frame 27. Each choice and first-frame measurement seed is recorded in
[casting-review.json](heal-directions/casting-review.json).

Hack has `pulses: [[], [], [], [], []]`: its retained gesture has no reviewed burst
and the renderer can maintain a steady stream. Its image is unchanged, SHA-256
`0ec0bcda1f036ab883ca000b8930d462a2cde7db0bea459bcaf7e2650001cef0`.
All 140 marked positions were inspected. The bright SE crescents in frames 7–9
and 14–22 do not move the track off the crystal: SE x ranges 38.41–39.41, y ranges
31.57–31.84 and the largest adjacent-frame step is 0.28 stored px. The tracker
measures this legacy image without rewriting its nonidentical loop endpoints.

`cast-points.mjs` measures compact bright opaque components near the preceding
crystal position. Two-pixel connectivity joins separated highlights;
brightness-weighted centroids use stored cell pixels. Component size, distance
and ambiguity checks reject unrelated bright debris; every resulting red cross
is reviewed. The SE convert pilot pulses at frame 12, the visually confirmed
highest point of its overhead staff lift. No burst frames are invented for
unaccepted views.

### Generation record and retained takes

[casting-inventory-20261024.json](casting-inventory-20261024.json) lists every
request, exact prompt/settings/reference policy, video hash, path and disposition.
It excludes the previous release recordings from this pass's counts.

| Action | Downloaded new videos | Other submissions | Final source views |
| --- | ---: | --- | --- |
| Heal | 13 | — | 5 accepted, 8 rejected |
| Hack | 9 | 1 content-filter failure | 0 accepted; 9 rejected |
| Convert | 11 | 1 content-filter failure; 1 completed result with download 403 | SE pilot reviewed; NE pending; 9 rejected |
| Total | 33 | 3 | 36 provider submissions |

The two filter failures said `This prompt was flagged by a content filter and wasn't run.`
Their requests and exact error records remain in `rejected-content-filter-*`.
The final result for convert E is retained in
`convert-directions/e/{request,result}.json`, without a downloaded source video.
Convert N's latest raised-pose request is prepared but was not submitted.

Previous heal/hack recordings, exports and earlier rejections remain in each
`rejected-staff-steady-20261024/`. New rejected takes live in the other
`rejected-*` folders beside the current action. Reasons include weak staff motion,
torso rotation, changed/disappearing staff, glow/arcs, missing pointed hood and
source/output clipping. Rejected/partial preview directories such as `export-s`
remain as review evidence and must not be published. There were no source
recording deletions. The combined video, timeline and original `validation.json`
below describe the previous release, not this replacement pass.

References initially shrink the accepted 544 px source to 435 px and pad back to
544 px. Per-view `referenceScale: 435 / 544` restores the original output scale.
Some retries use clean mid-cast source frames as matching first/last references,
following the walking bootstrap approach; their request records identify the
source video, SHA-256 and exact frame. Transparent source padding is discarded
before composition, while a fixed per-clip translation, both boundary guards and
the ground anchor remain intact. Only the new casting exports repeat frame 0 at
frame 27; retained legacy hack pixels were not changed.

### Provider stop and verification

The existing local Hugging Face login was checked with `hf auth whoami`
(`emersoftware`). All jobs used the same public MiniMax H3 Turbo LoRA Space,
`larry`, seed 42, upsampling off and matching endpoint references, with the actual
4/6/8-step setting recorded per request. No hardware or Space was created.

One metadata lookup failed before submission because `huggingface.co` did not
resolve: `httpx.ConnectError: [Errno 8] nodename nor servname provided, or not known`.
The same Space's direct URL still resolved and subsequent jobs completed there.
The pass stopped after convert E completed but its download returned
`httpx.HTTPStatusError: Client error '403 Forbidden'`. The exact URL and saved
result path are in [provider-stop-20261024.json](provider-stop-20261024.json).
No ZeroGPU quota error was observed; the cause of the 403 was not established.
The existing downloader made four download attempts before surfacing that error;
Wizard casting now stops immediately on 401/403. A local fixture verifies that
behavior and preserves Knight's previous retry behavior without provider calls.

`pnpm check:unused`, `pnpm lint` and `git diff --check` passed. A disposable before/
after comparison kept Knight idle's PNGs, GIFs, manifest and HTML byte-identical.
[casting-validation-20261024.json](casting-validation-20261024.json) independently
checks 280 heal/legacy-hack cells and measured centres, borders, ground, foot
stability, new heal loop endpoints and byte identity with the local published
sprites. Frontend integrated the final heal and legacy-hack tracks and reported
716 tests in 117 files, typecheck and web build passing. The art agent did not
edit web/runtime code or sprites, or commit, push or deploy anything. Full
in-game particle timing was not visually verified by this art pass.

To measure an already reviewed export locally:

```sh
node assets/animations/wizard/cast-points.mjs heal
node assets/animations/wizard/cast-points.mjs hack
```

The new convert generator/package/preview support is ready, but its full action
is unfinished. Do not regenerate or download more provider results until the user
chooses to resume after the 403. Do not repackage the restored legacy hack from
replacement sources; those rejected source takes are archived.

## Previous release assets — 2026-10-23

- **Generated, exported and reviewed:** idle, walk, heal, hack and death in all
  eight directions (five generated views and three mirrors per action).
- [Combined 23-second video](wizard-animations.mp4), with the actual engine's
  contrast normalization and Bayer dithering. Columns S, SE, E, NE, N, NW, W,
  SW; rows blue, orange, turquoise and violet. `preview-timeline.json` records
  each action's frame interval. `review-contact-sheet.png` was captured from
  the final video, not a separate mockup.
- Each `*-directions/export/wizard-*.png` is a 28-frame, 12 fps grayscale atlas.
  Standing cells are 112 x 112; death cells are 112 x 119. Stored scale is 3 and
  the original standing ground coordinate remains 101.5 pixels in every action.
- Each action keeps a `wizard-dithered.mp4`, GIF and `review.json`. Together they
  validate 4,480 displayed frames across the four player ramps. Dithering runs
  after downsampling to normal game scale, as the real screen-space filter does.
- `validation.json` independently checks all 700 atlas cells, transparent
  borders, eight direction mappings, source video metadata and hashes, ground
  anchors and held death endpoints. All checks pass.
- Selected sources: 25 videos, 544 x 544, 56 frames at 24 fps, 2.333333 seconds.
  Every request keeps its actual prompt, source, steps, seed 42, LoRA `larry`,
  upsampling off and first/last reference policy. Loops normally use 4 steps;
  reviewed corrections and deaths use 6. Death has no final-frame constraint.
- Original recordings retained: 37 clips = 25 selected finals, 5 walking
  bootstraps and 7 rejected takes. No rejected clip appears in the final atlas.
- Registered in the game: `node packages/web/scripts/unit-animations.mjs --kind=wizard`
  copies these five atlases unchanged to `assets/sprites/wizard/`. The viewer plays
  heal and hack loops only while the authoritative view reports `casting`, facing the
  target; convert reuses the hack gesture with a ringed target. Death plays once and holds.

## Game scale

Measured on the published idle atlases (alpha ≥ 128, frame 0, ground at 101.5 stored
pixels, divided by the stored scale 3), the Wizard's top reached 27.8 screen pixels
against 24.2 (Archer), 24.8–25.2 (Knight) and 25.2–25.5 (King), while its shoulders
(first row at least 8 pixels wide) matched theirs at about 20. The difference was its
pointed hood and long robe, larger than the others' shared scale. The atlases stay
byte-identical; `unit-animations.mjs` publishes `sizeFactor: 0.92` on every clip, which
the renderer and portraits apply about the ground point. That brings the top to about
25.6, just over the King's crown, and the shoulders near the Archer's. The Worker stays
smaller by design. The `wizard_0..4` stills keep the shared scale; the renderer replaces
them with clip frames before the first draw.

Overhead marks use each clip direction's highest visible pixel rather than the
transparent cell. While casting, motes leave the staff crystal: `unit-animations.mjs`
publishes its reviewed centre per direction (`staffTips` on heal and hack), measured as
the centroid of the crystal's bright pixels, which stays put through both loops. The before/after captures and lineups of this pass are kept outside
the repository in `~/.local/share/castellan/reports/wizard-ui-refinement-20261024/`.

The first anonymous request to the public Space completed. The following batch
stopped at the explicit ZeroGPU quota error requiring Hugging Face authentication.
The machine initially had no local login and the private worker returned 401.
After the user authenticated, the public Space completed the batch and the
private worker was confirmed accessible in SLEEPING state. The original SE idle
was reused. No new hardware or paid GPU deployment was requested.

## Reviewed corrections

- Idle NE turned toward the camera. The replacement keeps its original facing.
- Walking S/NE/N inherited turning from their bootstraps. Their replacement
  references use the already accepted mid-step still poses in
  `assets/wizard/source/walk.png`, not a frame from a turning clip. E and SE keep
  their reviewed continuous takes. The replacement requests record this source.
- Hack NE/N turned the torso to show the face opening. Smaller forearm gestures
  preserve their original back views in the replacement clips.
- Death N touched the source edge. Its reference was reduced to 85% and the
  exporter applies the compensating `referenceScale.n`; the boundary guard stays
  enabled. All deaths trim four reviewed leading frames and end at source frame
  24, then hold the last fallen image through the rest of the 28-frame atlas.
- Each rejected source remains beside its replacement in a `rejected-*` folder.
  One benign correction request also received an upstream content-filter error;
  its request was retained and a plain game-character description completed.
- Generated loose particles in some ability sources are filtered by the existing
  connected-character mask. Target tethers, channel/recharge timers and HYPNO
  labels are renderer marks drawn from the authoritative view.

Validation also passed 669 repository tests, typecheck and the five recovery-client
tests. A disposable comparison against HEAD's Knight idle export kept all eight
PNG/metadata/HTML outputs byte-identical; single-direction pilot exports were
checked separately. The previews' direction order was checked independently of
the manifest's object insertion order.

## Continue

Authenticate locally (never put a token in this repository), then run:

```sh
uv run --with gradio_client==2.7.1 hf auth login
node --import tsx assets/animations/wizard/prepare.mts
uv run --with gradio_client==2.7.1 python assets/animations/generate-units.py wizard
```

The default Space is `MiniMaxAI/MiniMax-H3-Turbo-Lora`. The previous private worker
can be selected with `--space emersoftware/aoa-minimax-animation-worker` once the
local login can access it. Do not create new hardware or replace the workflow.
Generation skips completed clips and reuses saved results after download errors.
`--anonymous` is explicitly limited to the public Space; authenticated generation
was needed after its anonymous quota was exhausted.

For local preparation only, select an action and add `--prepare-only`; walking
also needs `--stage bootstrap` until its first passes exist. That mode makes no
MiniMax request. The reference preparer refuses to overwrite existing inputs.

The initial preparer crops the full-resolution accepted idle turnaround using its saved
source boxes, preserves alpha, fits each character inside 400 x 480 pixels and
centres it on a 544 x 544 magenta canvas. Idle, healing, hacking and death use
that standing input. Healing/hacking are gestures with no generated particles;
confirmed channels and target effects are drawn by the viewer from authoritative state.
Walking initially follows the existing bootstrap → frame 12 → continuous loop
process. The three recorded mid-step reference corrections above replace turning
conditioning inputs; reruns keep these references and their exact requests.
Death uses only the initial reference and 6 steps so it can end lying down.

To reproduce the completed exports and their dithered previews:

```sh
node assets/animations/package-units.mjs wizard idle
node --import tsx assets/animations/wizard/preview.mts idle
```

Repeat for `walk`, `heal`, `hack` and `death`. The exporter retains its source
boundary check, fixed alignment, 28-frame format and held corpse endpoint.
Review each generated contact sheet and animation before accepting an export.
For a single completed pilot use `--direction=se` on both commands; its separate
`export-se/` cannot overwrite the complete atlas or claim missing directions.

## Recovered history

Pacifico: `f87c8714-521f-4938-bf72-710826dfc69e`, 2026-10-21,
messages 126–132,
`/Users/emersoftware/.claude/projects/-Users-emersoftware-Documents-projects-aoa/f87c8714-521f-4938-bf72-710826dfc69e.jsonl`.
The recovered exchange used MiniMax H3 Turbo with identical first/last images,
then hit anonymous quota and required a local Hugging Face login to continue or
access the same private worker. This run verified that situation again rather
than assuming the old authentication state was current.
