const MS_PER_SECOND = 1000;

/** Integer simulation time. Match alone advances tick; subsystems only read it. */
export class SimulationClock {
  tick = 0;
  constructor(readonly rate: number) {}

  /** Durations are rounded to the nearest tick, with a minimum of one. */
  ticks(ms: number): number { return Math.max(1, Math.round((ms * this.rate) / MS_PER_SECOND)); }
  ms(ticks: number): number { return Math.round((ticks * MS_PER_SECOND) / this.rate); }
}
