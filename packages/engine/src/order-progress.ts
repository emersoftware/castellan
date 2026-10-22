import type { OrderProgress, UnitOrder } from "@castellan/shared";
import type { Entity } from "./entities";
import type { SimulationClock } from "./clock";
import { dist } from "@castellan/shared";

interface OrderHistory {
  order: UnitOrder;
  issuedTick: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastMovedAtTick: number;
  suspendedSince?: number;
  suspendedTicks: number;
  suspensions: number;
  steps: number;
  scriptActions: OrderProgress["scriptActions"];
  blockedTicks: number;
}

/** View-only counters: bounded by living orders and never consulted by simulation or hashing. */
export class OrderTracker {
  private history = new WeakMap<Entity, OrderHistory>();
  constructor(private clock: Readonly<SimulationClock>) {}

  begin(e: Entity, order: UnitOrder) {
    this.history.set(e, { order, issuedTick: this.clock.tick, startX: e.x, startY: e.y,
      lastX: e.x, lastY: e.y, lastMovedAtTick: this.clock.tick,
      suspendedTicks: 0, suspensions: 0, steps: 0, scriptActions: {}, blockedTicks: 0 });
  }

  clear(e: Entity) { this.history.delete(e); }

  record(e: Entity) {
    const h = this.history.get(e);
    if (!h) return;
    if (h.order !== e.order) { this.history.delete(e); return; }
    if (e.x !== h.lastX || e.y !== h.lastY) {
      h.steps++;
      h.lastMovedAtTick = this.clock.tick + 1;
      h.lastX = e.x; h.lastY = e.y;
    }
    if (e.orderSuspended) {
      if (h.suspendedSince === undefined) { h.suspendedSince = this.clock.tick; h.suspensions++; }
      h.suspendedTicks++;
    } else h.suspendedSince = undefined;
    const result = e.actionResult;
    if (result?.tick !== this.clock.tick) return;
    if (result.status === "blocked") h.blockedTicks++;
    if (e.orderSuspended && result.source === "script" && result.status === "acted" && result.effect) {
      h.scriptActions[result.effect] = (h.scriptActions[result.effect] ?? 0) + 1;
    }
  }

  view(e: Entity): OrderProgress | undefined {
    const h = this.history.get(e);
    if (!h || h.order !== e.order) return;
    return {
      ageMs: this.clock.ms(this.clock.tick - h.issuedTick), suspendedMs: this.clock.ms(h.suspendedTicks),
      currentSuspensionMs: h.suspendedSince === undefined ? 0 : this.clock.ms(this.clock.tick - h.suspendedSince),
      suspensions: h.suspensions,
      movement: { steps: h.steps, netTiles: dist(h.startX, h.startY, e.x, e.y),
        stationaryMs: this.clock.ms(this.clock.tick - h.lastMovedAtTick),
        ...(e.order?.type === "move" ? { towardDestination: dist(h.startX, h.startY, e.order.x, e.order.y) - dist(e.x, e.y, e.order.x, e.order.y) } : {}),
      },
      scriptActions: { ...h.scriptActions }, blockedMs: this.clock.ms(h.blockedTicks),
    };
  }
}
