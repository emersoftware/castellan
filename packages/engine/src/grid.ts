/** Grid geometry and deterministic weighted pathfinding. */
import { dist } from "@castellan/shared";

export const DIRS: Record<string, [number, number]> = {
  N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1],
};
export const DIR_LIST = Object.values(DIRS);
/** The same directions rotated 180°: the second player's point of view. */
const DIR_LIST_ROTATED = DIR_LIST.map(([dx, dy]) => [-dx, -dy] as [number, number]);

/**
 * Direction order for each seat (see shared `seatToMap`): DIR_LIST turned with the
 * seat, so tie-breaks look the same from every corner.
 */
export const SEAT_DIRS: [number, number][][] = [
  DIR_LIST,
  DIR_LIST_ROTATED,
  DIR_LIST.map(([dx, dy]) => [-dy, dx] as [number, number]),
  DIR_LIST.map(([dx, dy]) => [dy, -dx] as [number, number]),
];

/**
 * Math.hypot as V8 computes it: squares scaled by the larger side (with two
 * values its Kahan compensation is always zero). The spec leaves Math.hypot
 * approximate and Safari's differs in the last bit, so replays simulated there
 * desync. Only /, *, + and sqrt: identical in every engine.
 */
export function hypot(dx: number, dy: number): number {
  const a = Math.abs(dx), b = Math.abs(dy);
  const max = Math.max(a, b);
  if (max === 0) return 0;
  const n = a / max, m = b / max;
  return Math.sqrt(n * n + m * m) * max;
}

export interface Grid {
  width: number;
  height: number;
  /** Tiles no unit can enter: buildings and deposits. Units are not static. */
  isStatic(x: number, y: number): boolean;
}

export function inBounds(g: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < g.width && y < g.height;
}

/** Whether terrain lets a unit at (x,y) step by (dx,dy): onto a free tile of the map, never squeezing diagonally between two static corners. */
export function canStep(g: Grid, x: number, y: number, dx: number, dy: number): boolean {
  if (!inBounds(g, x + dx, y + dy) || g.isStatic(x + dx, y + dy)) return false;
  return dx === 0 || dy === 0 || (!g.isStatic(x + dx, y) && !g.isStatic(x, y + dy));
}

/**
 * A* from (sx,sy) to any free tile within `range` of (gx,gy), ignoring units.
 * Returns the tiles to walk (excluding the start), [] if already there, or null
 * if no such tile is reachable. Deterministic: ties break by insertion order.
 * With `diagonalCost`, steps cost 10 straight and `diagonalCost` diagonally (e.g. 14).
 */
export function findPath(
  g: Grid, sx: number, sy: number, gx: number, gy: number, range: number,
  dirs: [number, number][] = DIR_LIST,
  /** Extra tiles to avoid this time (e.g. units blocking the way). */
  avoid?: Set<number>,
  diagonalCost?: number,
  /** Actual straight-step ticks when routing by rounded unit movement times. */
  straightCost?: number,
): number[] | null {
  const W = g.width;
  const H = g.height;
  const arrived = (x: number, y: number) => dist(x, y, gx, gy) <= range;
  // Lower bound on the cost left: the straight-line gap to the disc of radius range + 0.5.
  const h = (x: number, y: number) => {
    const gap = Math.max(0, hypot(x - gx, y - gy) - range - 0.5);
    if (straightCost !== undefined) return gap * Math.min(straightCost, diagonalCost! / Math.SQRT2);
    return diagonalCost ? gap * 9.9 : gap / 1.415;
  };
  if (arrived(sx, sy)) return [];
  const size = W * H;
  const cost = new Int32Array(size).fill(-1);
  const from = new Int32Array(size).fill(-1);
  const heap = new MinHeap();
  const start = sy * W + sx;
  cost[start] = 0;
  heap.push(h(sx, sy), 0, start);
  while (heap.size > 0) {
    const cur = heap.pop();
    const cx = cur % W;
    const cy = (cur / W) | 0;
    if (arrived(cx, cy)) {
      const path: number[] = [];
      for (let n = cur; n !== start; n = from[n]) path.push(n);
      return path.reverse();
    }
    const c = cost[cur];
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      const ni = ny * W + nx;
      if (!canStep(g, cx, cy, dx, dy) || avoid?.has(ni)) continue;
      const next = c + (!diagonalCost ? 1 : dx && dy ? diagonalCost : straightCost ?? 10);
      if (cost[ni] !== -1 && cost[ni] <= next) continue;
      cost[ni] = next;
      from[ni] = cur;
      heap.push(next + h(nx, ny), h(nx, ny), ni);
    }
  }
  return null;
}

/** Binary heap ordered by (f, h, insertion). */
class MinHeap {
  private f: number[] = [];
  private h: number[] = [];
  private seq: number[] = [];
  private v: number[] = [];
  private n = 0;
  get size() {
    return this.f.length;
  }
  push(f: number, h: number, v: number) {
    this.f.push(f);
    this.h.push(h);
    this.seq.push(this.n++);
    this.v.push(v);
    this.up(this.f.length - 1);
  }
  pop(): number {
    const top = this.v[0];
    const last = this.f.length - 1;
    this.swap(0, last);
    this.f.pop();
    this.h.pop();
    this.seq.pop();
    this.v.pop();
    this.down(0);
    return top;
  }
  private less(a: number, b: number) {
    return this.f[a] - this.f[b] || this.h[a] - this.h[b] || this.seq[a] - this.seq[b];
  }
  private swap(a: number, b: number) {
    [this.f[a], this.f[b]] = [this.f[b], this.f[a]];
    [this.h[a], this.h[b]] = [this.h[b], this.h[a]];
    [this.seq[a], this.seq[b]] = [this.seq[b], this.seq[a]];
    [this.v[a], this.v[b]] = [this.v[b], this.v[a]];
  }
  private up(i: number) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(i, p) >= 0) break;
      this.swap(i, p);
      i = p;
    }
  }
  private down(i: number) {
    const n = this.f.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < n && this.less(l, m) < 0) m = l;
      if (r < n && this.less(r, m) < 0) m = r;
      if (m === i) return;
      this.swap(i, m);
      i = m;
    }
  }
}
