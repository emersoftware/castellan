/** The game's geometry: how far apart two tiles are and where each seat's corner layout lands. */

/**
 * Game distance for range, vision and proximity: Euclidean, rounded to the nearest
 * whole tile, so range r covers a disc and a diagonal neighbour is at distance 1.
 * Exact integer arithmetic (no floating point), shared with the script sandbox.
 */
export function dist(ax: number, ay: number, bx: number, by: number): number {
  const n = (ax - bx) ** 2 + (ay - by) ** 2;
  const r = Math.floor(Math.sqrt(n));
  return n - r * r > r ? r + 1 : r;
}

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
