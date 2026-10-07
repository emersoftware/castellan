"""Original two-lead study: warm electronic groove and medieval modal colour.

Run: uv run --with numpy --with scipy --with soundfile python assets/music/dos_voces.py
Same code-composition/synthesis workflow as compose.py; no borrowed recordings or melodies.
32 bars, 95 BPM, D Dorian throughout. Two upper-register melodic lines, supporting bass,
soft percussion. Review assets only: this does not change the game's music selection.
"""
import json
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

HERE = Path(__file__).resolve().parent
OUT = HERE.parents[1] / 'packages/web/public/music/dos-voces-v1'
RATE, BPM, BARS = 32000, 95, 32
BEAT = 60 / BPM
LOOP = BARS * 4 * BEAT
N = round(LOOP * RATE)
RNG = np.random.default_rng(931)
PCS = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
SCALE = set(PCS.values())
PLAN = ['Dm', 'Dm', 'C', 'G', 'Dm', 'C', 'G', 'Dm'] * 4
ROOTS = {'Dm': 'D2', 'C': 'C2', 'G': 'G2'}
FIFTHS = {'Dm': 'A2', 'C': 'G2', 'G': 'D3'}
SCORE = {'synth': [], 'flute': [], 'bass': [], 'drums': []}


def midi(name):
    return 12 * (int(name[-1]) + 1) + PCS[name[0]]


def hz(note):
    return 440 * 2 ** ((note - 69) / 12)


def add(part, bar, beat, duration, note, gain=1):
    pitch = midi(note)
    assert pitch % 12 in SCALE
    SCORE[part].append(dict(beat=bar * 4 + beat, duration=duration, midi=pitch, gain=gain))


