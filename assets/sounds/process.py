"""Turn raw MOSS candidates into game samples. Run with uv run --with numpy --with scipy --with soundfile python FILE.

One-shots: trim the silence before the onset, cut to the sound's length, fade the tail and peak-normalize
(sustained ones, see LOUDNESS, are levelled by RMS instead).
Everything is softened on the way out: a low-pass takes the edge off and the attack is rounded, for a warm,
ASMR-like mix rather than sharp clicks. Candidates with too much energy above 3 kHz (shrill) are left out.
Pitched sounds are tuned to D or A (A = 440 Hz), the game's key, so overlapping sounds never clash: the
strongest partial is moved to the nearest D or A by resampling, and re-measured after encoding; a candidate
whose pitch is unstable (still more than 25 cents off after tuning) is left out.
The ambient becomes a seamless loop padded on both sides with its own other end; the manifest records its
exact length, so the game loops inside the padding whatever the MP3 decoder does at the file's ends.
Writes packages/web/public/sounds/*.mp3 + manifest.json, and index.html here to listen to every candidate.
Footsteps are sliced out of a longer walk, three per candidate (footstep-1-2 is seed 1, step 2).
Variants listed in rejected.json ({"sword": ["2"], "footstep": ["1-3"]}) are left out of the game.
"""
import html
import json
from pathlib import Path
import subprocess
import numpy as np
from scipy.signal import resample
import soundfile as sf

HERE = Path(__file__).resolve().parent
OUT = HERE.parents[1] / 'packages/web/public/sounds'
# Longest part kept after the onset, in seconds.
LENGTH = dict(sword=0.8, hit=0.6, whoosh=0.2, pick=0.7, footstep=0.35, death=0.5,
              collapse=3.5, build=1.8, spawn=1.2, horn=4, fanfare=5, chat=0.8)
# Low-pass cutoff (Hz) and attack (s) per sound; blows get the softest treatment.
SOFT = dict(sword=(3000, 0.012), hit=(3500, 0.01), pick=(4500, 0.008), build=(4500, 0.008),
            footstep=(4000, 0.008), whoosh=(3500, 0.02), spawn=(4000, 0.008), chat=(6500, 0.005), death=(3000, 0.02),
            collapse=(5500, 0.02), horn=(5000, 0.04), fanfare=(5000, 0.06), ambient=(8500, 0))
# Pitched sounds and the band their main partial is searched in (Hz). Fanfare is tuned by its key instead.
TUNED = dict(sword=(150, 1500), spawn=(60, 1200), horn=(50, 400))
NOTES = (2, 9)  # pitch classes D and A
# Most energy above 3 kHz that blows may keep (fraction); shriller candidates are left out.
SHRILL = dict(sword=0.12, whoosh=0.15, spawn=0.15, hit=0.2, death=0.15)
# Sustained sounds are levelled by RMS (dBFS) instead of by peak: a horn or fanfare peak-normalized for
# seconds is some 20 dB louder than a blow and plays like a jump scare.
LOUDNESS = dict(horn=-24, fanfare=-24, collapse=-24)
PAD = 0.05
CROSSFADE = 2.0


def level(clip, target_db):
    """Scale `clip` to an RMS of `target_db` dBFS, never past the usual 0.89 peak."""
    rms = np.sqrt(np.mean(clip ** 2))
    gain = min(10 ** (target_db / 20) / max(1e-9, rms), 0.89 / max(1e-6, np.abs(clip).max()))
    return clip * gain


def encode(samples, rate, target, cutoff):
    wav = target.with_suffix('.tmp.wav')
    sf.write(wav, samples, rate)
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', wav, '-af', f'lowpass=f={cutoff}',
                    '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '96k', target], check=True)
    wav.unlink()


def one_shot(samples, rate, seconds, attack=0.005):
    level = np.abs(samples)
    onset = int(np.argmax(level > level.max() * 0.05))
    start = max(0, onset - int(0.005 * rate))
    clip = samples[start:start + int(seconds * rate)].copy()
    fade = min(len(clip) // 3, int(0.08 * rate))
    clip[-fade:] *= np.linspace(1, 0, fade)
    rise = max(1, int(attack * rate))
    clip[:rise] *= np.linspace(0, 1, rise) ** 2
    return clip / max(1e-6, np.abs(clip).max()) * 0.89


def partial(clip, rate, lo, hi):
    """Frequency and prominence of the strongest partial in [lo, hi], past the attack."""
    seg = clip[int(0.03 * rate):int(0.5 * rate)]
    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), 1 << 18))
    freqs = np.fft.rfftfreq(1 << 18, 1 / rate)
    band = (freqs >= lo) & (freqs <= hi)
    i = int(np.argmax(spec[band]))
    return freqs[band][i], spec[band][i] / np.median(spec[band])


def key_root(clip, rate):
    """The loudest pitch class over 100-2000 Hz, as a fractional MIDI pitch class."""
    spec = np.abs(np.fft.rfft(clip, 1 << 20)) ** 2
    freqs = np.fft.rfftfreq(1 << 20, 1 / rate)
    band = (freqs >= 100) & (freqs <= 2000)
    midi = 69 + 12 * np.log2(freqs[band] / 440)
    chroma = np.bincount(np.round(midi).astype(int) % 12, spec[band], 12)
    return int(np.argmax(chroma))


def to_key(midi):
    """Semitones from `midi` to the nearest D or A."""
    return min((t - midi for base in range(0, 132, 12) for t in (base + n for n in NOTES)), key=abs)


