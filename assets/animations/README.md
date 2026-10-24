# Unit animations

[STATUS.md](STATUS.md) lists what is integrated and what is pending.

The renderer uses 5 generated views (S, SE, E, NE, N) and mirrors the
other 3 (NW, W, SW). Each atlas has 28 frames at 12 fps in 112 × 112 cells.
All share the ground anchor `(0.5, 0.90625)` and stored scale 3.
Death cells are 112 × 119: extra transparent space below fallen hands and
equipment. Character scale and ground position (101.5 stored pixels) stay the same.

- Ranger: idle, walk, shoot and death; see `ranger/*-directions/README.md`.
- Knight: idle, walk, melee attack and death.
- King: idle, walk, melee attack and death. Players cannot train it.
- Worker: idle, walk, mining, melee attack and death.
  STATUS.md has the integration and validation evidence.
- Wizard: idle, walk, heal, hack and death, registered unchanged through
  `unit-animations.mjs --kind=wizard`. See [Wizard previews](wizard/README.md).

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
node assets/animations/package-units.mjs worker idle
node assets/animations/package-units.mjs worker walk
node assets/animations/package-units.mjs worker mine
node assets/animations/package-units.mjs worker attack
node assets/animations/package-units.mjs worker death
# Review each *-directions/index.html before publishing:
node packages/web/scripts/unit-animations.mjs
```

Generation uses the local Hugging Face login and MiniMax H3 Turbo LoRA with
`larry`, 544 × 544, 2 requested seconds, seed 42, upsampling off.
Most loops use 4 steps. Deaths use 6, and reviewed attack retries use 6–8.
Each request.json records the exact settings.

Prompts are short. Loop references use the same first and last image. Death
uses 6 steps and only a first image, so the character can fall. Walking starts
from a standing reference, then regenerates from mid-step frame 12 to avoid a
pause between cycles. Reruns skip completed clips. Each directory
keeps its exact request, input reference and original video. No credentials are stored.

The exporter removes magenta and keeps the connected character and equipment.
It moves the whole clip by 1 fixed offset. It produces color GIF previews and
grayscale atlases.

It keeps the character's motion. For deaths, it trims reviewed leading
hesitation using `export-settings.json`. It keeps the
original standing ground anchor and holds the fallen last frame. It resamples
longer source clips into the same 28-frame cell layout.

## Runtime

Walking interpolation spans the unit's effective movement cooldown, rounded to
simulation ticks, so repeated snapshots of one tile do not break the cycle. Walking frames advance by interpolated map distance: 1 tile per Ranger
loop and 2 per Knight/King/Worker loop. Speed upgrades and diagonal travel
therefore change gait rate with movement. Pause, speed changes and seeking use
the same simulation clock.

All characters share shadow, midtone and highlight targets before team tint and dithering.
Normalization measures each full atlas once, so frames do not flicker.
Static character sprites and portraits use the same curve. Alpha is preserved.

Knight, Worker and King attacks face the target, independently of movement.
The authoritative hit starts the animation at its contact marker, then 400 ms
of recovery. Melee damage is immediate: the animation adds no windup,
delayed collision or extra hit. A lethal hit still uses the target's death
position for facing. Death plays once in the last facing direction. It holds
its last frame through the corpse fade. A missing atlas keeps the static corpse
fallback. The fall and fade follow replay speed and pause. They can finish
after the match's final snapshot (including the King's lethal hit).

The current ruleset uses `king`. Legacy `agent` and `nexus` replay data stays
unchanged for hash verification. The viewer shows it as King and Castle.

Worker mining reads public current activity (`gathering: {x,y}`), not private
orders. The Worker faces the deposit and mines only while
stationary; walking and combat come first. v9 enables `self.gather(deposit?)`,
`unload()`, resource selection and damage reactions. Old replay rules stay unchanged.

The King attack reference skips the Knight's extra top offset, which clipped the
King's feet. Its overhead N view has an extra padded reference.
`referenceScale.n` in export-settings.json restores the original character size.
The exporter rejects any connected character that touches the source image edge.
So transparent atlas padding cannot hide a limb or weapon that is already clipped.

Reviewed contact frames (S, SE, E, NE, N): Worker `[9,9,9,17,17]`, King
`[8,8,8,9,16]`. Rejected rocks, glow effects, weapon changes, empty-hand strikes
and clipped takes stay in `rejected-*` folders, unpublished.
