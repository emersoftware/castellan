"""Dos voces, study 03: Roygbiv's melody on a BoC synth, the flute line of Age of Kings' track 1 on a recorder,
and a Roygbiv-style beat, all chill. A seamless loop.
Run with uv run --with pretty_midi --with numpy --with scipy --with soundfile python FILE.

The two melodies are the originals this time (study 02 only borrowed their traits):
  Roygbiv (Boards of Canada): Hooktheory's transcription of the 8-bar melody and its chords, in A Mixolydian,
    moved down a tone to G Mixolydian, which has the same notes as D Dorian. Its one chord outside them,
    the IV/vi (B major over F#), becomes A sus4 over E.
  AoK track 1: the high line transcribed from the CD audio with basic-pitch: A5 held, G5, A5, F-G-F, E5 held,
    F5 held, C5 held, a run up D-F-G-A-C6 and D6 held. Over its own bass, two bars on F and two on D.
    Its Bb and Eb become B and E in Dorian; the Bb grace note becomes an A.
  The beat: measured from Roygbiv: snare on 2 and 4, kick on 1 and on the last sixteenth before 3 and before 1,
    soft eighth hats. Dusty, dark, low in the mix.
  bars 1-4    bass, pad and beat on AoK's F and D (bar 12 turns to G/D, a step towards Roygbiv's G)
  bars 5-12   the recorder plays AoK's line
  bars 13-20  the synth plays Roygbiv's melody over its chords
  bars 21-28  Roygbiv again, the recorder above it in long notes with AoK's gesture
Synth notes each get their own attack (no glide); the recorder slurs. Helpers come from dos_voces_v2.py.
Writes packages/web/public/music/dos-voces-v3/. Review assets only: the game's music is unchanged.
"""
import json
from pathlib import Path
import subprocess
import numpy as np
from scipy.signal import butter, lfilter
import soundfile as sf
import compose as menu
import dos_voces_v2 as v2

HERE = Path(__file__).resolve().parent
OUT = HERE.parents[1] / 'packages/web/public/music/dos-voces-v3'
RATE, BPM, BEAT, BAR = v2.RATE, v2.BPM, v2.BEAT, v2.BAR
AOK_FROM, ROY_FROM, BOTH_FROM, BARS = 4, 12, 20, 28
LOOP = BARS * BAR
assert LOOP == v2.LOOP and BOTH_FROM == v2.BOTH_FROM

# Roygbiv's chords in G Mixolydian, (beat, chord) over its 8 bars.
ROY_CHORDS = [(0, 'Em7sus4'), (2.5, 'Asus/E'), (4, 'Am7/G'), (6, 'C'), (8, 'G'), (10, 'Fadd9'), (12, 'Am'),
              (16, 'Em7sus4'), (18.5, 'Asus/E'), (20, 'Am7/G'), (22, 'C'), (24, 'G'), (26, 'F/C'), (28, 'Am')]
VOICING = {'Dm': 'D2 D3 A3 E4 F4', 'F': 'F2 F3 C4 E4 A4', 'Em7sus4': 'E2 E3 B3 D4 A4', 'Asus/E': 'E2 A3 D4 E4',
           'Am7/G': 'G2 A3 C4 E4', 'C': 'C2 G3 D4 E4', 'G': 'G2 D3 B3 A4', 'Fadd9': 'F2 C4 G4 A4',
           'F/C': 'C2 A3 C4 F4', 'Am': 'A1 E3 C4 G4', 'G/D': 'D2 G3 B3 D4'}  # the first note is the bass
# Roygbiv's melody, (beat, beats, note), a tone down.
ROYGBIV = [(0, 1, 'D4'), (1, .5, 'G4'), (1.5, 2.5, 'E4'), (4, 1, 'A4'), (5, .5, 'C5'), (5.5, 1.5, 'G4'),
           (7, .5, 'C5'), (7.5, .5, 'B4'), (8, 2, 'G4'), (10, 1, 'F4'), (11, .25, 'F4'), (11.25, .25, 'E4'),
           (11.5, 4.5, 'C4'), (16, 1, 'D4'), (17, .5, 'G4'), (17.5, 2.5, 'E4'), (20, 1, 'G4'), (21, .5, 'C5'),
           (21.5, 1.5, 'A4'), (23, .5, 'C5'), (23.5, .5, 'B4'), (24, 1, 'D5'), (25, 1, 'C5'), (26, .25, 'C5'),
           (26.25, .25, 'B4'), (26.5, .5, 'G4'), (27, .5, 'A4'), (27.5, .25, 'B4'), (27.75, 4.25, 'G4')]
