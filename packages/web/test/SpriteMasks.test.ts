import { expect, it } from "vitest";
import { createRequire } from "node:module";
import { spriteMasks } from "../src/render/xray";
import { normalizeCharacterContrast } from "../src/render/characterContrast";

const sharp = createRequire(import.meta.url)("sharp");

/** The x-ray shader's code of a colour's interior or ring. */
const mark = (colour: number, ring: boolean) => (colour * 2 + (ring ? 2 : 1)) * 28;

/** The original per-pixel mask loop, kept as the reference. */
function reference(src: Uint8ClampedArray, w: number, h: number, radius = 3) {
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && src[(y * w + x) * 4 + 3] > 127;
  const make = (fill: (ring: boolean) => [number, number, number], exterior = false) => {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (exterior ? solid(x, y) : !solid(x, y)) continue;
        let ring = false;
        for (let d = 1; d <= radius && !ring; d++) ring = exterior
          ? solid(x - d, y) || solid(x + d, y) || solid(x, y - d) || solid(x, y + d)
          : !solid(x - d, y) || !solid(x + d, y) || !solid(x, y - d) || !solid(x, y + d);
        if (exterior && !ring) continue;
        const i = (y * w + x) * 4;
        [out[i], out[i + 1], out[i + 2], out[i + 3]] = [...fill(ring), 255];
      }
    }
    return out;
  };
  return {
    silhouette: make(() => [255, 255, 255]),
    xray: [0, 1, 2, 3].map((colour) => make((ring) => [255, 255, mark(colour, ring)])),
    outline: [0, 1, 2, 3].map((colour) => make(() => [255, 255, mark(colour, true)], true)),
  };
}

function expectSame(src: Uint8ClampedArray, w: number, h: number, radius = 3) {
  const want = reference(src, w, h, radius);
  const got = spriteMasks(src, w, h, radius);
  expect(Buffer.from(got.silhouette).equals(Buffer.from(want.silhouette))).toBe(true);
  for (let c = 0; c < 4; c++) {
    expect(Buffer.from(got.xray[c]).equals(Buffer.from(want.xray[c]))).toBe(true);
    expect(Buffer.from(got.outline[c]).equals(Buffer.from(want.outline[c]))).toBe(true);
  }
}

function synthetic(w: number, h: number, alpha: (x: number, y: number) => number) {
  const src = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) src[(y * w + x) * 4 + 3] = alpha(x, y);
  return src;
}

it.each([2, 3])("matches the reference masks at radius %s on borders, thin lines and holes", (radius) => {
  // Solid to the borders, with a hole and a notch.
  expectSame(synthetic(20, 14, (x, y) => (x > 8 && x < 12 && y > 5 && y < 9) || (x === 0 && y === 3) ? 0 : 255), 20, 14, radius);
  // 1-px lines, isolated dots and alpha right at the threshold.
  expectSame(synthetic(17, 11, (x, y) => x === 4 || y === 7 ? 255 : (x + y) % 9 === 0 ? 128 : (x * y) % 7 === 0 ? 127 : 0), 17, 11, radius);
  // Degenerate sizes.
  expectSame(synthetic(1, 1, () => 255), 1, 1, radius);
  expectSame(synthetic(5, 1, (x) => (x % 2 ? 255 : 0)), 5, 1, radius);
  expectSame(synthetic(3, 4, () => 0), 3, 4, radius);
});

it("matches the reference masks on a real animation atlas", async () => {
  const path = new URL("../../../assets/sprites/knight/knight-idle.png", import.meta.url).pathname;
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const src = new Uint8ClampedArray(data);
  normalizeCharacterContrast(src);
  expectSame(src, info.width, info.height);
});
