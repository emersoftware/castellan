"""Resumable MOSS-SoundEffect generation. Run with uv run --with gradio_client python FILE [SOUND ...].

Each candidate lands in raw/<sound>/<seed>.wav with its request.json; existing files are skipped,
so a run cut short by the ZeroGPU quota can simply be repeated.
"""
import json
from pathlib import Path
import shutil
import sys
from gradio_client import Client
from huggingface_hub import get_token

HERE = Path(__file__).resolve().parent
SPACE = 'OpenMOSS-Team/MOSS-SoundEffect-v2.0'
DRY = 'Close, dry, no music, no reverb, no voices, no whispering.'
SEEDS = [1, 2, 3, 4]

# sound: (prompt, seconds, seeds)
SOUNDS = {
    # One-shots in a soft, warm, close-mic ASMR style: rounded, never harsh.
    # Blades, strings and swishes come out shrill unless asked to be low and dark.
    # Any blade-on-blade prompt rings above 3 kHz; a blow on a wooden shield stays low and round.
    'sword': (f'A sword blow landing on a wooden shield, one soft deep thump with a short low wooden knock, muffled, warm and creamy, no metal ring. {DRY}', 1.5, SEEDS + [5, 6]),
    'hit': (f'Soft ASMR thud of an arrow sinking into a padded wooden target, muffled and warm. {DRY}', 1.5, SEEDS + [5, 6, 7, 8]),
    # Arrows are just their flight: no bowstring.
    'whoosh': (f'A very short, soft, quick swish of a light arrow through the air, airy and gentle, low intensity. {DRY}', 1, SEEDS + [5, 6]),
    'pick': (f'Soft ASMR tap of a pick into a rock, a gentle muffled stone crack and tiny pebbles crumbling, no metallic ring. {DRY}', 1.5, SEEDS),
    # Single steps come out as hiss; a slow walk gives clean steps that process.py slices apart.
    'footstep': ('Slow footsteps of a man walking on a grass meadow in leather boots, one step per second. Close, quiet background, no music, no voices.', 8, SEEDS[:2]),
    # No voices: a fall is a soft body thud on grass.
    'death': (f'A body softly falling onto grass, one short muffled thud with a light rustle of cloth, gentle, low intensity. {DRY}', 1.5, SEEDS + [5, 6]),
    'collapse': ('A wooden and stone building collapsing, timbers cracking and rubble falling. No music.', 4, SEEDS[:2]),
    'build': (f'Soft ASMR wooden mallet tapping on wood three times, muffled and warm. {DRY}', 2, SEEDS[:3]),
    # A rustle is noise; a single warm tuned note reads as "someone is ready" and fits the harmony.
    'spawn': (f'A single soft warm note on a wooden hang drum, gentle and round, close-mic ASMR. {DRY}', 2, SEEDS),
    'horn': ('A deep medieval war horn blowing one long low note outdoors.', 4, SEEDS[:2]),
    'fanfare': ('A short medieval brass trumpet fanfare announcing victory.', 5, SEEDS[:2]),
    'chat': (f'Soft ASMR page of old paper turning, a gentle warm rustle. {DRY}', 1, SEEDS[:3]),
    'ambient': ('Gentle wind blowing across open grassland with distant birds chirping, calm outdoor ambience. No music, no voices.', 30, SEEDS[:2]),
}


def main():
    token = get_token()
    if not token:
        raise SystemExit('Authenticate with hf auth login first.')
    selected = sys.argv[1:] or list(SOUNDS)
    client = Client(SPACE, token=token, verbose=False, download_files=str(HERE / 'downloads'))
    for name in selected:
        prompt, seconds, seeds = SOUNDS[name]
        directory = HERE / 'raw' / name
        directory.mkdir(parents=True, exist_ok=True)
        (directory / 'request.json').write_text(json.dumps(dict(
            space=SPACE, prompt=prompt, seconds=seconds, steps=50, cfg_scale=4.0,
            sigma_shift=5.0, seeds=seeds), indent=2) + '\n')
        for seed in seeds:
            target = directory / f'{seed}.wav'
            if target.exists():
                continue
            print(f'{name}/{seed}: generating', flush=True)
            audio, status = client.predict(prompt, seconds, 50, 4.0, 5.0, seed, api_name='/run_inference')
            shutil.copy(audio, target)
            print(f'{name}/{seed}: {status}', flush=True)


if __name__ == '__main__':
    main()
