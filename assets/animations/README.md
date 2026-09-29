# Unit animations

For what is currently integrated versus pending, see [STATUS.md](STATUS.md).

The renderer uses five generated views (S, SE, E, NE, N) and mirrors the other
three (NW, W, SW). Each atlas has 28 frames at 12 fps in 112 × 112 cells,
a shared ground anchor `(0.5, 0.90625)` and stored scale 3. Death cells are
112 × 119, adding transparent space below fallen hands/equipment while keeping
the same character scale and the same ground position (101.5 stored pixels).

- Ranger: idle, walk, shoot and death; see `ranger/*-directions/README.md`.
- Knight: idle, walk, melee attack and death.
- King: idle, walk, melee attack and death. It cannot be trained.
- Worker: walk, mining, melee attack and death; static idle.
  See STATUS.md for integration and validation evidence.

## Generate and package units

```sh
uv run --with gradio_client==2.7.1 python assets/animations/generate-units.py
# The private worker applies recovery to its nested conditioning client too:
uv run --with gradio_client==2.7.1 python assets/animations/generate-units.py ranger --action death --space emersoftware/aoa-minimax-animation-worker
node assets/animations/package-units.mjs knight idle
node assets/animations/package-units.mjs knight walk
node assets/animations/package-units.mjs knight attack
node assets/animations/package-units.mjs king idle
node assets/animations/package-units.mjs king walk
node assets/animations/package-units.mjs king attack
node assets/animations/package-units.mjs worker walk
node assets/animations/package-units.mjs worker mine
node assets/animations/package-units.mjs worker attack
node assets/animations/package-units.mjs worker death
# Review each *-directions/index.html before publishing:
node packages/web/scripts/unit-animations.mjs
```

Generation uses the existing local Hugging Face login and MiniMax H3 Turbo LoRA
with `larry`, 544 × 544, 2 requested seconds, seed 42 and upsampling off.
Most loops use 4 steps; deaths use 6 and reviewed attack retries use 6–8.
Each request.json records its exact settings.
Prompts are short; loop references use identical first and last images. Death
uses six steps and only an initial image, allowing the character to fall. Walking first
uses a standing reference, then regenerates from frame 12 mid-step to avoid a
pause between cycles. Completed clips are skipped on rerun. Each directory keeps
its exact request, input reference and original video. No credentials are stored.

The exporter removes magenta, retains the connected character/equipment,
translates the entire clip by one fixed offset, and produces color GIF previews
and grayscale atlases. It does not stabilize away the character's motion. Death
exports remove reviewed leading hesitation using `export-settings.json`, retain
the original standing ground anchor, and hold the fallen endpoint. Longer source
clips are resampled into the same 28-frame cell layout.

## Runtime

Walking interpolation spans the unit's effective movement cooldown, rounded to
simulation ticks, so repeated snapshots of the same tile do not interrupt the
cycle. Walking frames advance by interpolated map distance: one tile per Ranger
loop and two per Knight/King/Worker loop. Speed upgrades and diagonal travel therefore
change the gait rate alongside movement. Pause, speed changes and seeking use
the same simulation clock.

Characters share shadow/midtone/highlight targets before team tint and dithering.
Normalization measures each complete atlas once, avoiding per-frame flicker;
static character sprites and portraits use the same curve. Alpha is preserved.

Knight, Worker and King attacks follow the target direction, independently of movement.
The authoritative hit starts the animation at its contact marker, followed by
400 ms of recovery. Melee damage is immediate: no windup, delayed collision or
extra hit is introduced by the animation. A lethal hit still uses the target's
death position for facing. Death plays once in the last facing direction and
holds its endpoint through the corpse fade. Missing atlases retain the static
corpse fallback. The fall and fade follow replay speed and pause, and can finish
after the match's final snapshot (including the King's lethal hit).

The current ruleset uses `king`. Legacy `agent` and `nexus` replay data stays
unchanged for hash verification; the viewer presents it as King and Castle.

Worker mining uses public current activity (`gathering: {x,y}`), rather than
private orders. It faces the deposit and runs only while stationary and mining;
walking and combat take priority. v9 enables `self.gather(deposit?)`, `unload()`,
resource selection and damage reactions; old replay rules remain unchanged.

The King attack reference does not use the Knight's extra top offset (which
clipped the King's feet). Its overhead N view has an additional padded reference;
`referenceScale.n` in export-settings.json restores the original character size.
The exporter rejects any connected character touching the source image boundary,
so transparent atlas padding cannot hide an already clipped limb or weapon.

Reviewed contact frames (S, SE, E, NE, N): Worker `[9,9,9,17,17]`, King
`[8,8,8,9,16]`. Rejected rocks, glow effects, weapon changes, empty-hand strikes
and clipped takes stay under `rejected-*` folders and are not published.
