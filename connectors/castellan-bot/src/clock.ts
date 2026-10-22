import type { PlayerView } from "@castellan/shared";

/**
 * Game time as the observations show it. Each room chooses its tick rate and the
 * view does not state it, but every running view reports both its tick and its
 * game time, so the length of a tick is learned from them.
 */
export class ObservedClock {
  /** Until the clock has advanced, the server's default of 10 ticks per second stands in. */
  private msPerTick = 100;

  observe(view: PlayerView): void {
    if (view.tick > 0 && view.timeMs > 0) this.msPerTick = view.timeMs / view.tick;
  }

  /** How many ticks last `seconds` of game time. */
  ticks(seconds: number): number { return Math.round((seconds * 1000) / this.msPerTick); }

  /** The tick at game time `ms`. */
  tickAt(ms: number): number { return Math.round(ms / this.msPerTick); }

  /** Game seconds at `tick`. */
  seconds(tick: number): number { return (tick * this.msPerTick) / 1000; }
}
