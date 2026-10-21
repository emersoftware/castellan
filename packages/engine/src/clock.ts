/** Integer simulation time. Match alone advances tick; subsystems only read it. */
export class SimulationClock {
  tick = 0;
  constructor(readonly rate: number) {}

  /** Durations are rounded to the nearest tick, with a minimum of one. */
  ticks(ms: number): number { return Math.max(1, Math.round((ms * this.rate) / 1000)); }
  ms(ticks: number): number { return Math.round((ticks * 1000) / this.rate); }
}
