/**
 * The real-time loop over the HTTP API: wait for a fresh view, decide, act, repeat.
 */
import { client, query, type Client } from "@aoa/cli";
import type { MatchStatus, Order, OrderResult, Outcome, PlayerView, Ruleset } from "@aoa/shared";
import { outcomeText, routes } from "@aoa/shared";
import { Castellan } from "./core";
import { Journal } from "./journal";

export interface RuntimeOptions {
  server?: string;
  token: string;
  logDir: string;
  name?: string;
  /** Long-poll length per cycle (seconds, ≤30). */
  waitS?: number;
  echo?: (line: string) => void;
  /** Stop after this many ms regardless of the match (tests). */
  maxMs?: number;
}

export class Runtime {
  readonly client: Client;
  core!: Castellan;
  journal!: Journal;
  private lastOrders: Order[] = [];
  private cycleStats = { waits: 0, acts: 0, errors: 0, maxComputeMs: 0, computeMs: 0, maxCycleMs: 0 };

  constructor(readonly opts: RuntimeOptions) {
    this.client = client({ server: opts.server, token: opts.token, connector: "castellan" });
  }

  async run(): Promise<Outcome | undefined> {
    const echo = this.opts.echo ?? ((l: string) => console.error(l));
    const started = Date.now();
    const status = await this.client.get<{ room: string; player: string; status: MatchStatus }>(routes.status);
    const { ruleset } = await this.client.get<{ ruleset: Ruleset }>(routes.guide);
    this.journal = new Journal(this.opts.logDir, this.opts.name ?? `${status.room}-${status.player}`, echo);
    this.core = new Castellan({ rules: ruleset, log: (e) => this.journal.write(e) });
    this.journal.write({ t: Date.now(), tick: 0, type: "runtime", room: status.room, player: status.player, map: ruleset.map.name, server: this.client.server });
    let view: PlayerView | null = null;
    let backoff = 500;
    for (;;) {
      if (this.opts.maxMs && Date.now() - started > this.opts.maxMs) break;
      const cycleStart = Date.now();
      try {
        // During waiting/prep the clock is stopped; wait returns on the status change.
        const running: boolean = view !== null && view.status === "running";
        const waitS: number = running ? (this.opts.waitS ?? 1) : 30;
        view = await this.client.get<PlayerView>(`${routes.wait}${query({ max: waitS })}`);
        this.cycleStats.waits++;
        backoff = 500;
      } catch (e) {
        this.cycleStats.errors++;
        const msg = (e as Error).message;
        this.journal.write({ t: Date.now(), tick: view?.tick ?? 0, type: "runtime_error", message: msg });
        if (/^401/.test(msg)) throw e;
        await sleep(backoff);
        backoff = Math.min(5000, backoff * 2);
        continue;
      }
      const t0 = Date.now();
      const orders = this.core.step(view);
      const compute = Date.now() - t0;
      this.cycleStats.computeMs += compute;
      this.cycleStats.maxComputeMs = Math.max(this.cycleStats.maxComputeMs, compute);
      if (view.status === "finished") break;
      if (orders.length && view.status === "running") {
        try {
          const r = await this.client.post<{ results: OrderResult[]; view: PlayerView }>(routes.act, { orders });
          this.cycleStats.acts++;
          this.core.report(orders, r.results);
          this.lastOrders = orders;
          if (r.view.status === "finished") { this.core.step(r.view); break; }
        } catch (e) {
          this.cycleStats.errors++;
          this.journal.write({ t: Date.now(), tick: view.tick, type: "runtime_error", message: (e as Error).message, orders: orders.length });
        }
      }
      this.cycleStats.maxCycleMs = Math.max(this.cycleStats.maxCycleMs, Date.now() - cycleStart);
    }
    const outcome = view?.outcome;
    this.journal.write({ t: Date.now(), tick: view?.tick ?? 0, type: "match_end", outcome, cycles: this.cycleStats });
    const file = this.journal.save(this.core, { room: status.room, loop: this.cycleStats });
    echo(`castellan: ${outcome ? `${outcomeText(outcome)} (${outcome.reason})` : "stopped"}; summary ${file}`);
    return outcome;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
