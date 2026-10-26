import type { OrderEndReason, PlayerId, Ruleset, UnitOrder } from "@castellan/shared";
import type { ScriptActionResult } from "@castellan/sandbox";
import type { Entity, Intent } from "./entities";
import type { SimulationClock } from "./clock";
import type { Board } from "./board";
import { dist, mapToSeat } from "@castellan/shared";
import { DIR_LIST, SEAT_DIRS, STRAIGHT_STEP_COST, canStep, findPath, inBounds, type Grid } from "./grid";

/** Consecutive blocked steps before a unit plans around the units next to it. */
const BLOCKED_STEPS_BEFORE_DETOUR = 3;
const QUARTER_TURN_DIRECTIONS = [SEAT_DIRS[0], SEAT_DIRS[2], SEAT_DIRS[1], SEAT_DIRS[3]];

/** Owns routes, arrival and its allocation, and seat-relative spatial choices; commits moves to the board. */
export class Movement {
  constructor(private rules: () => Ruleset, private clock: Readonly<SimulationClock>, private board: Board,
    private entities: ReadonlyMap<string, Entity>,
    private sideOf: (owner: PlayerId) => number, private hostile: (a: PlayerId, b: PlayerId) => boolean) {}

  /** How near (x, y) counts as there: a static tile cannot be entered, so standing next to it arrives. */
  arrivalRange(owner: PlayerId, x: number, y: number, range: number): number {
    return range === 0 && this.gridFor(owner).isStatic(x, y) ? 1 : range;
  }

  arrived(e: Entity, x: number, y: number, range: number): boolean {
    return dist(e.x, e.y, x, y) <= this.arrivalRange(e.owner, x, y, range);
  }

  /** Commit movement once per entity, preserving priority and simultaneous-order feedback. */
  advance(ordered: readonly Entity[], intents: ReadonlyMap<string, Intent>, feedback: {
    result(entity: Entity, status: ScriptActionResult["status"], effect?: ScriptActionResult["effect"], reason?: string): void;
    endOrder(entity: Entity, reason: OrderEndReason): void;
  }) {
    const T = this.clock.tick;
    const moved = new Set<string>();
    const visiting = new Set<string>();
    const move = (e: Entity) => {
      if (moved.has(e.id) || visiting.has(e.id)) return;
      const it = intents.get(e.id);
      if (!it || (it.t !== "goto" && it.t !== "dir")) return;
      visiting.add(e.id);
      if (this.rules().coordinatedMovement && e.spec.moveMs && T >= e.nextMove) {
        const next = it.t === "dir" ? (e.y + it.dy) * this.board.width + e.x + it.dx : this.route(e, it.x, it.y, it.range)?.[0];
        const nx = it.t === "dir" ? e.x + it.dx : next === undefined ? e.x : next % this.board.width;
        const ny = it.t === "dir" ? e.y + it.dy : next === undefined ? e.y : Math.floor(next / this.board.width);
        const grid = this.gridFor(e.owner);
        const occupant = next === undefined ? undefined : this.entities.get(this.board.occupant(next % this.board.width, Math.floor(next / this.board.width)) ?? "");
        // Never push idle units, borrow an enemy's turn, or exchange occupied tiles.
        if (occupant && occupant.id !== e.id && !this.hostile(e.owner, occupant.owner) && canStep(grid, e.x, e.y, nx - e.x, ny - e.y)) move(occupant);
      }
      visiting.delete(e.id);
      moved.add(e.id);
      if (!e.spec.moveMs) { feedback.result(e, "invalid", undefined, "unit cannot move"); return; }
      if (T < e.nextMove) { feedback.result(e, "cooldown", undefined, "movement cooldown"); return; }
      const before = { x: e.x, y: e.y };
      if (it.t === "dir") {
        if (this.canStep(e, e.x + it.dx, e.y + it.dy)) this.moveTo(e, e.x + it.dx, e.y + it.dy);
      } else if (!this.walk(e, it.x, it.y, it.range) && e.order && !e.orderSuspended) {
        feedback.endOrder(e, "unreachable");
      }
      if (before.x !== e.x || before.y !== e.y) feedback.result(e, "acted", "move");
      else if (it.t === "goto" && this.arrived(e, it.x, it.y, it.range)) feedback.result(e, "arrived");
      else feedback.result(e, "blocked", undefined, "step blocked or destination unreachable");
    };
    for (const e of ordered) move(e);
  }

  /** Doors remain solid for placement, but pathfinding depends on the moving side. */
  gridFor(owner: PlayerId): Grid {
    if (!this.board.hasDoors()) return this.board;
    return { width: this.board.width, height: this.board.height, isStatic: (x, y) => {
      const door = this.board.door(x, y);
      if (door) return this.hostile(owner, this.entities.get(door)!.owner);
      return this.board.isStatic(x, y);
    } };
  }

