/**
 * The player's core: a pure function of its own view and memory. The runtime
 * feeds views (from the HTTP API) and sends back the orders; tests feed views
 * from a headless match. Nothing here reads anything a player cannot see.
 */
import type { Order, OrderResult, PlayerView, Ruleset } from "@castellan/shared";
import { Diplomacy } from "./diplomacy";
import { Executor } from "./executor";
import { newMemory, perceive, type Memory, type World } from "./perception";
import { Strategy, newPlan } from "./strategy";
import type { CoreStats, Episode, JournalEntry, Plan } from "./types";

export interface CoreOptions {
  rules: Ruleset;
  log?: (e: JournalEntry) => void;
  now?: () => number;
}

export class CastellanBot {
  readonly mem: Memory = newMemory();
  readonly plan: Plan = newPlan();
  readonly episodes: Episode[] = [];
  readonly stats: CoreStats = { cycles: 0, ordersSent: 0, ordersRejected: 0, rejectedByReason: {}, scriptErrors: 0,
    losses: {}, kills: {}, built: {}, chatSent: 0, chatReceived: 0, mineralDelivered: {} };
  readonly strategy: Strategy;
  readonly executor: Executor;
  readonly diplomacy: Diplomacy;
  world: World | null = null;
  private lastErrors = new Map<string, string>();
  private readonly now: () => number;
  private readonly logger: (e: JournalEntry) => void;

  constructor(readonly opts: CoreOptions) {
    this.now = opts.now ?? (() => Date.now());
    this.logger = opts.log ?? (() => {});
    const log = (e: Omit<JournalEntry, "t">) => this.logger({ t: this.now(), ...e } as JournalEntry);
    this.strategy = new Strategy(this.plan, this.episodes, { log });
    this.executor = new Executor(this.plan, this.strategy.roles, { log });
    this.diplomacy = new Diplomacy(this.plan, { log });
  }

  /** One decision cycle: observe, update plans, emit orders. */
  step(view: PlayerView): Order[] {
    const w = perceive(view, this.opts.rules, this.mem);
    this.world = w;
    this.stats.cycles++;
    this.account(w);
    if (view.status !== "running") return [];
    this.strategy.update(w, this.mem);
    this.joinAlly(w);
    const chat = this.diplomacy.update(w);
    const orders = this.executor.orders(w);
    this.stats.ordersSent += orders.length + chat.length;
    return [...orders, ...chat];
  }

  /** Results of the last orders: the executor adapts, the journal keeps the rejections. */
  report(orders: Order[], results: OrderResult[]): void {
    const tick = this.world?.tick ?? 0;
    this.executor.onResults(orders, results, tick);
    results.forEach((r) => { if (!r.ok) { this.stats.ordersRejected++; const k = r.reason.replace(/\d+/g, "N").slice(0, 60); this.stats.rejectedByReason[k] = (this.stats.rejectedByReason[k] ?? 0) + 1; } });
  }

  private account(w: World) {
    for (const ev of w.events) {
      if (ev.type === "death" && ev.owner === w.view.you) this.stats.losses[ev.kind] = (this.stats.losses[ev.kind] ?? 0) + 1;
      if (ev.type === "death" && ev.by === w.view.you && ev.owner !== w.view.you) this.stats.kills[ev.kind] = (this.stats.kills[ev.kind] ?? 0) + 1;
      if (ev.type === "spawn" && ev.owner === w.view.you && ev.builder) this.stats.built[ev.kind] = (this.stats.built[ev.kind] ?? 0) + 1;
      if (ev.type === "script_error" && ev.owner === w.view.you) {
        this.stats.scriptErrors++;
        if (this.lastErrors.get(ev.kind) !== ev.message) { this.lastErrors.set(ev.kind, ev.message); this.logger({ t: this.now(), tick: w.tick, type: "script_error", kind: ev.kind, message: ev.message }); }
      }
    }
    this.stats.chatSent = this.diplomacy.sent;
    this.stats.chatReceived = this.diplomacy.received;
  }

  /** Team play: answer an ally's "help (x,y)" or "attack (x,y)" when it is reasonable. */
  private joinAlly(w: World) {
    const reqs = this.diplomacy.allyRequests.filter((r) => w.tick - r.tick < 50);
    for (const r of reqs) {
      if (r.kind === "attack" && this.plan.posture === "boom" && w.army.length >= 5 && !this.plan.attack) {
        const target = { pos: r.at, owner: undefined };
        this.logger({ t: this.now(), tick: w.tick, type: "ally_request", kind: r.kind, at: r.at, from: r.from, action: "join attack" });
        (this.strategy as unknown as { startAttack: (w: World, t: { pos: { x: number; y: number } }, reason: string, source: string) => void }).startAttack(w, target, `ally ${r.from} asked`, `ally:${r.from}`);
      } else if (r.kind === "help" && this.plan.posture === "boom" && w.army.length >= 4) {
        this.logger({ t: this.now(), tick: w.tick, type: "ally_request", kind: r.kind, at: r.at, from: r.from, action: "noted" });
      }
    }
    this.diplomacy.allyRequests = this.diplomacy.allyRequests.filter((r) => w.tick - r.tick < 50);
  }

  /** What happened, for the journal summary. */
  summary() {
    const w = this.world;
    return {
      tick: w?.tick ?? 0, outcome: w?.view.outcome ?? null, you: w?.view.you, posture: this.plan.posture, stats: this.stats, episodes: this.episodes,
      plan: { expansion: this.plan.expansion, keep: this.plan.keep.status, builds: this.plan.builds.map((b) => ({ id: b.id, label: b.label, status: b.status, reason: b.reason, attempts: b.attempts })), truces: this.plan.truces, research: this.plan.research },
      executorRejected: this.executor.rejected,
    };
  }
}

export { Memory, World };
