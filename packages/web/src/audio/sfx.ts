/**
 * Sound effects synthesized with WebAudio in the spirit of the C64's SID chip:
 * pulse, triangle, saw and noise voices with short envelopes. No audio files.
 * Rate-limited per sound and capped in voices, so a battle stays listenable.
 */
import type { SoundName } from "../render/renderer";

const MIN_GAP_MS: Partial<Record<SoundName, number>> = { sword: 70, arrow: 60, tower: 90, coin: 160, death: 90, spawn: 120 };
const MAX_VOICES = 10;

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private last = new Map<SoundName, number>();
  private busyUntil: number[] = [];
  muted = localStorage.getItem("aoa:muted") === "1";

  /** Browsers only allow audio after a user gesture: call this from one. */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    void this.ctx.resume();
  }

  get ready() {
    return !!this.ctx && this.ctx.state === "running";
  }

  setMuted(m: boolean) {
    this.muted = m;
    localStorage.setItem("aoa:muted", m ? "1" : "0");
    if (!m) this.unlock();
  }

  play = (name: SoundName, pan = 0, volume = 1) => {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== "running" || volume <= 0.01) return;
    const nowMs = performance.now();
    if (nowMs - (this.last.get(name) ?? -1e9) < (MIN_GAP_MS[name] ?? 40)) return;
    this.busyUntil = this.busyUntil.filter((t) => t > nowMs);
    if (this.busyUntil.length >= MAX_VOICES) return;
    this.last.set(name, nowMs);
    const out = ctx.createStereoPanner();
    out.pan.value = pan * 0.8;
    const vol = ctx.createGain();
    vol.gain.value = volume;
    out.connect(vol).connect(this.master!);
    const dur = RECIPES[name](this.voice(ctx, out), ctx.currentTime);
    this.busyUntil.push(nowMs + dur * 1000);
  };

  private voice(ctx: AudioContext, dest: AudioNode): Voice {
    const noiseBuf = this.noiseBuf!;
    return {
      tone(type, f0, f1, t, dur, peak, attack = 0.004) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f0, t);
        if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
        const g = envelope(ctx, t, dur, peak, attack);
        o.connect(g).connect(dest);
        o.start(t);
        o.stop(t + dur + 0.02);
      },
      noise(filter, f0, f1, q, t, dur, peak, attack = 0.002) {
        const s = ctx.createBufferSource();
        s.buffer = noiseBuf;
        const bq = ctx.createBiquadFilter();
        bq.type = filter;
        bq.Q.value = q;
        bq.frequency.setValueAtTime(f0, t);
        if (f1 !== f0) bq.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
        const g = envelope(ctx, t, dur, peak, attack);
        s.connect(bq).connect(g).connect(dest);
        s.start(t, Math.random() * 0.5);
        s.stop(t + dur + 0.02);
      },
    };
  }
}

interface Voice {
  tone(type: OscillatorType, f0: number, f1: number, t: number, dur: number, peak: number, attack?: number): void;
  noise(filter: BiquadFilterType, f0: number, f1: number, q: number, t: number, dur: number, peak: number, attack?: number): void;
}

function envelope(ctx: AudioContext, t: number, dur: number, peak: number, attack: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  return g;
}

/** Each recipe schedules its voices and returns its length in seconds. */
const RECIPES: Record<SoundName, (v: Voice, t: number) => number> = {
  // Steel on steel: a bright noise burst and a short metallic ring.
  sword: (v, t) => {
    v.noise("bandpass", 3200, 2200, 4, t, 0.09, 0.5);
    v.tone("square", 1480 + Math.random() * 200, 1100, t, 0.07, 0.08);
    return 0.1;
  },
  // Bowstring snap and the arrow's whistle.
  arrow: (v, t) => {
    v.tone("triangle", 180, 90, t, 0.05, 0.25);
    v.noise("highpass", 4000, 900, 1, t + 0.01, 0.14, 0.12);
    return 0.16;
  },
  tower: (v, t) => {
    v.tone("triangle", 140, 70, t, 0.07, 0.35);
    v.noise("highpass", 3000, 700, 1, t + 0.01, 0.16, 0.1);
    return 0.18;
  },
  // A falling pulse, like a SID death blip.
  death: (v, t) => {
    v.tone("square", 520, 90, t, 0.28, 0.12);
    v.noise("lowpass", 900, 200, 1, t, 0.18, 0.15);
    return 0.3;
  },
  collapse: (v, t) => {
    v.noise("lowpass", 500, 90, 1, t, 0.9, 0.6, 0.01);
    v.tone("triangle", 70, 40, t, 0.6, 0.35);
    return 0.9;
  },
  spawn: (v, t) => {
    v.tone("square", 523, 523, t, 0.06, 0.08);
    v.tone("square", 784, 784, t + 0.06, 0.09, 0.08);
    return 0.16;
  },
  // Three hammer knocks.
  build: (v, t) => {
    for (let i = 0; i < 3; i++) v.noise("lowpass", 900, 300, 2, t + i * 0.09, 0.06, 0.45);
    return 0.3;
  },
  coin: (v, t) => {
    v.tone("square", 988, 988, t, 0.05, 0.06);
    v.tone("square", 1319, 1319, t + 0.05, 0.14, 0.06);
    return 0.2;
  },
  // A low war horn: detuned saws swelling in.
  horn: (v, t) => {
    for (const f of [110, 110.8, 164.8, 220]) v.tone("sawtooth", f, f * 0.98, t, 1.6, 0.09, 0.15);
    return 1.6;
  },
  fanfare: (v, t) => {
    [262, 330, 392, 523, 523].forEach((f, i) => v.tone("square", f, f, t + i * 0.14, i === 4 ? 0.9 : 0.16, 0.1));
    v.tone("triangle", 131, 131, t + 0.56, 0.9, 0.2);
    return 1.5;
  },
  chat: (v, t) => {
    v.tone("triangle", 660, 880, t, 0.06, 0.15);
    return 0.08;
  },
};

export const sfx = new Sfx();