  private pathDiagonalCost(e: Entity): number {
    return this.rules().tickPathCosts ? this.clock.ticks(e.spec.moveMs! * this.rules().diagonalMove) : Math.round(STRAIGHT_STEP_COST * this.rules().diagonalMove);
  }

  private pathStraightCost(e: Entity): number | undefined {
    return this.rules().tickPathCosts ? this.clock.ticks(e.spec.moveMs!) : undefined;
  }

  canStep(e: Entity, x: number, y: number): boolean {
    const grid = this.gridFor(e.owner);
    return canStep(grid, e.x, e.y, x - e.x, y - e.y) && this.board.occupant(x, y) === null;
  }

  private moveTo(e: Entity, x: number, y: number) {
    this.board.move(e, x, y);
    const diagonal = x !== e.x && y !== e.y;
    e.lastStep = { dx: x - e.x, dy: y - e.y, tick: this.clock.tick };
    e.x = x;
    e.y = y;
    e.nextMove = this.clock.tick + this.clock.ticks(e.spec.moveMs! * (diagonal ? this.rules().diagonalMove : 1));
  }

  private route(e: Entity, gx: number, gy: number, range: number): number[] | null {
    const grid = this.gridFor(e.owner);
    range = this.arrivalRange(e.owner, gx, gy, range);
    if (dist(e.x, e.y, gx, gy) <= range) return [];
    const W = grid.width;
    const key = `${gx},${gy},${range},${this.board.version()}` + (this.rules().tickPathCosts ? `,${this.pathStraightCost(e)},${this.pathDiagonalCost(e)}` : "");
    const adjacent = (i: number) => dist(e.x, e.y, i % W, (i / W) | 0) === 1;
    // A cached null means "unreachable" and stays valid until the key changes.
    const stale = e.pathKey !== key || (e.path !== null && (e.path.length === 0 || !adjacent(e.path[0])));
    if (stale) {
      e.path = findPath(grid, e.x, e.y, gx, gy, range, this.directions(e.owner), undefined, this.pathDiagonalCost(e), this.pathStraightCost(e));
      e.pathKey = key;
    }
    return e.path;
  }

  /** Assign only explicit same-owner move orders; scripts keep exact destinations. */
  assignTargets() {
    const groups = new Map<string, Entity[]>();
    for (const e of this.entities.values()) {
      if (e.order?.type !== "move") continue;
      const key = `${e.owner},${e.order.x},${e.order.y}`;
      const group = groups.get(key) ?? []; group.push(e); groups.set(key, group);
    }
    // Compute each owner's static connected components lazily. This bounds
    // destination allocation even if every nearby candidate is unreachable.
    const components = new Map<PlayerId, Map<number, Set<number>>>();
    const reachable = (e: Entity) => {
      const grid = this.gridFor(e.owner), W = grid.width;
      const cache = components.get(e.owner) ?? new Map<number, Set<number>>();
      components.set(e.owner, cache);
      const origin = e.y * W + e.x;
      if (cache.has(origin)) return cache.get(origin)!;
      const seen = new Set([origin]), queue = [origin];
      for (let i = 0; i < queue.length; i++) {
        const x = queue[i] % W, y = Math.floor(queue[i] / W);
        for (const [dx, dy] of this.directions(e.owner)) {
          const nx = x + dx, ny = y + dy, tile = ny * W + nx;
          if (seen.has(tile) || !canStep(grid, x, y, dx, dy)) continue;
          seen.add(tile); queue.push(tile);
        }
      }
      for (const tile of seen) cache.set(tile, seen);
      return seen;
    };
    const reserved = new Map<PlayerId, Set<number>>();
    for (const group of groups.values()) {
      for (const e of group) {
        const grid = this.gridFor(e.owner);
        if (e.moveTarget && grid.isStatic(e.moveTarget.x, e.moveTarget.y)) delete e.moveTarget;
        const target = e.moveTarget ?? (group.length === 1 ? e.order as Extract<UnitOrder, {type: "move"}> : undefined);
        const tiles = reserved.get(e.owner) ?? new Set<number>();
        if (target) tiles.add(target.y * grid.width + target.x);
        reserved.set(e.owner, tiles);
      }
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const goal = group[0].order as Extract<UnitOrder, { type: "move" }>;
      const grid = this.gridFor(group[0].owner), W = grid.width;
      const members = new Set(group.map(e => e.id));
      const claimed = reserved.get(group[0].owner)!;
      if (group.every(e => e.moveTarget)) continue;
      // A narrow passage may need one approach-side tile per arriving unit.
      const radius = group.length;
      const candidates: { x: number; y: number }[] = [];
      for (let y = Math.max(0, goal.y - radius); y <= Math.min(grid.height - 1, goal.y + radius); y++) {
        for (let x = Math.max(0, goal.x - radius); x <= Math.min(W - 1, goal.x + radius); x++) {
          const occupant = this.board.occupant(x, y);
          if (!grid.isStatic(x, y) && (occupant === null || members.has(occupant))) candidates.push({ x, y });
        }
      }
      const squared = (a: {x: number; y: number}, b: {x: number; y: number}) => (a.x-b.x)**2 + (a.y-b.y)**2;
      // Closest units claim first; the existing entity order breaks exact ties.
      for (const e of [...group].sort((a,b) => squared(a,goal) - squared(b,goal))) {
        if (e.moveTarget) continue;
        candidates.sort((a,b) => squared(a,goal) - squared(b,goal) || squared(a,e) - squared(b,e)
          || this.readingKey(a.x,a.y,this.sideOf(e.owner)) - this.readingKey(b.x,b.y,this.sideOf(e.owner)));
        const accessible = reachable(e);
        if (!grid.isStatic(goal.x, goal.y) && !accessible.has(goal.y * W + goal.x)) continue;
        for (const tile of candidates) {
          if (claimed.has(tile.y * W + tile.x) || !accessible.has(tile.y * W + tile.x)) continue;
          // Do not ask followers to pass a leader that has already parked at the goal.
          if ((tile.x-goal.x)*(e.x-goal.x) + (tile.y-goal.y)*(e.y-goal.y) < 0) continue;
          e.moveTarget = { ...tile }; claimed.add(tile.y * W + tile.x); break;
        }
      }
    }
  }