# AoK's line, (beat, beats, note), over F F D D F F D D.
AOK = [(0, 3, 'A5'), (3, 1, 'G5'),
       (4, 2, 'A5'), (6, .5, 'F5'), (6.5, .75, 'G5'), (7.25, .25, 'A5'), (7.5, .5, 'F5'),
       (8, 3.5, 'E5'), (11.5, .25, 'F5'), (11.75, .25, 'E5'),
       (12, 4, 'F5'),
       (16, 3.5, 'C5'), (19.5, .25, 'D5'), (19.75, .25, 'F5'),
       (20, .25, 'G5'), (20.25, 1.75, 'A5'), (22, 1.75, 'C6'), (23.75, .25, 'E6'),
       (24, 6, 'D6')]
# Over Roygbiv, the recorder in long notes: AoK's held note and its turn, on Roygbiv's chords.
ABOVE = [(0, 3, 'A5'), (3, 1, 'G5'),
         (4, 2, 'A5'), (6, .5, 'G5'), (6.5, 1.5, 'E5'),
         (8, 3.5, 'D5'), (11.5, .25, 'E5'), (11.75, .25, 'D5'),
         (12, 4, 'E5'),
         (16, 2.5, 'B5'), (18.5, 1.5, 'A5'),
         (20, .5, 'G5'), (20.5, 1.5, 'A5'), (22, 1.75, 'C6'), (23.75, .25, 'E6'),
         (24, 2, 'D6'), (26, 2, 'C6'), (28, 4, 'A5')]


def plan():
    """(start beat, beats, chord) over the loop."""
    spans = [(0, 8, 'F'), (8, 8, 'Dm')]
    for k in range(2):
        b = (AOK_FROM + 4 * k) * 4
        spans += [(b, 8, 'F'), (b + 8, 8, 'Dm')] if k == 0 else [(b, 8, 'F'), (b + 8, 6, 'Dm'), (b + 14, 2, 'G/D')]
    for section in (ROY_FROM, BOTH_FROM):
        starts = [beat for beat, _ in ROY_CHORDS] + [32]
        spans += [(section * 4 + s, e - s, c) for (s, c), e in zip(ROY_CHORDS, starts[1:])]
    return spans


def at(line, bar):
    return [(bar * 4 + beat, beats, menu.midi(n)) for beat, beats, n in line]


def lines():
    synth = at(ROYGBIV, ROY_FROM) + at(ROYGBIV, BOTH_FROM)
    recorder = at(AOK, AOK_FROM) + at(ABOVE, BOTH_FROM)
    return synth, recorder


def check(synth, recorder):
    """Every note in D Dorian; held together, the voices are never in unison, a second apart, or a semitone
    apart in any octave."""
    problems = []
    for start, beats, note in synth + recorder:
        assert note % 12 in menu.SCALE, (start, note)
    for s0, sb, sn in synth:
        for r0, rb, rn in recorder:
            gap = abs(rn - sn)
            if min(s0 + sb, r0 + rb) - max(s0, r0) >= 0.5 and (gap in (0, 1, 2, 10, 11) or gap % 12 in (1, 11)):
                problems.append(f'voices rub at bar {max(s0, r0) / 4 + 1:.2f}: {sn} against {rn}')
    return problems


def hat(gain):
    t = np.arange(int(0.05 * RATE)) / RATE
    noise = lfilter(*butter(2, [5000 / (RATE / 2), 8000 / (RATE / 2)], 'band'), menu.rng.standard_normal(len(t)))
    return noise * np.exp(-t / 0.012) * gain


def tape(x):
    """A touch of tape: soft saturation and a rolled-off top."""
    x = np.tanh(2 * x / np.abs(x).max()) * np.abs(x).max() / 2
    return lfilter(*butter(1, 4500 / (RATE / 2)), x)


