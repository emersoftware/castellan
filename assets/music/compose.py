"""An original theme in D Dorian, synthesized and rendered as a seamless loop.
Run with uv run --with numpy --with scipy --with soundfile python FILE.

Harmony: the chord plan of the Age of Empires II menu theme (a D pedal, G-A, C, a shift to the G side,
then A minor-E minor-G-A back home to D), adapted to D Dorian: D becomes D minor, its G minor section
becomes G major and F, and A major becomes A sus4. A chord plan is not a melody; no tune is copied.
Arpeggio: the one of Dorian Concept's "Hide (CS01 Version)", as chord degrees over our chords, in
sixteenths (slowed from its 99 BPM to 76): its cycle of four half-bar cells (rise from the root: 1 5 7 9 3 11 7
then the next root anticipated low; rise from the fifth and turn back: 5 7 3 5 6 7 5 3; rise again from the
root; rise from the fifth to the high sixth and step down: 5 7 6 5 4 3 1 6) and held bass notes of 6 and 10
sixteenths. Degrees are taken in D Dorian on each chord's root; a note that would rub a semitone above a
chord tone moves to its nearest scale neighbour, and roots move to the nearest octave.
Melody: the rhythm of the Age of Empires II motif (a pickup, a long note, three quick notes, a long landing)
with our own notes in D Dorian, so it recalls that call without quoting it. It sings in the last section,
the arpeggio stepping back under it.
Timbre: a Yamaha CS01 emulated from its architecture: one VCO, here a pulse with PWM from a sine LFO; a 12 dB
resonant low-pass with its envelope; an ADSR on the VCA; a short glissando between notes.
Everything is set chill and creamy, like the game's sound effects: a dark, barely resonant filter with a
slow sweep, soft rounded attacks, legato notes, a whisper of drums, a warm room,
a barely moving pulse width and no tape wobble. All synthesized here, no samples.
Writes packages/web/public/music/theme.mp3 (+ theme.json with its loop points) and index.html here to listen.
"""
import json
from pathlib import Path
import subprocess
import numpy as np
from scipy.signal import butter, fftconvolve, lfilter
import soundfile as sf

HERE = Path(__file__).resolve().parent
OUT = HERE.parents[1] / 'packages/web/public/music'
RATE = 44100
BPM = 76
BEAT = 60 / BPM
STEP = BEAT / 4
BAR = 4 * BEAT
PAD = 0.05
rng = np.random.default_rng(7)

NAMES = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
# Chord tones in D Dorian: root, third, fifth, seventh (the first four), then a colour note.
CHORDS = {'Dm': 'D F A C E', 'G': 'G B D F E', 'Am': 'A C E G B', 'C': 'C E G B D', 'Em': 'E G B D A',
          'F': 'F A C E G', 'Asus': 'A D E G B'}
# One entry per bar; a pair splits the bar in halves.
PLAN = ['Dm', 'Dm', ('G', 'Am'), 'Dm', 'Dm', 'C', 'Dm', 'Dm',
        'G', 'F', 'C', 'G', 'G', 'F', 'C', 'Asus',
        'Am', 'Em', 'Am', ('G', 'Em'), 'Am', 'Em', 'G', 'Asus',
        'Dm', 'Dm', 'C', 'Dm', 'Dm', ('G', 'Am'), 'C', 'Asus']
BARS = len(PLAN)
LOOP = BARS * BAR


def hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)


def chord_at(bar, half):
    c = PLAN[bar]
    return c[half] if isinstance(c, tuple) else c


SCALE = {2, 4, 5, 7, 9, 11, 0}  # D Dorian
# Hide's four cells, in scale steps above the cell's root (0 = root, 4 = fifth, 9 = third an octave up...).
# None marks the anticipated root of the next cell.
CELLS = [[0, 4, 6, 8, 9, 10, 13, None], [4, 6, 9, 11, 12, 13, 11, 9],
         [0, 4, 6, 8, 9, 10, 13, None], [4, 6, 12, 11, 10, 9, 7, 5]]


def cell_chords():
    return [chord_at(bar, half) for bar in range(BARS) for half in range(2)]


def cell_roots(cells=None):
    """Each cell's chord root, in the octave nearest the previous one (within F2-G#3), so the
    arpeggio's register moves smoothly from chord to chord."""
    roots, prev = [], 50
    for chord in cells or cell_chords():
        pc = NAMES[chord[0]]
        prev = min((m for m in range(41, 57) if m % 12 == pc), key=lambda m: abs(m - prev))
        roots.append(prev)
    return roots


def ladder(root):
    return [m for m in range(root, root + 30) if m % 12 in SCALE]


def avoid(note, chord):
    """A scale note a semitone above a chord tone (the 4th over a major chord, the b6 over a minor one,
    the b9 over E minor) rubs against the chord."""
    tones = {NAMES[n] for n in CHORDS[chord].split()[:4]}
    return (note - 1) % 12 in tones and note % 12 not in tones