  /** One step toward being within `range` of (gx,gy). False if unreachable. */
  private walk(e: Entity, gx: number, gy: number, range: number): boolean {
    const grid = this.gridFor(e.owner);
    range = this.arrivalRange(e.owner, gx, gy, range);
    if (dist(e.x, e.y, gx, gy) <= range) return true;
    const W = this.board.width;
    this.route(e, gx, gy, range);
    if (!e.path) return false;
    if (e.path.length === 0) return true;
    const next = e.path[0];
    const nx = next % W;
    const ny = (next / W) | 0;
    if (this.canStep(e, nx, ny)) {
      this.moveTo(e, nx, ny);
      e.path.shift();
      e.blocked = 0;
      return true;
    }
    // A unit is in the way. First try a free tile that still gets closer.
    e.blocked++;
    const h = (x: number, y: number) => Math.max(0, dist(x, y, gx, gy) - range);
    const here = h(e.x, e.y);
    let best: [number, number] | null = null;
    for (const [dx, dy] of this.directions(e.owner)) {
      const x = e.x + dx;
      const y = e.y + dy;
      if (h(x, y) < here && this.canStep(e, x, y) && (!best || h(x, y) < h(best[0], best[1]))) best = [x, y];
    }
    // Still stuck after a moment: plan around the units next to us.
    if (!best && e.blocked >= BLOCKED_STEPS_BEFORE_DETOUR) {
      const avoid = new Set<number>();
      for (const [dx, dy] of DIR_LIST) {
        const x = e.x + dx;
        const y = e.y + dy;
        if (inBounds(this.board, x, y) && this.board.occupant(x, y) !== null) avoid.add(y * W + x);
      }
      const detour = findPath(grid, e.x, e.y, gx, gy, range, this.directions(e.owner), avoid, this.pathDiagonalCost(e), this.pathStraightCost(e));
      if (detour && detour.length > 0 && this.canStep(e, detour[0] % W, (detour[0] / W) | 0)) best = [detour[0] % W, (detour[0] / W) | 0];
    }
    if (best) {
      this.moveTo(e, best[0], best[1]);
      e.path = null;
      e.pathKey = "";
      e.blocked = 0;
    }
    return true;
  }

  directions(owner: PlayerId): [number, number][] {
    const side = this.sideOf(owner), origins = this.rules().map.origins;
    if (origins) return QUARTER_TURN_DIRECTIONS[origins[side].rotation ?? 0];
    return SEAT_DIRS[side] ?? DIR_LIST;
  }

  /** Is `a` closer to `e` than `b`? Ties go to the tile first in `e`'s owner's reading order. */
  closer(e: Entity, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
    const da = dist(e.x, e.y, a.x, a.y);
    const db = dist(e.x, e.y, b.x, b.y);
    if (da !== db) return da < db;
    const side = this.sideOf(e.owner);
    return this.readingKey(a.x, a.y, side) < this.readingKey(b.x, b.y, side);
  }

  /** Position of a tile in a seat's own reading order (row by row from its corner). */
  readingKey(x: number, y: number, side: number): number {
    const { width: W, height: H } = this.rules().map;
    const [lx, ly] = mapToSeat(x, y, side, W, H, this.rules().map.origins);
    return ly * W + lx;
  }

  freeNeighbor(x: number, y: number, owner: PlayerId): [number, number] | null {
    for (const [dx, dy] of this.directions(owner)) {
      const nx = x + dx;
      const ny = y + dy;
      if (inBounds(this.board, nx, ny) && !this.gridFor(owner).isStatic(nx, ny) && this.board.occupant(nx, ny) === null) return [nx, ny];
    }
    return null;
  }

}
