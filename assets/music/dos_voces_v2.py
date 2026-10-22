"""Dos voces, study 02: Boards of Canada's "Roygbiv" meets Age of Kings' track 1, as a seamless loop.
Run with uv run --with pretty_midi --with numpy --with scipy --with soundfile python FILE.

Same method as compose.py and battle.py: take what has no owner from each reference, compose in code, synthesize.
  Roygbiv (Hooktheory, Syntorial): 84 BPM, a verse of ii, IV/vi, bVII, IV, I in A Mixolydian. Moved to D,
    its F# lowered for Dorian, that is Em, G/B, C, G and home. A smooth, stepwise, loosely syncopated lead,
    about a note per beat, mostly chord tones, D4-E5. An SH-101 patch: pulse with slow PWM, a sub an
    octave down, a low-pass with a long decay, mono.
  AoK track 1 (measured from the CD audio): about 80 BPM, the bass alternating a D block and an F block,
    two bars each; a high line of long notes turning around a neighbour; straight eighths on hand drums.
    Its Bb and Eb become B and E in Dorian.
Our chords: AoK's Dm-F bedrock, then Roygbiv's turn: Dm Dm F F | Em G/B C G-or-Asus.
Two voices, both original melodies: the synth (Roygbiv's statistics, none of its notes) and a recorder
(AoK's gesture, none of its notes). Bass, a soft pad, a dusty beat and a hand drum accompany them.
  bars 1-4    bass, pad, hand drum
  bars 5-12   the synth sings, the beat enters
  bars 13-20  the recorder answers
  bars 21-28  both together
Every synth note gets its own attack (no glide or legato); only the recorder slurs. The synth drifts by
2-3 cents, slowly, as a nod to BoC's tape without the wobble.
Writes dos-voces-v2/ here (tema.mp3, tema/sinte/flauta/acompanamiento.flac, tema.json).
Review assets only: the game's music is unchanged.
"""
import json
from pathlib import Path
import subprocess
import numpy as np
import pretty_midi as pm
from scipy.signal import butter, fftconvolve, lfilter
import soundfile as sf
import compose as menu

HERE = Path(__file__).resolve().parent
OUT = HERE / 'dos-voces-v2'
SOUNDFONT = Path.home() / '.cache/castellan-soundfonts/MuseScore_General.sf3'
RATE = 44100
BPM = 84
BEAT = 60 / BPM
BAR = 4 * BEAT
PHRASE = ['Dm', 'Dm', 'F', 'F', 'Em', 'G', 'C']
PLAN = ['Dm', 'Dm', 'F', 'F'] + PHRASE + ['G'] + PHRASE + ['Asus'] + PHRASE + ['Asus']
BARS = len(PLAN)
LOOP = BARS * BAR
# Bass notes under each chord: G/B in the Roygbiv turn, the rest on the root.
BASS = {'Dm': 'D2', 'F': 'F2', 'Em': 'E2', 'G': 'B1', 'C': 'C2', 'Asus': 'A1'}
# Pad voicings, open and suspended like BoC's.
PAD = {'Dm': 'D3 A3 E4 F4', 'F': 'F3 C4 E4 A4', 'Em': 'E3 B3 D4 A4', 'G': 'B2 G3 D4 A4',
       'C': 'C3 G3 D4 E4', 'Asus': 'A2 E3 D4 G4'}

