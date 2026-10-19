/**
 * Public map geometry, derived only from the room's rules (GET /rules): seat
 * rotations, distances and the layout of a seat's corner. Nothing here reads
 * hidden state; every player can compute the same from the map description.
 */
import type { MapSpec } from "@castellan/shared";

export interface Pt { x: number; y: number }

/** Game distance: Euclidean rounded to the nearest whole tile (as in the rules). */
export function dist(a: Pt, b: Pt): number {
  const n = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const r = Math.floor(Math.sqrt(n));
  return n - r * r > r ? r + 1 : r;
}
/** Chebyshev distance: steps in 8 directions, ignoring the diagonal cost. */
const cheb = (a: Pt, b: Pt): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** Where a tile of the listed layout lands for seat 0..3 (as listed, 180°, 90°, 270°). */
function seatToMap({ x, y }: Pt, seat: number, { width: w, height: h }: MapSpec): Pt {
  switch (seat) {
    case 1: return { x: w - 1 - x, y: h - 1 - y };
    case 2: return { x: w - 1 - y, y: x };
    case 3: return { x: y, y: h - 1 - x };
    default: return { x, y };
  }
}
function mapToSeat({ x, y }: Pt, seat: number, { width: w, height: h }: MapSpec): Pt {
  switch (seat) {
    case 1: return { x: w - 1 - x, y: h - 1 - y };
    case 2: return { x: y, y: w - 1 - x };
    case 3: return { x: h - 1 - y, y: x };
    default: return { x, y };
  }
}

const listedCastle = (map: MapSpec): Pt => map.start.find((s) => s.kind === "castle") ?? { x: 4, y: 4 };
const seatBases = (map: MapSpec): Pt[] => Array.from({ length: map.seats ?? 2 }, (_, seat) => seatToMap(listedCastle(map), seat, map));

/** The seat whose listed start lands exactly on `p`, else the one whose base is nearest. */
function seatAt(map: MapSpec, p: Pt): number {
  const listed = map.start.find((s) => s.kind === "castle") ?? map.start[0];
  const bases = seatBases(map);
  if (listed) for (let seat = 0; seat < bases.length; seat++) {
    const q = seatToMap(listed, seat, map);
    if (q.x === p.x && q.y === p.y) return seat;
  }
  let best = 0;
  for (let s = 1; s < bases.length; s++) if (dist(p, bases[s]) < dist(p, bases[best])) best = s;
  return best;
}

export interface DepositCluster {
  id: string;
  tiles: Pt[];
  center: Pt;
  /** Initial mineral listed for these tiles. */
  mineral: number;
  /** home: inside my corner; flank: my seat's exposed deposits; center: shared; foreign: another seat's. */
  kind: "home" | "flank" | "center" | "foreign";
  /** The seat the deposits belong to (foreign/home/flank), undefined for shared ones. */
  seat?: number;
}

/** A seat's frame of reference: "local" coordinates are the listed layout, with home at the top-left. */
export class Frame {
  readonly seat: number;
  /** Seat 0 without an anchor; otherwise the seat whose corner holds it (a castle or the king), else the nearest. */
  constructor(readonly map: MapSpec, anchor?: Pt) {
    this.seat = anchor ? seatAt(map, anchor) : 0;
  }
  /** The map tile of a local point, clamped to the map. */
  toMap(p: Pt): Pt {
    const m = seatToMap(p, this.seat, this.map);
    return { x: Math.min(this.map.width - 1, Math.max(0, m.x)), y: Math.min(this.map.height - 1, Math.max(0, m.y)) };
  }
  toLocal(p: Pt): Pt { return mapToSeat(p, this.seat, this.map); }
  /** The corner tile of every seat's base (where its castle is listed), in map coordinates. */
  bases(): Pt[] { return seatBases(this.map); }

  /** Deposit tiles of every seat and the shared ones, grouped by adjacency, labelled from this seat's point of view. */
  clusters(): DepositCluster[] {
    const map = this.map, castle = listedCastle(map);
    const tiles: { x: number; y: number; amount: number; seat?: number; home: boolean }[] = [];
    for (let seat = 0; seat < (map.seats ?? 2); seat++) {
      for (const d of map.deposits) tiles.push({ ...seatToMap(d, seat, map), amount: d.amount, seat, home: dist(d, castle) <= 8 });
    }
    for (const d of map.sharedDeposits) tiles.push({ x: d.x, y: d.y, amount: d.amount, home: false });
    return groupNearby(tiles, 2, (a, b) => a.seat === b.seat && a.home === b.home).map((members, i) => {
      const seat = members[0].seat;
      const kind: DepositCluster["kind"] = seat === undefined ? "center" : seat !== this.seat ? "foreign" : members[0].home ? "home" : "flank";
      const center = { x: Math.round(members.reduce((n, t) => n + t.x, 0) / members.length), y: Math.round(members.reduce((n, t) => n + t.y, 0) / members.length) };
      return { id: `c${i + 1}`, tiles: members.map((m) => ({ x: m.x, y: m.y })), center, mineral: members.reduce((n, t) => n + t.amount, 0), kind, seat };
    });
  }
}

/** Single-link groups in input order: an item joins when `same` accepts it and it is within Chebyshev `radius` of a member. */
export function groupNearby<T extends Pt>(items: T[], radius: number, same: (a: T, b: T) => boolean): T[][] {
  const used = new Set<number>();
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    const group = [i];
    used.add(i);
    for (let k = 0; k < group.length; k++) for (let j = 0; j < items.length; j++) {
      if (used.has(j) || !same(items[j], items[group[k]])) continue;
      if (cheb(items[j], items[group[k]]) <= radius) { used.add(j); group.push(j); }
    }
    groups.push(group.map((g) => items[g]));
  }
  return groups;
}

/** Tiles within Chebyshev radius r of p, nearest first (ties by reading order), inside the map. */
export function ring(p: Pt, r: number, { width: w, height: h }: MapSpec): Pt[] {
  const out: Pt[] = [];
  for (let y = p.y - r; y <= p.y + r; y++) for (let x = p.x - r; x <= p.x + r; x++) {
    if (x < 0 || y < 0 || x >= w || y >= h || (x === p.x && y === p.y)) continue;
    out.push({ x, y });
  }
  return out.sort((a, b) => dist(a, p) - dist(b, p) || a.y - b.y || a.x - b.x);
}
