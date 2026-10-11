/**
 * Sound effects from sampled recordings (generated with MOSS-SoundEffect, see
 * assets/sounds). Each sample has a few variants picked at random so repeated
 * blows don't sound mechanical. Pitched samples are tuned to D or A, the game's
 * key, and play at exact octaves so nothing clashes; only noises get a slight
 * pitch jitter. A battle stays
 * listenable: each sound is rate-limited, capped in simultaneous voices and
 * quieter the more often it just played, and blows of the same tick are
 * spread over a few milliseconds. A wind loop plays underneath while a match
 * view asks for it, and music loops in the background: the theme in the menus,
 * the battle theme in matches (see assets/music).
 */
import type { SoundName } from "../render/renderer";

const MIN_GAP_MS: Partial<Record<SoundName, number>> = { sword: 90, hit: 160, arrow: 200, tower: 250, death: 90, spawn: 120, pick: 110, footstep: 180 };
const MAX_PER_SOUND: Partial<Record<SoundName, number>> = { sword: 3, hit: 2, arrow: 2, tower: 2, death: 3, pick: 2, footstep: 2 };
const MAX_VOICES = 12;
/** Sounds of the same tick start up to this late, so a volley isn't one blast. */
const SPREAD_S = 0.06;
const DENSITY_WINDOW_MS = 800;
const AMBIENT_GAIN = 0.22;
const MUSIC_GAIN: Record<Track, number> = { theme: 0.3, battle: 0.09 };
const MUSIC_FADE_S = 1.5;

export type Track = "theme" | "battle";

/** A seamless loop: `pad` seconds of the other end on each side of the file, `loop` long. */
interface LoopInfo {
  pad: number;
  loop: number;
}

/** `pad`: seconds of the loop's other end on each side of the ambient file; `loop`: its length. */
interface Manifest {
  pad: number;
  loop: number;
  files: Record<string, string[]>;
}

interface Layer {
  sample: string;
  gain?: number;
  delay?: number;
  rate?: number;
}

/** Samples tuned to D or A: never detuned. */
const PITCHED = new Set(["sword", "spawn", "horn", "fanfare"]);