def arpeggio(cells=None):
    """Hide's four-cell arpeggio over `cells` (one chord per eight-note cell; default: every half bar)."""
    cells = cells or cell_chords()
    roots = cell_roots(cells)
    line = []
    for i, chord in enumerate(cells):
        steps = ladder(roots[i])
        cell = []
        for k in CELLS[i % 4]:
            if k is None:
                cell.append(roots[(i + 1) % len(cells)])
                continue
            # A note that rubs, or repeats the last one, becomes its nearest scale neighbour that does neither.
            prev = cell[-1] if cell else None
            k = next(j for j in (k, k + 1, k - 1, k + 2, k - 2) if not avoid(steps[j], chord) and steps[j] != prev)
            cell.append(steps[k])
        line += cell
    return line


# The AoE-style call: a pickup on the fourth beat, a long note, three eighths, a long landing.
# (bar of the long note, pickup, long, eighths, landing), in the last section.
MELODY_FROM = 24
STATEMENTS = [(24, 'D4', 'A4', 'G4 A4 C5', 'B4'), (26, 'D4', 'A4', 'G4 A4 C5', 'D5'),
              (28, 'D4', 'A4', 'G4 F4 E4', 'G4'), (30, 'D4', 'G4', 'F4 G4 E4', 'D4')]
MELODY = []  # (bar, beat, beats, note), bars absolute
for bar, pickup, long_note, quick, landing in STATEMENTS:
    if pickup:
        MELODY.append((bar - 1, 3, 1, pickup))
    MELODY.append((bar, 0, 2.5, long_note))
    MELODY += [(bar, 2.5 + 0.5 * i, 0.5, n) for i, n in enumerate(quick.split())]
    MELODY.append((bar + 1, 0, 4 if bar == 30 else 3, landing))


def midi(name):
    return 12 * (int(name[-1]) + 1) + NAMES[name[0]]


def cs01(notes, step, gate=0.9, cutoff=900, env_amt=2200, q=1.6, gain=0.2, glide=0.005, keytrack=0.3, env_decay=0.12, pwm=0.18, attack=0.003):
    """A Yamaha CS01-style mono voice playing `notes` (MIDI, None = rest), one per `step` seconds.

    Pulse VCO with PWM from a slow sine LFO, 12 dB resonant low-pass with a decaying envelope, ADSR on
    the VCA, and glissando from the previous note. Monophonic like the real one: each note cuts the
    previous one, so two pitches never ring together and beat. Returns the whole phrase as one buffer."""
    n = int((len(notes) * step + 0.4) * RATE)
    out = np.zeros(n)
    prev = None
    for i, note in enumerate(notes):
        if note is None:
            continue
        t0 = i * step
        length = int((step * gate + 0.25) * RATE)
        t = np.arange(length) / RATE
        f_to = hz(note)
        f_from = hz(prev) if prev is not None else f_to
        f = f_to + (f_from - f_to) * np.exp(-t / glide)
        phase = np.cumsum(f) / RATE
        width = 0.5 - pwm * (0.5 + 0.5 * np.sin(2 * np.pi * 0.35 * (t0 + t)))
        fc = cutoff * (f_to / 440) ** keytrack + env_amt * np.exp(-t / env_decay)
        wave = np.zeros(length)
        for k in range(1, int(min(60, 14000 / f_to)) + 1):
            r = k * f / fc
            filt = 1 / np.sqrt((1 - r ** 2) ** 2 + (r / q) ** 2)
            wave += np.sin(np.pi * k * width) / k * np.sin(2 * np.pi * k * phase) * filt
        held = step * gate
        adsr = np.where(t < attack, (t / attack) ** 2, 0.65 + 0.35 * np.exp(-(t - attack) / 0.15))
        adsr = np.where(t < held, adsr, adsr * np.exp(-(t - held) / 0.07))
        following = next((j for j in range(i + 1, len(notes)) if notes[j] is not None), None)
        if following is not None:
            cut = int((following - i) * step * RATE)
            if cut < length:
                fade = min(cut, int(0.004 * RATE))
                adsr[cut - fade:cut] *= np.linspace(1, 0, fade)
                adsr[cut:] = 0
        place(out, wave * adsr * gain, t0)
        prev = note
    return out


def place(buf, sound, at):
    i = int(at * RATE)
    end = min(len(buf), i + len(sound))
    buf[i:end] += sound[:end - i]


def kick(gain):
    t = np.arange(int(0.35 * RATE)) / RATE
    f = 55 + 65 * np.exp(-t / 0.03)  # settles on A1, in key
    return np.sin(2 * np.pi * np.cumsum(f) / RATE) * np.exp(-t / 0.12) * gain


def snare(gain):
    t = np.arange(int(0.25 * RATE)) / RATE
    b, a = butter(2, [900 / (RATE / 2), 4000 / (RATE / 2)], 'band')
    noise = lfilter(b, a, rng.standard_normal(len(t))) * np.exp(-t / 0.07)
    return (noise * 0.8 + np.sin(2 * np.pi * 220 * t) * np.exp(-t / 0.04) * 0.4) * gain


def hat(gain):
    t = np.arange(int(0.06 * RATE)) / RATE
    b, a = butter(2, [4000 / (RATE / 2), 7000 / (RATE / 2)], "band")
    return lfilter(b, a, rng.standard_normal(len(t))) * np.exp(-t / 0.015) * gain