def write_score():
    # Four two-bar cells: related motifs, with actual rests for the other lead.
    cells = [
        ['D5', 'F5', 'E5', 'A4', 'D5', 'A5', 'F5', 'E5'],
        ['E5', 'G5', 'E5', 'D5', 'G5', 'A5', 'B5', 'A5'],
        ['F5', 'A5', 'E5', 'D5', 'E5', 'G5', 'D5', 'C5'],
        ['G5', 'B5', 'A5', 'G5', 'F5', 'E5', 'D5', 'A4'],
    ]
    # Sincopated first half; a shorter answer in the second half of the cell.
    times = [0, .75, 1.5, 2.75, 4, 4.75, 5.5, 6.25]
    durations = [.52, .52, .7, .55, .52, .52, .5, .5]
    for bar in range(0, BARS, 2):
        notes = cells[(bar // 2) % 4]
        for k, (beat, duration, note) in enumerate(zip(times, durations, notes)):
            if 16 <= bar < 20 and k in (1, 3, 5, 7):
                continue
            if bar < 8 and k >= 4:
                continue
            # No endless sixteenth arpeggio: melody and breathing room are the point.
            if bar >= 24:
                note = cells[(bar // 2 + 2) % 4][k]
            add('synth', bar, beat, duration, note, .9 if k in (0, 4) else .76)
    # Flute replies in the space after the synth's short phrases.
    answers = [('A5', 'G5', 'F5', 'D5'), ('B5', 'A5', 'G5', 'E5'),
               ('G5', 'E5', 'D5', 'E5'), ('A5', 'G5', 'E5', 'D5')]
    for bar in range(0, BARS, 2):
        a, b, c, d = answers[(bar // 2) % 4]
        if bar == 0:
            add('flute', bar, 6.8, 1.0, 'A5', .72)
            continue
        if bar < 8 or 16 <= bar < 24:
            add('flute', bar, 3.6, 1.65, a, .92)
            add('flute', bar, 5.5, .5, b, .8)
            add('flute', bar, 6.15, .5, c, .8)
            add('flute', bar, 6.8, 1.0, d, .92)
        else:
            if bar < 24:
                add('flute', bar, 2.0, .5, c, .72)
            add('flute', bar, 3.4, .55, a, .88)
            add('flute', bar, 6.9, 1.05, d, .98)
    # Finale: one simultaneous consonant counterpart to each synth note, no third lead.
    for event in list(SCORE['synth']):
        if event['beat'] < 96:
            continue
        note = event['midi']
        above = [p for p in range(note + 3, note + 10)
                 if p % 12 in SCALE and (p - note) % 12 in (3, 4, 7, 8, 9)]
        pitch = min(above, key=lambda p: abs(p - 81))
        SCORE['flute'].append(dict(beat=event['beat'], duration=event['duration'] * .93,
                                   midi=pitch, gain=.52))
    # Finale flute answers and the short harmony notes never overlap each other.
    for bar, chord in enumerate(PLAN):
        add('bass', bar, 0, 1.28, ROOTS[chord], .75)
        add('bass', bar, 1.75, .55, FIFTHS[chord], .49)
        add('bass', bar, 2.75, .92, ROOTS[chord], .65)
        if bar % 4 == 3:
            add('bass', bar, 3.75, .23, ROOTS[PLAN[(bar + 1) % BARS]], .42)


def envelope(t, duration, attack, release):
    return np.minimum(1, (t / attack) ** 2) * np.exp(-np.maximum(0, t - duration) / release)


def tone(event, kind):
    dur = event['duration'] * BEAT
    release = .065 if kind == 'bass' else .085
    t = np.arange(round((dur + release * 8) * RATE)) / RATE
    f0 = hz(event['midi'])
    # Tiny, exactly periodic movement over the complete loop; never drifts to another key.
    absolute = t + event['beat'] * BEAT
    vibrato = (0.0012 if kind == 'flute' else .00045) * np.sin(2 * np.pi * 5 * t)
    phase = 2 * np.pi * np.cumsum(f0 * (1 + vibrato)) / RATE
    if kind == 'synth':
        signal = np.zeros(len(t))
        width = .44 + .012 * np.sin(2 * np.pi * absolute / LOOP * 2)
        cutoff = 950 + 1400 * np.exp(-t / .11)
        for k in range(1, min(26, int(12000 / f0))):
            amplitude = np.sin(np.pi * k * width) / k
            filt = 1 / np.sqrt(1 + (k * f0 / cutoff) ** 4)
            signal += amplitude * np.sin(k * phase) * filt
        signal *= (.48 + .52 * np.exp(-t / .32))
        attack, gain = .015, .115
    elif kind == 'flute':
        signal = np.sin(phase) + .2 * np.sin(2 * phase) + .075 * np.sin(3 * phase)
        # Quiet filtered breath, with no hiss or recorded vocal samples.
        breath = sosfilt(butter(2, [550, 1800], fs=RATE, btype='bandpass', output='sos'),
                         RNG.standard_normal(len(t)))
        signal += .009 * breath
        attack, gain = .04, .073
    else:
        signal = np.sin(phase) + .28 * np.sin(2 * phase) + .075 * np.sin(3 * phase)
        signal *= (.67 + .33 * np.exp(-t / .12))
        attack, gain = .012, .058
    return signal * envelope(t, dur, attack, release) * event['gain'] * gain


def place_periodic(buf, signal, seconds):
    start = round(seconds * RATE) % N
    first = min(len(signal), N - start)
    buf[start:start + first] += signal[:first]
    if len(signal) > first:
        buf[:len(signal) - first] += signal[first:]


def hit(kind, gain):
    t = np.arange(round(.55 * RATE)) / RATE
    noise = RNG.standard_normal(len(t))
    if kind == 'kick':
        f = 55 + 27 * np.exp(-t / .024)
        x = np.sin(2 * np.pi * np.cumsum(f) / RATE) * np.exp(-t / .115)
        x += .16 * np.sin(2 * np.pi * 110 * t) * np.exp(-t / .085)
    elif kind == 'snare':
        noise = sosfilt(butter(2, [500, 2200], fs=RATE, btype='bandpass', output='sos'), noise)
        x = .65 * noise * np.exp(-t / .055) + .27 * np.sin(2 * np.pi * 220 * t) * np.exp(-t / .042)
    elif kind == 'hand':
        x = (np.sin(2 * np.pi * 146.83238396 * t) + .3 * np.sin(2 * np.pi * 293.66476792 * t)) * np.exp(-t / .07)
    else:
        noise = sosfilt(butter(2, [2500, 4800], fs=RATE, btype='bandpass', output='sos'), noise)
        x = noise * np.exp(-t / .022)
    # All transients start at zero, including noise, so they stay rounded.
    return x * np.minimum(1, (t / .003) ** 2) * gain


def stereo(mono, pan):
    angle = (pan + 1) * np.pi / 4
    return np.stack([mono * np.cos(angle), mono * np.sin(angle)], axis=1)


def circular_filter(signal, cutoff):
    sos = butter(2, cutoff, fs=RATE, output='sos')
    # Prime filter state with the actual preceding loop, rather than zero padding.
    return sosfilt(sos, np.concatenate([signal[-RATE:], signal]), axis=0)[RATE:]


def room(track, amount):
    out = track.copy()
    for i, (delay, level) in enumerate(((.029, .24), (.047, .17), (.079, .11), (.127, .075), (.193, .04))):
        reflection = np.roll(circular_filter(track, 2200), round(delay * RATE), axis=0)
        if i % 2:
            reflection = reflection[:, ::-1]
        out += reflection * amount * level
    return out


def render():
    write_score()
    tracks = {}
    for kind, pan in [('synth', -.18), ('flute', .2), ('bass', 0)]:
        mono = np.zeros(N)
        for event in SCORE[kind]:
            place_periodic(mono, tone(event, kind), event['beat'] * BEAT)
        tracks[kind] = room(stereo(mono, pan), .75 if kind != 'bass' else .08)
    drums = np.zeros(N)
    for bar in range(BARS):
        quiet = .62 if bar < 4 or 16 <= bar < 20 else 1
        for beat, kind, gain in [(0, 'kick', .062), (1.75, 'kick', .025),
                                  (2.5, 'kick', .046), (1, 'snare', .037),
                                  (3, 'snare', .034), (3.5, 'hand', .014)]:
            place_periodic(drums, hit(kind, gain * quiet), (bar * 4 + beat) * BEAT)
            SCORE['drums'].append(dict(beat=bar * 4 + beat, kind=kind))
        for eighth in range(8):
            beat = eighth / 2 + (.07 if eighth % 2 else 0)
            place_periodic(drums, hit('hat', (.012 if eighth % 2 else .009) * quiet),
                           (bar * 4 + beat) * BEAT)
    tracks['drums'] = room(stereo(drums, -.04), .2)
    mix = sum(tracks.values())
    # Fixed shared gain preserves the balance when comparing stems.
    gain = .67 / np.max(np.abs(mix))
    tracks = {name: circular_filter(track * gain, 5100) for name, track in tracks.items()}
    return tracks, sum(tracks.values()), gain


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    tracks, mix, gain = render()
    for name, track in {'tema': mix, 'sinte': tracks['synth'], 'flauta': tracks['flute'],
                         'acompanamiento': tracks['bass'] + tracks['drums']}.items():
        sf.write(OUT / f'{name}.flac', track, RATE, subtype='PCM_16')
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', OUT / 'tema.flac',
                    '-c:a', 'libmp3lame', '-b:a', '192k', OUT / 'tema.mp3'], check=True)
    meta = dict(title='Dos voces — estudio 01', bpm=BPM, key='D dorian', bars=BARS,
                loop=N / RATE, pad=0, sampleRate=RATE, samples=N,
                voices=['upper-register analogue synth', 'upper-register flute'],
                accompaniment=['supporting bass', 'soft broken beat and hand drum'],
                references=['https://boardsofcanada.bandcamp.com/track/roygbiv',
                            'https://www.youtube.com/watch?v=Rxbcp2AK-2Y'],
                peak=float(np.max(np.abs(mix))), rms=float(np.sqrt(np.mean(mix ** 2))),
                boundaryJump=float(np.max(np.abs(mix[0] - mix[-1]))), gain=gain)
    (OUT / 'tema.json').write_text(json.dumps(meta, indent=2) + '\n')
    (HERE / 'dos_voces_score.json').write_text(json.dumps(dict(harmony=PLAN, **SCORE), indent=2) + '\n')
    print(json.dumps(meta, indent=2))


if __name__ == '__main__':
    main()
