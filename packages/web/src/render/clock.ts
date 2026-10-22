import type { SpectatorView } from "@castellan/shared";

/** How a frame arrived: the next tick, the same tick again (replay speed changed), or a seek elsewhere. */
export type Arrival = "tick" | "repeat" | "jump";

/** An instant of the presentation: `alpha` is the fraction (0..1) toward the next frame, `animationMs` the simulation time it stands for. */
export interface Moment { now: number; alpha: number; animationMs: number }

/**
 * Presentation time between game ticks. Frames arrive `tickMs` apart in presentation
 * milliseconds; between two, the clock interpolates and converts to simulation
 * milliseconds, so clips keyed to the game's own time play at replay speed. Pausing
 * freezes it.
 */
export class PlaybackClock {
  /** Presentation time of the current frame. */
  private frameAt = 0;
  private pausedAt?: number;
  private pauseOffset = 0;
  private replayTickMs = 100;
  private simulationMs = 0;
  private simulationTickMs = 100;

  /** `wall`: real time, or a virtual clock while recording. */
  constructor(private wall: () => number) {}

  /** Presentation milliseconds: the wall clock less the time spent paused; still while paused. */
  now(): number {
    return (this.pausedAt ?? this.wall()) - this.pauseOffset;
  }

  pause() {
    if (this.pausedAt === undefined) this.pausedAt = this.wall();
  }

  resume() {
    if (this.pausedAt === undefined) return;
    this.pauseOffset += this.wall() - this.pausedAt;
    this.pausedAt = undefined;
  }

  /** Where the presentation stands now. */
  moment(): Moment {
    const now = this.now();
    const alpha = Math.min(1, Math.max(0, (now - this.frameAt) / this.replayTickMs));
    return { now, alpha, animationMs: this.simulationMs + alpha * this.simulationTickMs };
  }

  /** Simulation milliseconds of the current frame. */
  get gameMs() { return this.simulationMs; }
  /** Simulation milliseconds per game tick. */
  get gameTickMs() { return this.simulationTickMs; }
  /** Presentation milliseconds until the next frame: the replay speed. */
  get tickMs() { return this.replayTickMs; }

  /**
   * The next game state; `tickMs` is how long until the one after it. Returns the moment
   * before it, from which movement continues. A repeated tick keeps its fraction instead
   * of rewinding the animation by a tick: the replay resends the frame on speed changes.
   */
  advance(view: Pick<SpectatorView, "tick" | "timeMs">, tickMs: number, arrival: Arrival): Moment {
    const before = this.moment();
    if (view.tick > 0 && Number.isFinite(view.timeMs)) this.simulationTickMs = view.timeMs / view.tick;
    this.simulationMs = view.timeMs ?? view.tick * this.simulationTickMs;
    this.replayTickMs = tickMs;
    this.frameAt = arrival === "repeat" ? before.now - before.alpha * tickMs : before.now;
    return before;
  }
}