def render():
    tail = 4.0
    n = int((LOOP + tail) * RATE)
    arp, bass, drums = np.zeros(n), np.zeros(n), np.zeros(n)
    line = arpeggio()
    # A creamy take on Hide's patch: darker, gently resonant, slow sweep, rounded attacks, legato.
    hide = dict(cutoff=650, env_amt=800, q=1.2, env_decay=0.35, glide=0.01, pwm=0.05, attack=0.02, gate=1.0)
    place(arp, cs01(line, STEP, **hide), 0)
    # The melody: the same CS01, softer filter and slower envelope, an octave above the arpeggio's middle.
    lead = np.zeros(n)
    for bar, beat, beats, note in MELODY:
        place(lead, cs01([midi(note)], STEP, gate=beats * 4 * 0.95, cutoff=800, env_amt=500, q=1.1, gain=0.45,
                         pwm=0.05, attack=0.05), bar * BAR + beat * BEAT)
    # The arpeggio steps back under the melody, easing in and out over a bar.
    duck = np.ones(n)
    a, b, ramp = int((MELODY_FROM - 1) * BAR * RATE), int(LOOP * RATE), int(BAR * RATE)
    duck[a:a + ramp] = np.linspace(1, 0.7, ramp)
    duck[a + ramp:b - ramp // 4] = 0.7
    duck[b - ramp // 4:b] = np.linspace(0.7, 1, ramp // 4)
    arp = arp * duck + lead
    # Bass: each bar's first root held 6 sixteenths, the second half's root anticipated and held 10.
    low, roots = [], cell_roots()
    for bar in range(BARS):
        low += [roots[2 * bar]] + [None] * 5 + [roots[2 * bar + 1]] + [None] * 9
    gates = [6 if i % 16 == 0 else 10 for i in range(len(low))]
    for i, note in enumerate(low):
        if note is not None:
            place(bass, cs01([note], STEP, gate=gates[i], cutoff=250, env_amt=350, q=1.1, gain=0.18, keytrack=0), i * STEP)
    # A soft broken beat from bar 9, swung sixteenths on the hat.
    for bar in range(8, BARS):
        t0 = bar * BAR
        for beat in (0, 1.75, 2.5):
            place(drums, kick(0.14), t0 + beat * BEAT)
        for beat in (1, 3):
            place(drums, snare(0.05), t0 + beat * BEAT)
        for s in range(16):
            swing = 0.18 * STEP if s % 2 else 0
            place(drums, hat(0.01 if s % 4 else 0.018), t0 + s * STEP + swing)
    # Ping-pong dotted-eighth delay on the arpeggio, then a short soft room on everything.
    d = int(0.75 * BEAT * RATE)
    left, right = arp.copy(), arp.copy()
    echo = arp * 0.15
    b, a = butter(1, 1800 / (RATE / 2))
    for i in range(1, 6):
        echo = lfilter(b, a, echo)
        shifted = np.zeros(n)
        shifted[i * d:] = echo[:n - i * d]
        (left if i % 2 else right)[:] += shifted
        echo *= 0.4
    mix = np.stack([left + bass + drums, right + bass + drums], axis=1)
    ir_t = np.arange(int(1.6 * RATE)) / RATE
    ir = rng.standard_normal((len(ir_t), 2)) * np.exp(-ir_t / 0.8)[:, None]
    ir = lfilter(*butter(1, 4000 / (RATE / 2)), ir, axis=0) * 0.02
    wet = np.stack([fftconvolve(mix[:, c], ir[:, c])[:n] for c in range(2)], axis=1)
    mix = mix + wet
    # Wrap the tail onto the start: the loop then sounds exactly as when it repeats.
    loop_n = int(LOOP * RATE)
    song = mix[:loop_n].copy()
    song[:n - loop_n] += mix[loop_n:]
    song = tape(song)
    pad = int(PAD * RATE)
    song = np.concatenate([song[-pad:], song, song[:pad]])
    return song / np.abs(song).max() * 0.7


def tape(song):
    """Soft tape-like saturation on the peaks."""
    return np.tanh(song / np.abs(song).max() * 1.1)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    wav = HERE / 'render.wav'
    sf.write(wav, render(), RATE)
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', wav, '-af', 'lowpass=f=6000',
                    '-c:a', 'libmp3lame', '-b:a', '160k', OUT / 'theme.mp3'], check=True)
    wav.unlink()
    (OUT / 'theme.json').write_text(json.dumps(dict(pad=PAD, loop=LOOP, bpm=BPM, key='D dorian'), indent=1) + '\n')
    (HERE / 'index.html').write_text(
        '<!doctype html><meta charset="utf-8"><title>aoa theme</title>'
        '<style>body{font:14px system-ui;background:#111;color:#ddd;margin:2em}</style>'
        f'<p>Theme, D Dorian, {BPM} BPM, {LOOP:.1f} s loop</p>'
        '<audio controls loop src="http://localhost:5173/music/theme.mp3"></audio>\n')
    print(f'theme.mp3: {LOOP:.1f} s loop')


if __name__ == '__main__':
    main()
