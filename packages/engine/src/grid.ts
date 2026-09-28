/** Grid geometry and pathfinding. Distances are Chebyshev: a diagonal step costs 1. */

export const DIRS: Record<string, [number, number]> = {
  N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1],
};
export const DIR_LIST = Object.values(DIRS);
/** The same directions rotated 180°: the second player's point of view. */
export const DIR_LIST_ROTATED = DIR_LIST.map(([dx, dy]) => [-dx, -dy] as [number, number]);

/**
 * Direction order for each seat (see `seatToMap`): DIR_LIST turned with the
 * seat, so tie-breaks look the same from every corner.
 */
export const SEAT_DIRS: [number, number][][] = [
  DIR_LIST,
  DIR_LIST_ROTATED,
  DIR_LIST.map(([dx, dy]) => [-dy, dx] as [number, number]),
  DIR_LIST.map(([dx, dy]) => [dy, -dx] as [number, number]),
];

/**
 * Where a tile of the map's layout lands for seat 0..3: as listed, rotated
 * 180°, 90° clockwise, 270°. Seats 2 and 3 need a square map.
 */
export function seatToMap(x: number, y: number, seat: number, w: number, h: number): [number, number] {
  switch (seat) {
    case 1: return [w - 1 - x, h - 1 - y];
    case 2: return [w - 1 - y, x];
    case 3: return [y, h - 1 - x];
    default: return [x, y];
  }
}

/** The inverse of `seatToMap`: a map tile in the seat's own layout coordinates. */
export function mapToSeat(x: number, y: number, seat: number, w: number, h: number): [number, number] {
  switch (seat) {
    case 1: return [w - 1 - x, h - 1 - y];
    case 2: return [y, w - 1 - x];
    case 3: return [h - 1 - y, x];
    default: return [x, y];
  }
}

export function cheb(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
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

/** Diagonal moves may not squeeze between two static tiles' corners. */
export function canCross(g: Grid, x: number, y: number, dx: number, dy: number): boolean {
  if (dx === 0 || dy === 0) return true;
  return !g.isStatic(x + dx, y) && !g.isStatic(x, y + dy);
}

/**
 * A* from (sx,sy) to any free tile within `range` of (gx,gy), ignoring units.
 * Returns the tiles to walk (excluding the start), [] if already there, or null
 * if no such tile is reachable. Deterministic: ties break by insertion order.
 */
export function findPath(
  g: Grid, sx: number, sy: number, gx: number, gy: number, range: number,
  dirs: [number, number][] = DIR_LIST,
  /** Extra tiles to avoid this time (e.g. units blocking the way). */
  avoid?: Set<number>,
): number[] | null {
  const W = g.width;
  const H = g.height;
  const h = (x: number, y: number) => Math.max(0, cheb(x, y, gx, gy) - range);
  if (h(sx, sy) === 0) return [];
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
    if (h(cx, cy) === 0) {
      const path: number[] = [];
      for (let n = cur; n !== start; n = from[n]) path.push(n);
      return path.reverse();
    }
    const c = cost[cur];
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (g.isStatic(nx, ny) || avoid?.has(ni) || !canCross(g, cx, cy, dx, dy)) continue;
      if (cost[ni] !== -1 && cost[ni] <= c + 1) continue;
      cost[ni] = c + 1;
      from[ni] = cur;
      heap.push(c + 1 + h(nx, ny), h(nx, ny), ni);
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
