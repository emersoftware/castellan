/** Earliest intersection along a segment (0..1), including starting inside the circle. */
export function segmentCircleHit(ax: number, ay: number, bx: number, by: number, x: number, y: number, radius: number): number | null {
  const dx = bx - ax, dy = by - ay, ox = ax - x, oy = ay - y;
  const c = ox * ox + oy * oy - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (a === 0) return null;
  const b = 2 * (ox * dx + oy * dy);
  // eslint-disable-next-line @typescript-eslint/no-magic-numbers -- the quadratic formula
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}
