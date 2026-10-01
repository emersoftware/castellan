/** Orthogonal connections shared by placement rules and wall/door rendering. */
export function barrierAxes(x: number, y: number, has: (x: number, y: number) => boolean) {
  return {
    alongX: has(x - 1, y) || has(x + 1, y),
    alongY: has(x, y - 1) || has(x, y + 1),
  };
}
