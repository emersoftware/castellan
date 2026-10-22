"""The battle theme: the menu theme's leitmotifs for two flutes and a war drum, as a seamless loop.
Kept chill and creamy like the rest of the sound: unhurried, softly played, a warm room. The flutes are
high-passed so the drum owns the low end, and the drum carries an octave and a soft skin hit so small
speakers hear it too.
Run with uv run --with pretty_midi --with numpy --with scipy --with soundfile python FILE.

Same key (D Dorian), same chord plan (Age of Empires II's, adapted) and the same two leitmotifs as
compose.py: the flute sings the call (a pickup, a long note, three quick notes, a long landing) and the
pan flute plays the arpeggio in eighths, a bar per cell. A war drum (bombo), synthesized here and tuned to D and A
(the soundfont's taiko is not pitched true), marches under them.
  bars 1-8    drum and pan flute: the arpeggio alone
  bars 9-24   the flute calls, two bars on and two off, the pan flute answering
  bars 25-32  the full call, the pan flute a third above it
The flutes are rendered with FluidSynth and MuseScore_General.sf3 (MIT), downloaded to
~/.cache/castellan-soundfonts.
Writes battle.mp3 (+ battle.json with its loop points) next to this script.
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
OUT = HERE
SOUNDFONT = Path.home() / '.cache/castellan-soundfonts/MuseScore_General.sf3'
SOUNDFONT_URL = 'https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3'
BPM = 90
BEAT = 60 / BPM
BAR = 4 * BEAT
BARS = menu.BARS
LOOP = BARS * BAR
PAD = 0.05
RATE = 44100

# The flute's calls: the menu's last-section call, with two answers before it on the middle sections' chords.
CALLS = [(8, 'D4', 'B4', 'A4 B4 D5', 'C5'), (12, 'D4', 'B4', 'A4 B4 D5', 'A4'),
         (16, 'E4', 'C5', 'B4 C5 E5', 'D5'), (20, 'E4', 'C5', 'B4 A4 G4', 'B4')] + menu.STATEMENTS


def call_notes():
    notes = []
    for bar, pickup, long_note, quick, landing in CALLS:
        if pickup:
            notes.append((bar - 1, 3, 1, menu.midi(pickup)))
        notes.append((bar, 0, 2.5, menu.midi(long_note)))
        notes += [(bar, 2.5 + 0.5 * i, 0.5, menu.midi(n)) for i, n in enumerate(quick.split())]
        notes.append((bar + 1, 0, 4 if bar == 30 else 3, menu.midi(landing)))
    return notes


def third_above(note, chord):
    """The diatonic third above `note` in D Dorian, or the fourth or fifth if the third rubs on `chord`."""
    ladder = [m for m in range(note + 1, note + 9) if m % 12 in menu.SCALE]
    return next(m for m in (ladder[1], ladder[2], ladder[3]) if not menu.avoid(m, chord))


def bombo(f0, velocity):
    """A big drum: a soft mallet thump, then the head settling on `f0` and ringing out."""
    t = np.arange(int(1.6 * RATE)) / RATE
    f = f0 * (1 + 0.5 * np.exp(-t / 0.03))
    phase = 2 * np.pi * np.cumsum(f) / RATE
    # The octave and the twelfth (a fifth up, still D or A) are what laptop speakers can play.
    head = (np.sin(phase) * np.exp(-t / 0.28) + 0.9 * np.sin(2 * phase) * np.exp(-t / 0.22)
            + 0.45 * np.sin(3 * phase) * np.exp(-t / 0.12))
    b, a = butter(2, [150 / (RATE / 2), 900 / (RATE / 2)], 'band')
    skin = lfilter(b, a, menu.rng.standard_normal(len(t))) * np.exp(-t / 0.035) * 1.4
    return np.tanh(2.5 * (head + skin)) * (velocity / 127)


def drum_loop():
    """The drum part over one loop, its ring and room wrapped onto the start so the loop is seamless."""
    n = int((LOOP + 3) * RATE)
    out = np.zeros(n)
    for bar, beat, f0, velocity in drum_hits():
        menu.place(out, bombo(f0, velocity), bar * BAR + beat * BEAT)
    ir_t = np.arange(int(1.2 * RATE)) / RATE
    ir = lfilter(*butter(1, 2500 / (RATE / 2)), menu.rng.standard_normal(len(ir_t)) * np.exp(-ir_t / 0.35)) * 0.02
    out = out + fftconvolve(out, ir)[:n]
    loop_n = int(LOOP * RATE)
    song = out[:loop_n].copy()
    song[:n - loop_n] += out[loop_n:]
    return song


def drum_hits():
    """A slow march on D, its answer on A, a soft roll into every fourth bar."""
    D, A = 73.42, 110.0
    hits = []
    for bar in range(BARS):
        bar_hits = [(0, D, 84), (2.5, A, 52)]
        if bar % 4 == 3:
            bar_hits += [(3, D, 58), (3.5, A, 64)]
        if bar >= 24:
            bar_hits += [(2, D, 60)]
        hits += [(bar, beat, f0, vel) for beat, f0, vel in bar_hits]
    return hits


def compose_pass(song_offset, flute, pan):
    def add(inst, bar, beat, beats, note, velocity):
        start = song_offset + bar * BAR + beat * BEAT
        inst.notes.append(pm.Note(velocity, note, start, start + beats * BEAT * 0.95))

    # Pan flute: the arpeggio in eighths, one cell per bar, raised so each cell sits in the flute's range.
    cells = [menu.chord_at(bar, 0) for bar in range(BARS)]
    line = menu.arpeggio(cells)
    for bar in range(BARS):
        if bar >= 24:
            continue
        cell = line[bar * 8:bar * 8 + 8]
        lift = 12 * int(np.ceil((62 - min(cell)) / 12))
        calling = any(b <= bar <= b + 1 for b, *_ in CALLS)
        for i, note in enumerate(cell):
            add(pan, bar, i / 2, 0.5, note + lift, 34 if calling else 46)
    # Flute: the calls. In the last section the pan flute doubles them a third above.
    for bar, beat, beats, note in call_notes():
        add(flute, bar, beat, beats, note + 12, 56 if bar >= 24 else 50)
        if bar >= 24 or (bar == 23 and beat == 3):
            add(pan, bar, beat, beats, third_above(note, menu.chord_at(bar % BARS, int(beat >= 2))) + 12, 38)



def main():
    if not SOUNDFONT.exists():
        SOUNDFONT.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['curl', '-sSLf', '-o', SOUNDFONT, SOUNDFONT_URL], check=True)
    OUT.mkdir(parents=True, exist_ok=True)
    song = pm.PrettyMIDI(initial_tempo=BPM)
    flute, pan = pm.Instrument(73, name='flute'), pm.Instrument(75, name='pan flute')
    # Three identical passes; the middle one starts with the first one's reverb tail, as the loop will.
    for r in range(3):
        compose_pass(r * LOOP, flute, pan)
    song.instruments += [flute, pan]
    midi, wav = HERE / 'battle.mid', HERE / 'battle.wav'
    song.write(str(midi))
    subprocess.run(['fluidsynth', '-ni', '-q', '-g', '0.5', '-r', str(RATE), '-o', 'synth.reverb.room-size=0.85',
                    '-o', 'synth.reverb.level=0.8', '-o', 'synth.chorus.active=0', '-F', wav, SOUNDFONT, midi], check=True)
    audio, rate = sf.read(wav, dtype='float32')
    start, end, pad = int(LOOP * rate), int(2 * LOOP * rate), int(PAD * rate)
    winds = lfilter(*butter(2, 250 / (RATE / 2), 'high'), audio[start:end], axis=0)
    drums = drum_loop()[:len(winds)]
    mix = winds / np.abs(winds).max() + 0.7 * drums[:, None] / np.abs(drums).max()
    loop = np.concatenate([mix[-pad:], mix, mix[:pad]])
    loop = np.tanh(loop / np.abs(loop).max() * 1.05)
    sf.write(wav, loop / np.abs(loop).max() * 0.7, rate)
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', wav, '-af', 'lowpass=f=4200',
                    '-c:a', 'libmp3lame', '-b:a', '160k', OUT / 'battle.mp3'], check=True)
    midi.unlink()
    wav.unlink()
    (OUT / 'battle.json').write_text(json.dumps(dict(pad=PAD, loop=LOOP, bpm=BPM, key='D dorian'), indent=1) + '\n')
    print(f'battle.mp3: {LOOP:.1f} s loop')


if __name__ == '__main__':
    main()
