/** The game's ramp dither on the CPU, for static images (portraits). */
import type { Ramp } from "./palette";

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Draws `src` into a `w`×`h` canvas and dithers its brightness along `ramp`. Transparent stays transparent. */
export function ditherRamp(src: CanvasImageSource, w: number, h: number, ramp: Ramp, lift = 1): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
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
      const k = Math.min(3, Math.max(0, Math.floor(L * 3 + t)));
      [d[i], d[i + 1], d[i + 2], d[i + 3]] = [...steps[k], 255];
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