# The synth's phrase (bar in phrase, beat, beats, note): a note a beat or so, syncopated on the "and" of 2.
SYNTH = [(0, 0, 1.5, 'A4'), (0, 1.5, 1, 'C5'), (0, 2.5, 1.5, 'D5'),
         (1, 0, 1, 'E5'), (1, 1, 1, 'D5'), (1, 2, 0.5, 'C5'), (1, 2.5, 1.5, 'A4'),
         (2, 0, 1.5, 'C5'), (2, 1.5, 1, 'A4'), (2, 2.5, 1, 'G4'), (2, 3.5, 0.5, 'A4'),
         (3, 0, 3, 'F4'), (3, 3, 1, 'G4'),
         (4, 0, 1.5, 'G4'), (4, 1.5, 1, 'B4'), (4, 2.5, 1.5, 'D5'),
         (5, 0, 1.5, 'D5'), (5, 1.5, 1, 'E5'), (5, 2.5, 1.5, 'D5'),
         (6, 0, 1.5, 'E5'), (6, 1.5, 1, 'D5'), (6, 2.5, 1.5, 'C5'),
         (7, 0, 2.5, 'B4'), (7, 2.5, 1.5, 'A4')]
# The recorder's phrase: a long note, a quick turn around its neighbour, a long landing, a step lower each time.
RECORDER = [(0, 0, 2.5, 'F5'), (0, 2.5, 0.5, 'E5'), (0, 3, 0.5, 'F5'), (0, 3.5, 0.5, 'G5'),
            (1, 0, 3, 'A5'), (1, 3, 0.5, 'G5'), (1, 3.5, 0.5, 'F5'),
            (2, 0, 2, 'G5'), (2, 2, 1, 'F5'), (2, 3, 1, 'E5'),
            (3, 0, 3.5, 'F5'),
            (4, 0, 2.5, 'G5'), (4, 2.5, 0.5, 'A5'), (4, 3, 0.5, 'G5'), (4, 3.5, 0.5, 'E5'),
            (5, 0, 2.5, 'D5'), (5, 2.5, 0.5, 'E5'), (5, 3, 1, 'G5'),
            (6, 0, 2.5, 'E5'), (6, 2.5, 0.5, 'D5'), (6, 3, 1, 'C5'),
            (7, 0, 3.5, 'D5')]
# In the last section the recorder keeps its gesture but sits a third to a sixth above the synth.
RECORDER_JOINT = [(0, 0, 2.5, 'F5'), (0, 2.5, 0.5, 'G5'), (0, 3, 1, 'F5'),
                  (1, 0, 3, 'A5'), (1, 3, 1, 'F5'),
                  (2, 0, 1.5, 'A5'), (2, 1.5, 1, 'F5'), (2, 2.5, 1, 'E5'), (2, 3.5, 0.5, 'F5'),
                  (3, 0, 3, 'C5'), (3, 3, 1, 'E5'),
                  (4, 0, 2.5, 'E5'), (4, 2.5, 1.5, 'G5'),
                  (5, 0, 2.5, 'G5'), (5, 2.5, 0.5, 'A5'), (5, 3, 1, 'G5'),
                  (6, 0, 2.5, 'G5'), (6, 2.5, 0.5, 'A5'), (6, 3, 1, 'E5'),
                  (7, 0, 4, 'D5')]
SYNTH_FROM, RECORDER_FROM, BOTH_FROM = 4, 12, 20


def midi(name):
    return menu.midi(name)


def hz(note):
    return 440 * 2 ** ((note - 69) / 12)


def lines():
    """Both voices over the loop as (start beat, beats, midi) lists."""
    synth = [((SYNTH_FROM + b) * 4 + beat, beats, midi(n)) for b, beat, beats, n in SYNTH]
    synth += [((BOTH_FROM + b) * 4 + beat, beats, midi(n)) for b, beat, beats, n in SYNTH]
    recorder = [((RECORDER_FROM + b) * 4 + beat, beats, midi(n)) for b, beat, beats, n in RECORDER]
    recorder += [((BOTH_FROM + b) * 4 + beat, beats, midi(n)) for b, beat, beats, n in RECORDER_JOINT]
    return synth, recorder


