/**
 * The game's mixing rules, shared by the browser and the reel's soundtrack (packages/video/scripts/sfx.mjs):
 * each sound is rate-limited, capped in simultaneous voices and quieter the more often it just played; blows of
 * the same tick are spread over a few milliseconds, and only noises get a slight pitch jitter.
 */
import type { SoundName } from "@castellan/shared";

const MIN_GAP_MS: Partial<Record<SoundName, number>> = { sword: 90, hit: 160, arrow: 200, tower: 250, death: 90, spawn: 120, pick: 110, footstep: 180 };
const MAX_PER_SOUND: Partial<Record<SoundName, number>> = { sword: 3, hit: 2, arrow: 2, tower: 2, death: 3, pick: 2, footstep: 2 };
const MAX_VOICES = 12;
/** Sounds of the same tick start up to this late, so a volley isn't one blast. */
const SPREAD_S = 0.06;
const DENSITY_WINDOW_MS = 800;
/** The wind loop under a match view. */
export const AMBIENT_GAIN = 0.22;

/** Sounds whose own samples are tuned to D or A: never detuned. */
const PITCHED: ReadonlySet<string> = new Set<SoundName>(["sword", "spawn", "horn", "fanfare"]);

interface Layer { sample: string; gain?: number; delay?: number; rate?: number }
/** Which samples each sound layers; by default a sound is its own sample. */
const MIX: Partial<Record<SoundName, Layer[]>> = {
  // An arrow is only its flight; a tower bolt is a slower, deeper swish.
  arrow: [{ sample: "whoosh" }],
  tower: [{ sample: "whoosh", rate: 0.75 }],
};

/** One sample to start: which of its variants, seconds after the sound's spread, its playback rate and gain. */
export interface Voice { sample: string; variant: number; delay: number; rate: number; gain: number }

export class Mix {
  private last = new Map<SoundName, number>();
  private busy: { name: SoundName; until: number }[] = [];
  private recent = new Map<SoundName, number[]>();
  private random: () => number;

  /** `random`: seeded, so a re-render sounds the same. */
  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  /**
   * Admits `name` at `nowMs`: its gain, how late (seconds) it starts and its voices; nothing when it is too quiet,
   * its samples aren't loaded, or its rate limit or the voice cap leaves no room. `lengths(sample)`: the seconds
   * each loaded variant of a sample lasts.
   */
  play(name: SoundName, nowMs: number, volume: number, lengths: (sample: string) => readonly number[] | undefined): { gain: number; spread: number; voices: Voice[] } | undefined {
    if (volume <= 0.01) return;
    const layers = MIX[name] ?? [{ sample: name }];
    if (!lengths(layers[0].sample)) return;
    if (nowMs - (this.last.get(name) ?? -1e9) < (MIN_GAP_MS[name] ?? 40)) return;
    this.busy = this.busy.filter((v) => v.until > nowMs);
    if (this.busy.length >= MAX_VOICES) return;
    if (this.busy.filter((v) => v.name === name).length >= (MAX_PER_SOUND[name] ?? MAX_VOICES)) return;
    this.last.set(name, nowMs);
    const recent = (this.recent.get(name) ?? []).filter((t) => t > nowMs - DENSITY_WINDOW_MS);
    recent.push(nowMs);
    this.recent.set(name, recent);
    const jitter = 0.95 + this.random() * 0.1;
    const spread = MIN_GAP_MS[name] ? this.random() * SPREAD_S : 0;
    const voices: Voice[] = [];
    let end = 0;
    for (const { sample, gain = 1, delay = 0, rate = 1 } of layers) {
      const variants = lengths(sample);
      if (!variants?.length) continue;
      const variant = Math.floor(this.random() * variants.length);
      const pitch = PITCHED.has(sample) ? rate : rate * jitter;
      voices.push({ sample, variant, delay, rate: pitch, gain });
      end = Math.max(end, spread + delay + variants[variant] / pitch);
    }
    this.busy.push({ name, until: nowMs + end * 1000 });
    return { gain: volume / Math.sqrt(recent.length), spread, voices };
  }
}
