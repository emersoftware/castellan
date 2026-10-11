/**
 * Public map geometry, derived only from the room's rules (GET /rules): seat
 * rotations, distances and the layout of a seat's corner. Nothing here reads
 * hidden state; every player can compute the same from the map description.
 */
import type { MapSpec } from "@aoa/shared";

export interface Pt { x: number; y: number }

/** Game distance: Euclidean rounded to the nearest whole tile (as in the rules). */
export function dist(ax: number, ay: number, bx: number, by: number): number {
  const n = (ax - bx) ** 2 + (ay - by) ** 2;
  const r = Math.floor(Math.sqrt(n));
  return n - r * r > r ? r + 1 : r;
}
export const distP = (a: Pt, b: Pt): number => dist(a.x, a.y, b.x, b.y);
/** Chebyshev distance: steps in 8 directions, ignoring the diagonal cost. */
export const cheb = (a: Pt, b: Pt): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** Where a tile of the listed layout lands for seat 0..3 (as listed, 180°, 90°, 270°). */
export function seatToMap(x: number, y: number, seat: number, w: number, h: number): Pt {
  switch (seat) {
    case 1: return { x: w - 1 - x, y: h - 1 - y };
    case 2: return { x: w - 1 - y, y: x };
    case 3: return { x: y, y: h - 1 - x };
    default: return { x, y };
  }
}
export function mapToSeat(x: number, y: number, seat: number, w: number, h: number): Pt {
  switch (seat) {
    case 1: return { x: w - 1 - x, y: h - 1 - y };
    case 2: return { x: y, y: w - 1 - x };
    case 3: return { x: h - 1 - y, y: x };
    default: return { x, y };
  }
}

/** A seat's frame of reference: "local" coordinates are the listed layout, with home at the top-left. */
export class Frame {
  constructor(readonly seat: number, readonly width: number, readonly height: number) {}
  toMap(p: Pt): Pt { return seatToMap(p.x, p.y, this.seat, this.width, this.height); }
  toLocal(p: Pt): Pt { return mapToSeat(p.x, p.y, this.seat, this.width, this.height); }
  inBounds(p: Pt): boolean { return p.x >= 0 && p.y >= 0 && p.x < this.width && p.y < this.height; }
  /** The map tile of a local point, clamped to the map. */
  local(x: number, y: number): Pt {
    const p = this.toMap({ x, y });
    return { x: Math.min(this.width - 1, Math.max(0, p.x)), y: Math.min(this.height - 1, Math.max(0, p.y)) };
  }
}

/** Which seat starts at the corner where `castle` stands (null if it matches none). */
export function detectSeat(map: MapSpec, castle: Pt): number | null {
  const listed = map.start.find((s) => s.kind === "castle") ?? map.start[0];
  if (!listed) return null;
  const seats = map.seats ?? 2;
  for (let seat = 0; seat < seats; seat++) {
    const p = seatToMap(listed.x, listed.y, seat, map.width, map.height);
    if (p.x === castle.x && p.y === castle.y) return seat;
  }
  return null;
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

/** Deposit tiles of every seat and the shared ones, grouped by adjacency, labelled from `mySeat`'s point of view. */
export function depositClusters(map: MapSpec, mySeat: number): DepositCluster[] {
  const seats = map.seats ?? 2;
  const listedCastle = map.start.find((s) => s.kind === "castle") ?? { x: 4, y: 4 };
  const tiles: { p: Pt; amount: number; seat?: number; home: boolean }[] = [];
  for (let seat = 0; seat < seats; seat++) {
    for (const d of map.deposits) {
      const p = seatToMap(d.x, d.y, seat, map.width, map.height);
      tiles.push({ p, amount: d.amount, seat, home: dist(d.x, d.y, listedCastle.x, listedCastle.y) <= 8 });
    }
  }
  for (const d of map.sharedDeposits) tiles.push({ p: { x: d.x, y: d.y }, amount: d.amount, home: false });
  // Single-link clustering of tiles within 2 of each other that share a seat label.
  const used = new Set<number>();
  const out: DepositCluster[] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (used.has(i)) continue;
    const group = [i];
    used.add(i);
    for (let k = 0; k < group.length; k++) {
      for (let j = 0; j < tiles.length; j++) {
        if (used.has(j) || tiles[j].seat !== tiles[group[k]].seat || tiles[j].home !== tiles[group[k]].home) continue;
        if (cheb(tiles[j].p, tiles[group[k]].p) <= 2) { used.add(j); group.push(j); }
      }
    }
    const members = group.map((g) => tiles[g]);
    const cx = Math.round(members.reduce((n, t) => n + t.p.x, 0) / members.length);
    const cy = Math.round(members.reduce((n, t) => n + t.p.y, 0) / members.length);
    const seat = members[0].seat;
    const kind: DepositCluster["kind"] = seat === undefined ? "center" : seat !== mySeat ? "foreign" : members[0].home ? "home" : "flank";
    out.push({ id: `c${out.length + 1}`, tiles: members.map((m) => m.p), center: { x: cx, y: cy }, mineral: members.reduce((n, t) => n + t.amount, 0), kind, seat });
  }
  return out;
}

/** The corner tile of every seat's base (where its castle is listed), in map coordinates. */
export function seatBases(map: MapSpec): Pt[] {
  const listed = map.start.find((s) => s.kind === "castle") ?? { x: 4, y: 4 };
  return Array.from({ length: map.seats ?? 2 }, (_, seat) => seatToMap(listed.x, listed.y, seat, map.width, map.height));
}

/** Tiles within Chebyshev radius r of p, nearest first (ties by reading order), inside the map. */
export function ring(p: Pt, r: number, w: number, h: number): Pt[] {
  const out: Pt[] = [];
  for (let y = p.y - r; y <= p.y + r; y++) for (let x = p.x - r; x <= p.x + r; x++) {
    if (x < 0 || y < 0 || x >= w || y >= h || (x === p.x && y === p.y)) continue;
    out.push({ x, y });
  }
  return out.sort((a, b) => distP(a, p) - distP(b, p) || a.y - b.y || a.x - b.x);
}

export const samePt = (a: Pt | undefined, b: Pt | undefined): boolean => !!a && !!b && a.x === b.x && a.y === b.y;
export const key = (p: Pt): string => `${p.x},${p.y}`;