def accompaniment():
    """Bass and pad on every chord, Roygbiv's dotted bass pulse, and its beat throughout."""
    n = int((LOOP + 4) * RATE)
    bass, pad, drums = np.zeros(n), np.zeros(n), np.zeros(n)
    spans = plan()
    for start, beats, chord in spans:
        notes = [menu.midi(x) for x in VOICING[chord].split()]
        for note in notes[1:]:
            menu.place(pad, v2.pad_note(note, beats), start * BEAT)
        # Dotted pulse: hits every one and a half beats inside the chord, restarting on each chord.
        hits = np.arange(0, beats, 1.5)
        for i, h in enumerate(hits):
            length = min(1.5, beats - h) - 0.1
            menu.place(bass, v2.sh101(notes[0] + (12 if notes[0] < menu.midi('C2') else 0), length,
                                      0.2 * (1 if i == 0 else 0.75), cutoff=420, env_amt=600, decay=0.25,
                                      sub=0.35, keytrack=0.2, attack=0.006), (start + h) * BEAT)
    for bar in range(BARS):
        t0 = bar * BAR
        for s, g in ((0, 1), (7, 0.8), (8, 0.45), (15, 0.6)):
            menu.place(drums, v2.kick(0.3 * g), t0 + s * BEAT / 4)
        for s in (4, 12):
            menu.place(drums, v2.snare(0.1), t0 + s * BEAT / 4)
        for e in range(8):
            swing = 0.12 * BEAT if e % 2 else 0
            menu.place(drums, hat(0.012 if e % 2 else 0.02), t0 + e * BEAT / 2 + swing)
    # Dusty: a darker top on the beat.
    drums = lfilter(*butter(2, 3500 / (RATE / 2)), drums)
    return bass, pad, drums


def main():
    synth, recorder = lines()
    print('\n'.join(check(synth, recorder)) or 'all notes in D Dorian, no rubs between the voices')
    lead = np.zeros(int((LOOP + 4) * RATE))
    for start, beats, note in synth:
        # No sub (that is the bass's job); the filter opens over the synth's first two bars.
        opening = min(1, (start - ROY_FROM * 4) / 8) if start < (ROY_FROM + 2) * 4 else 1
        menu.place(lead, v2.sh101(note, beats - 0.06, 0.16, cutoff=500 + 1000 * opening, env_amt=500 + 700 * opening,
                                  decay=0.35, sub=0, drift=2.5, at=start * BEAT, release=0.05), start * BEAT)
    lead = tape(lead)
    d, echo, wet = int(0.75 * BEAT * RATE), lead.copy(), np.zeros_like(lead)
    for i in range(1, 4):
        echo = lfilter(*butter(1, 1500 / (RATE / 2)), echo) * 0.3
        wet[i * d:] += echo[:-i * d]
    synth_st = v2.wrap(v2.room(np.stack([lead + 0.6 * wet, 0.85 * lead + wet], axis=1)))
    bass, pad, drums = accompaniment()
    acc = v2.wrap(v2.room(np.stack([bass + pad + drums * 0.95, bass + pad * 0.9 + drums], axis=1), level=0.015))
    flute = v2.recorder_voice(recorder)
    flute = np.stack([flute[:, 0] * 0.85, flute[:, 1]], axis=1)[:len(acc)]
    # Each voice level where it plays alone; the accompaniment 5 dB under them.
    section = lambda stem, bar: v2.rms(stem[int(bar * BAR * RATE):int((bar + 8) * BAR * RATE)])
    stems = {'sinte': synth_st * 0.18 / section(synth_st, ROY_FROM),
             'flauta': flute * 0.18 / section(flute, AOK_FROM),
             'acompanamiento': acc * 0.1 / section(acc, ROY_FROM)}
    mix = sum(stems.values())
    scale = 0.7 / np.abs(np.tanh(mix * 1.1)).max()
    OUT.mkdir(parents=True, exist_ok=True)
    stats = {}
    for name, stem in list(stems.items()) + [('tema', mix)]:
        audio = np.tanh(stem * 1.1) * scale
        sf.write(OUT / f'{name}.flac', audio, RATE)
        stats[name] = v2.rms(audio)
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', OUT / 'tema.flac', '-af',
                    'lowpass=f=6000', '-c:a', 'libmp3lame', '-b:a', '192k', OUT / 'tema.mp3'], check=True)
    (OUT / 'tema.json').write_text(json.dumps(dict(
        title='Dos voces — estudio 03', bpm=BPM, key='D dorian', bars=BARS, loop=LOOP, pad=0, sampleRate=RATE,
        voices=["Roygbiv's melody, SH-101-style synth", "AoK track 1's line, recorder"], rms=stats,
        references=['https://www.hooktheory.com/theorytab/view/boards-of-canada/roygbiv',
                    'https://www.youtube.com/watch?v=Rxbcp2AK-2Y']), indent=1, ensure_ascii=False) + '\n')
    print(f'{LOOP:.1f} s loop', {k: round(v, 3) for k, v in stats.items()})


if __name__ == '__main__':
    main()
