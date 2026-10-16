/** The game's ramp dither on the CPU, for static images (portraits). */
import type { Ramp } from "./palette";

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Three-tone ordered dither of RGBA pixels: brightness along `ramp`; transparent stays transparent. */
export function ditherPixels(d: Uint8ClampedArray, w: number, h: number, ramp: Ramp, lift = 1): void {
  const steps = ramp.steps.map((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 128) {
        d[i + 3] = 0;
        continue;
      }
      const L = (Math.max(d[i], d[i + 1], d[i + 2]) / 255) * lift;
      const t = (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16;
      const scaled = Math.min(1, Math.max(0, L)) * 2;
      const lower = Math.floor(scaled);
      const k = Math.min(2, lower + (scaled - lower >= t ? 1 : 0));
      [d[i], d[i + 1], d[i + 2], d[i + 3]] = [...steps[k], 255];
    }
  }
}