/** Which samples each sound layers; by default a sound is its own sample. */
const MIX: Partial<Record<SoundName, Layer[]>> = {
  // An arrow is only its flight; a tower bolt is a slower, deeper swish.
  arrow: [{ sample: "whoosh" }],
  tower: [{ sample: "whoosh", rate: 0.75 }],
};

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private effects: GainNode | null = null;
  private listeners = new Set<() => void>();
  private buffers = new Map<string, AudioBuffer[]>();
  private ambientLoop = { pad: 0, loop: 0 };
  private last = new Map<SoundName, number>();
  private busyUntil: { name: SoundName; until: number }[] = [];
  private recent = new Map<SoundName, number[]>();
  private ambientHolders = 0;
  private ambient: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private musicHolders: Track[] = [];
  private music: { track: Track; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private tracks = new Map<Track, Promise<{ buffer: AudioBuffer; info: LoopInfo }>>();
  effectsMuted = (localStorage.getItem("aoa:effects-muted") ?? localStorage.getItem("aoa:muted")) === "1";
  musicMuted = (localStorage.getItem("aoa:music-muted") ?? localStorage.getItem("aoa:muted")) === "1";
  get muted() { return this.effectsMuted && this.musicMuted; }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  snapshot = () => `${this.effectsMuted}:${this.musicMuted}`;

  /** Browsers only allow audio after a user gesture: call this from one. */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.effects = this.ctx.createGain();
      this.effects.gain.value = this.effectsMuted ? 0 : 1;
      this.effects.connect(this.master);
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      void this.load(this.ctx);
    }
    void this.ctx.resume();
    void this.syncMusic();
  }

  get ready() {
    return !!this.ctx && this.ctx.state === "running";
  }

  setEffectsMuted(m: boolean) {
    this.effectsMuted = m;
    localStorage.setItem("aoa:effects-muted", m ? "1" : "0");
    if (!m) this.unlock();
    if (this.ctx && this.effects) this.effects.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.015);
    this.syncAmbient();
    this.listeners.forEach((listener) => listener());
  }

  setMusicMuted(m: boolean) {
    this.musicMuted = m;
    localStorage.setItem("aoa:music-muted", m ? "1" : "0");
    if (m) this.stopMusic();
    else this.unlock();
    this.listeners.forEach((listener) => listener());
  }

  /** Match views hold the wind while mounted: `useEffect(() => sfx.holdAmbient(), [])`. */
  holdAmbient() {
    this.ambientHolders++;
    this.syncAmbient();
    return () => {
      this.ambientHolders--;
      this.syncAmbient();
    };
  }

  /** Views hold their music while mounted: `useEffect(() => sfx.holdMusic("theme"), [])`. The latest holder wins. */
  holdMusic(track: Track) {
    this.musicHolders.push(track);
    void this.syncMusic();
    return () => {
      this.musicHolders.splice(this.musicHolders.lastIndexOf(track), 1);
      void this.syncMusic();
    };
  }

  play = (name: SoundName, pan = 0, volume = 1) => {
    const ctx = this.ctx;
    if (!ctx || this.effectsMuted || ctx.state !== "running" || volume <= 0.01) return;
    const layers = MIX[name] ?? [{ sample: name }];
    if (!this.buffers.has(layers[0].sample)) return;
    const nowMs = performance.now();
    if (nowMs - (this.last.get(name) ?? -1e9) < (MIN_GAP_MS[name] ?? 40)) return;
    this.busyUntil = this.busyUntil.filter((v) => v.until > nowMs);
    if (this.busyUntil.length >= MAX_VOICES) return;
    if (this.busyUntil.filter((v) => v.name === name).length >= (MAX_PER_SOUND[name] ?? MAX_VOICES)) return;
    this.last.set(name, nowMs);
    const recent = (this.recent.get(name) ?? []).filter((t) => t > nowMs - DENSITY_WINDOW_MS);
    recent.push(nowMs);
    this.recent.set(name, recent);
    const out = ctx.createStereoPanner();
    out.pan.value = pan * 0.8;
    const vol = ctx.createGain();
    vol.gain.value = volume / Math.sqrt(recent.length);
    out.connect(vol).connect(this.effects!);
    const jitter = 0.95 + Math.random() * 0.1;
    const spread = MIN_GAP_MS[name] ? Math.random() * SPREAD_S : 0;
    let dur = 0;
    for (const { sample, gain = 1, delay = 0, rate = 1 } of layers) {
      const variants = this.buffers.get(sample);
      if (!variants?.length) continue;
      const buffer = variants[Math.floor(Math.random() * variants.length)];
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const pitch = PITCHED.has(sample) ? rate : rate * jitter;
      source.playbackRate.value = pitch;
      const g = ctx.createGain();
      g.gain.value = gain;
      source.connect(g).connect(out);
      source.start(ctx.currentTime + spread + delay);
      dur = Math.max(dur, spread + delay + buffer.duration / pitch);
    }
    this.busyUntil.push({ name, until: nowMs + dur * 1000 });
  };

  private async load(ctx: AudioContext) {
    const { pad, loop, files }: Manifest = await fetch("/sounds/manifest.json").then((r) => r.json());
    this.ambientLoop = { pad, loop };
    await Promise.all(
      Object.entries(files).map(async ([sample, files]) => {
        const decoded = await Promise.all(files.map((f) => fetch(`/sounds/${f}`).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b))));
        this.buffers.set(sample, decoded);
        if (sample === "ambient") this.syncAmbient();
      }),
    );
  }

  private syncAmbient() {
    const ctx = this.ctx;
    const buffer = this.buffers.get("ambient")?.[0];
    if (this.ambientHolders <= 0 || this.effectsMuted) return this.stopAmbientSource();
    if (!ctx || !buffer || this.ambient) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    // Loop inside the padding, so encoder silence at the file's ends never plays.
    const { pad, loop } = this.ambientLoop;
    source.loopStart = pad;
    source.loopEnd = pad + loop;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(AMBIENT_GAIN, ctx.currentTime + 2);
    source.connect(gain).connect(this.effects!);
    source.start(ctx.currentTime, pad);
    this.ambient = { source, gain };
  }

  private loadTrack(ctx: AudioContext, track: Track) {
    let loaded = this.tracks.get(track);
    if (!loaded) {
      loaded = Promise.all([
        fetch(`/music/${track}.json`).then((r) => r.json() as Promise<LoopInfo>),
        fetch(`/music/${track}.mp3`).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)),
      ]).then(([info, buffer]) => ({ info, buffer }));
      this.tracks.set(track, loaded);
    }
    return loaded;
  }

  private async syncMusic() {
    const ctx = this.ctx;
    const want = this.musicMuted ? undefined : this.musicHolders.at(-1);
    if (this.music?.track === want) return;
    this.stopMusic();
    if (!ctx || !want) return;
    const { buffer, info } = await this.loadTrack(ctx, want);
    // Another change may have landed while this one was loading.
    if (this.musicMuted || this.musicHolders.at(-1) !== want || this.music) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = info.pad;
    source.loopEnd = info.pad + info.loop;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(MUSIC_GAIN[want], ctx.currentTime + MUSIC_FADE_S);
    source.connect(gain).connect(this.master!);
    source.start(ctx.currentTime, info.pad);
    this.music = { track: want, source, gain };
  }

  private stopMusic() {
    if (!this.music || !this.ctx) return;
    const { source, gain } = this.music;
    const t = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + MUSIC_FADE_S);
    source.stop(t + MUSIC_FADE_S + 0.05);
    this.music = null;
  }

  private stopAmbientSource() {
    if (!this.ambient || !this.ctx) return;
    const { source, gain } = this.ambient;
    const t = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.4);
    source.stop(t + 0.45);
    this.ambient = null;
  }
}

export const sfx = new Sfx();

// Browsers start audio only after a gesture: the first click or key anywhere starts the music.
for (const event of ["pointerdown", "keydown"]) addEventListener(event, () => !sfx.muted && sfx.unlock());