def chord_at(beat):
    return PLAN[int(beat // 4) % BARS]


def check(synth, recorder):
    """Every note in D Dorian and clear of its chord. Held together, the two voices are never in unison
    nor a second, seventh or ninth apart: those beat against the synth's drift."""
    problems = []
    for name, line in (('synth', synth), ('recorder', recorder)):
        for start, beats, note in line:
            assert note % 12 in menu.SCALE, (name, start, note)
            # A long note a semitone above a chord tone rubs; a passing one is fine.
            if beats >= 1 and menu.avoid(note, chord_at(start)):
                problems.append(f'{name} {note} rubs on {chord_at(start)} at bar {start / 4 + 1:.2f}')
    for s0, sb, sn in synth:
        for r0, rb, rn in recorder:
            together = min(s0 + sb, r0 + rb) - max(s0, r0)
            if together >= 0.5 and (rn == sn or abs(rn - sn) % 12 in (1, 2, 10, 11)):
                problems.append(f'voices rub at bar {max(s0, r0) / 4 + 1:.2f}: {sn} against {rn}')
    return problems


def sh101(note, beats, gain, cutoff=1100, env_amt=1500, decay=0.6, sub=0.5, drift=0.0, at=0.0, attack=0.004,
          release=0.08, keytrack=0.5):
    """An SH-101-style note: a pulse whose width a slow triangle sweeps, plus a square sub an octave down,
    through a 24 dB low-pass whose envelope restarts on every note, with a fresh attack. `drift` (cents)
    bends the pitch slowly with the loop's clock, so the drift is seamless when the loop repeats."""
    held = beats * BEAT
    t = np.arange(int((held + release * 5) * RATE)) / RATE
    f = hz(note) * 2 ** (drift / 1200 * np.sin(2 * np.pi * 4 / LOOP * (at + t)))
    phase = np.cumsum(f) / RATE
    width = 0.5 - 0.12 * (1 - np.abs(((at + t) * BPM / 120) % 2 - 1))  # triangle LFO on the half note
    fc = cutoff * (hz(note) / 440) ** keytrack + env_amt * np.exp(-t / decay)
    wave = np.zeros(len(t))
    for k in range(1, int(min(40, 9000 / hz(note))) + 1):
        r = k * f / fc
        lp = 1 / (1 + r ** 4)
        wave += np.sin(np.pi * k * width) / k * np.sin(2 * np.pi * k * phase) * lp
        if k % 2:  # the sub's odd harmonics
            r = k * f / 2 / fc
            wave += sub * 4 / np.pi / k * np.sin(2 * np.pi * k * phase / 2) / (1 + r ** 4)
    env = np.minimum(1, t / attack) ** 2 * (0.75 + 0.25 * np.exp(-t / 0.3))
    env = np.where(t < held, env, env * np.exp(-(t - held) / release))
    return wave * env * gain


def synth_voice(synth):
    """The lead, mono: each note ends a hair before the next begins, so every note is struck anew."""
    out = np.zeros(int((LOOP + 4) * RATE))
    for start, beats, note in synth:
        menu.place(out, sh101(note, beats - 0.08, 0.16, drift=2.5, at=start * BEAT, release=0.05), start * BEAT)
    return out


def accompaniment():
    n = int((LOOP + 4) * RATE)
    bass, pad, drums = np.zeros(n), np.zeros(n), np.zeros(n)
    for bar, chord in enumerate(PLAN):
        t0 = bar * BAR
        root = midi(BASS[chord])
        # AoK's pulse with Roygbiv's weight: the root held, pushed again on the "and" of 2, the octave on 4.
        for beat, beats, note, g in ((0, 1.4, root, 1), (1.5, 1.4, root, 0.8), (3, 0.45, root + 12, 0.55),
                                     (3.5, 0.45, root, 0.6)):
            menu.place(bass, sh101(note, beats, 0.2 * g, cutoff=420, env_amt=600, decay=0.25, sub=0.35,
                                   keytrack=0.2, attack=0.006), t0 + beat * BEAT)
        for note in PAD[chord].split():
            menu.place(pad, pad_note(midi(note), 4), t0)
        for beat in range(8):
            menu.place(drums, frame_drum(0.06 if beat % 2 else 0.1), t0 + beat * BEAT / 2)
        if bar >= SYNTH_FROM:
            for beat, g in ((0, 1), (1.5, 0.6), (2.75, 0.45)):
                menu.place(drums, kick(0.32 * g), t0 + beat * BEAT)
            for beat in (1, 3):
                menu.place(drums, snare(0.09), t0 + beat * BEAT)
    return bass, pad, drums


def pad_note(note, beats):
    """A slow, dark, steady tone: two octaves of a soft triangle, no detune, so chords never beat."""
    held = beats * BEAT
    t = np.arange(int((held + 1.2) * RATE)) / RATE
    f = hz(note)
    wave = sum(np.sin(2 * np.pi * k * f * t) / k ** 2 * (k % 2 or 0.3) for k in range(1, 6) if k * f < 2000)
    env = np.minimum(1, t / 0.6) * np.where(t < held, 1, np.exp(-(t - held) / 0.35))
    return wave * env * 0.022


def kick(gain):
    """A dusty, round kick settling on A, with its octave so small speakers hear it."""
    t = np.arange(int(0.4 * RATE)) / RATE
    f = 55 * (1 + 0.8 * np.exp(-t / 0.012))
    phase = 2 * np.pi * np.cumsum(f) / RATE
    body = np.sin(phase) * np.exp(-t / 0.16) + 0.6 * np.sin(2 * phase) * np.exp(-t / 0.08)
    return np.tanh(2 * body) * gain


def snare(gain):
    """A soft, dark snare with a tone on A3."""
    t = np.arange(int(0.25 * RATE)) / RATE
    b, a = butter(2, [400 / (RATE / 2), 2200 / (RATE / 2)], 'band')
    noise = lfilter(b, a, menu.rng.standard_normal(len(t))) * np.exp(-t / 0.06)
    return (noise * 0.9 + np.sin(2 * np.pi * 220 * t) * np.exp(-t / 0.05) * 0.5) * gain


def frame_drum(gain):
    """A hand drum: a muted skin tuned to D3, as on AoK's straight eighths."""
    t = np.arange(int(0.3 * RATE)) / RATE
    f = 146.83 * (1 + 0.2 * np.exp(-t / 0.01))
    tone = np.sin(2 * np.pi * np.cumsum(f) / RATE) * np.exp(-t / 0.09)
    b, a = butter(2, [200 / (RATE / 2), 1200 / (RATE / 2)], 'band')
    skin = lfilter(b, a, menu.rng.standard_normal(len(t))) * np.exp(-t / 0.02)
    return (tone + 0.8 * skin) * gain


def recorder_voice(recorder):
    """The recorder through FluidSynth, three passes, the middle one kept so its room wraps like the loop's.
    The soundfont's recorder plays about 6 cents sharp; a pitch bend brings it back."""
    song = pm.PrettyMIDI(initial_tempo=BPM)
    inst = pm.Instrument(74, name='recorder')
    inst.pitch_bends.append(pm.PitchBend(-246, 0))
    for r in range(3):
        for start, beats, note in recorder:
            on = r * LOOP + start * BEAT
            inst.notes.append(pm.Note(58 if start >= BOTH_FROM * 4 else 54, note, on, on + beats * BEAT * 0.98))
    song.instruments.append(inst)
    mid, wav = HERE / 'dos_voces_v2.mid', HERE / 'dos_voces_v2.wav'
    song.write(str(mid))
    subprocess.run(['fluidsynth', '-ni', '-q', '-g', '0.5', '-r', str(RATE), '-o', 'synth.reverb.room-size=0.7',
                    '-o', 'synth.reverb.level=0.6', '-o', 'synth.chorus.active=0', '-F', wav, SOUNDFONT, mid],
                   check=True)
    audio, _ = sf.read(wav)
    mid.unlink()
    wav.unlink()
    audio = audio[int(LOOP * RATE):int(2 * LOOP * RATE)]
    return lfilter(*butter(2, 250 / (RATE / 2), 'high'), audio, axis=0)


def room(stereo, seconds=1.4, level=0.025):
    ir_t = np.arange(int(seconds * RATE)) / RATE
    ir = menu.rng.standard_normal((len(ir_t), 2)) * np.exp(-ir_t / (seconds / 2.5))[:, None]
    ir = lfilter(*butter(1, 3000 / (RATE / 2)), ir, axis=0) * level
    return stereo + np.stack([fftconvolve(stereo[:, c], ir[:, c])[:len(stereo)] for c in range(2)], axis=1)


def rms(audio):
    return float(np.sqrt((audio ** 2).mean()))


def wrap(stereo):
    """Fold the tail onto the start: the loop then sounds exactly as when it repeats."""
    loop_n = int(LOOP * RATE)
    out = stereo[:loop_n].copy()
    out[:len(stereo) - loop_n] += stereo[loop_n:]
    return out


def main():
    synth, recorder = lines()
    problems = check(synth, recorder)
    print('\n'.join(problems) or 'all notes in D Dorian, no rubs')
    lead = synth_voice(synth)
    # A short, dark dotted-eighth echo on the synth, slightly to the right.
    d, echo = int(0.75 * BEAT * RATE), lead.copy()
    wet = np.zeros_like(lead)
    for i in range(1, 4):
        echo = lfilter(*butter(1, 1500 / (RATE / 2)), echo) * 0.3
        wet[i * d:] += echo[:-i * d]
    synth_st = wrap(room(np.stack([lead + 0.6 * wet, 0.85 * lead + wet], axis=1)))
    bass, pad, drums = accompaniment()
    acc = wrap(room(np.stack([bass + pad + drums * 0.95, bass + pad * 0.9 + drums], axis=1), level=0.015))
    flute = recorder_voice(recorder)
    flute = np.stack([flute[:, 0] * 0.85, flute[:, 1]], axis=1)[:len(acc)]
    # Level each part where it plays: the two voices equal, the accompaniment 5 dB under them.
    section = lambda stem, bar: rms(stem[int(bar * BAR * RATE):int((bar + 8) * BAR * RATE)])
    acc = acc * 0.1 / section(acc, SYNTH_FROM)
    stems = {'sinte': synth_st * 0.18 / section(synth_st, SYNTH_FROM),
             'flauta': flute * 0.18 / section(flute, RECORDER_FROM), 'acompanamiento': acc}
    mix = sum(stems.values())
    scale = 0.7 / np.abs(np.tanh(mix * 1.1)).max()
    OUT.mkdir(parents=True, exist_ok=True)
    stats = {}
    for name, stem in list(stems.items()) + [('tema', mix)]:
        audio = np.tanh(stem * 1.1) * scale
        sf.write(OUT / f'{name}.flac', audio, RATE)
        stats[name] = rms(audio)
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', OUT / 'tema.flac', '-af',
                    'lowpass=f=6000', '-c:a', 'libmp3lame', '-b:a', '192k', OUT / 'tema.mp3'], check=True)
    (OUT / 'tema.json').write_text(json.dumps(dict(
        title='Dos voces — estudio 02', bpm=BPM, key='D dorian', bars=BARS, loop=LOOP, pad=0, sampleRate=RATE,
        voices=['SH-101-style synth', 'recorder (MuseScore General)'], rms=stats,
        references=['https://boardsofcanada.bandcamp.com/track/roygbiv', 'https://www.youtube.com/watch?v=Rxbcp2AK-2Y']),
        indent=1, ensure_ascii=False) + '\n')
    print(f'{LOOP:.1f} s loop', {k: round(v, 3) for k, v in stats.items()})


if __name__ == '__main__':
    main()