def tune(name, clip, rate):
    if name == 'fanfare':
        shift = to_key(key_root(clip, rate))
        shift = shift if abs(shift) <= 3 else 0
    else:
        f, prominence = partial(clip, rate, *TUNED[name])
        if prominence < 20:
            return clip, 'noise'
        shift = to_key(69 + 12 * np.log2(f / 440))
    if abs(shift) < 0.05:
        return clip, f'{shift:+.2f}'
    return resample(clip, int(len(clip) / 2 ** (shift / 12))).astype(np.float32), f'{shift:+.2f}'


def off_key(name, file):
    """Cents from the nearest D or A of the encoded file's main partial (fanfare: of its key)."""
    pcm = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-'],
                         capture_output=True, check=True).stdout
    clip = np.frombuffer(pcm, np.float32)
    if name == 'fanfare':
        return 100 * to_key(key_root(clip, 44100))
    f, _ = partial(clip, 44100, *TUNED[name])
    return 100 * to_key(69 + 12 * np.log2(f / 440))


def shrill(clip, rate):
    spec = np.abs(np.fft.rfft(clip)) ** 2
    freqs = np.fft.rfftfreq(len(clip), 1 / rate)
    return spec[freqs > 3000].sum() / max(1e-12, spec.sum())


def steps(samples, rate, seconds, attack, count=3):
    hop = int(0.01 * rate)
    env = np.sqrt(np.mean(samples[:len(samples) // hop * hop].reshape(-1, hop) ** 2, axis=1))
    gap = int(0.35 / 0.01)
    peaks = [i for i in range(1, len(env) - 1)
             if env[i] > 4 * np.median(env) and env[i] == env[max(0, i - gap):i + gap].max()]
    peaks = sorted(sorted(peaks, key=lambda i: -env[i])[:count])
    return [one_shot(samples[max(0, i * hop - int(0.04 * rate)):], rate, seconds, attack) for i in peaks]


def ambient(samples, rate):
    x = int(CROSSFADE * rate)
    ramp = np.linspace(0, 1, x)
    mixed = samples[-x:] * np.sqrt(1 - ramp) + samples[:x] * np.sqrt(ramp)
    loop = np.concatenate([samples[x:-x], mixed])
    pad = int(PAD * rate)
    padded = np.concatenate([loop[-pad:], loop, loop[:pad]])
    return padded / max(1e-6, np.abs(padded).max()) * 0.7


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rejected = json.loads((HERE / 'rejected.json').read_text()) if (HERE / 'rejected.json').exists() else {}
    manifest, rows, loop_seconds = {}, [], None
    for directory in sorted((HERE / 'raw').iterdir()):
        name = directory.name
        request = json.loads((directory / 'request.json').read_text())
        for raw in sorted(directory.glob('*.wav'), key=lambda p: int(p.stem)):
            samples, rate = sf.read(raw, dtype='float32')
            if samples.ndim > 1:
                samples = samples.mean(axis=1)
            if name == 'ambient':
                clips = {raw.stem: ambient(samples, rate)}
                loop_seconds = loop_seconds or (len(samples) - int(CROSSFADE * rate)) / rate
            elif name == 'footstep':
                clips = {f'{raw.stem}-{k}': c for k, c in enumerate(steps(samples, rate, LENGTH[name], SOFT[name][1]), 1)}
            else:
                clips = {raw.stem: one_shot(samples, rate, LENGTH[name], SOFT[name][1])}
            for variant, clip in clips.items():
                file = f'{name}-{variant}.mp3'
                notes = []
                hf = shrill(clip, rate)
                if name in SHRILL:
                    notes.append(f'agudos {hf:.0%}')
                if name in TUNED or name == 'fanfare':
                    clip, shift = tune(name, clip, rate)
                if name in LOUDNESS:
                    clip = level(clip, LOUDNESS[name])
                encode(clip, rate, OUT / file, SOFT[name][0])
                cents = 0
                if (name in TUNED or name == 'fanfare') and shift != 'noise':
                    cents = off_key(name, OUT / file)
                    notes.append(f'afinado {shift} st, queda a {cents:+.0f} cents de Re/La')
                keep = variant not in rejected.get(name, []) and hf <= SHRILL.get(name, 1) and abs(cents) <= 25
                if keep:
                    manifest.setdefault(name, []).append(file)
                rows.append((name, variant, file, request['prompt'], keep, ', '.join(notes)))
                print(f'{file:18} {"ok " if keep else "out"} {", ".join(notes)}')
    for stale in OUT.glob('*.mp3'):
        if not any(stale.name == row[2] for row in rows):
            stale.unlink()
    (OUT / 'manifest.json').write_text(json.dumps(dict(pad=PAD, loop=loop_seconds, files=manifest), indent=1) + '\n')
    page = ['<!doctype html><meta charset="utf-8"><title>aoa sounds</title>',
            '<style>body{font:14px system-ui;background:#111;color:#ddd;margin:2em}td{padding:4px 10px}'
            '.out{opacity:.4}audio{height:28px}</style><table>']
    for name, seed, file, prompt, keep, notes in rows:
        loop = ' loop' if name == 'ambient' else ''
        page.append(f'<tr class="{"" if keep else "out"}"><td><b>{name}</b> {seed}</td>'
                    f'<td><audio controls{loop} preload="none" src="../../packages/web/public/sounds/{file}"></audio></td>'
                    f'<td>{html.escape(notes)}</td><td>{html.escape(prompt)}</td></tr>')
    page.append('</table>')
    (HERE / 'index.html').write_text('\n'.join(page) + '\n')
    print(f'{len(rows)} candidates, {sum(len(v) for v in manifest.values())} in the game')


if __name__ == '__main__':
    main()
