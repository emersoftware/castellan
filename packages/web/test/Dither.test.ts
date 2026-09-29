import { expect, it } from "vitest";
import { RAMPS } from "../src/render/palette";
import { ditherPixels } from "../src/render/cpuDither";

it("uses three tones with dithered coverage only between adjacent tones", () => {
  for (const ramp of Object.values(RAMPS)) {
    for (const [brightness, expectedCounts] of [[0, [16, 0, 0]], [64, [8, 8, 0]], [128, [0, 16, 0]], [192, [0, 8, 8]], [255, [0, 0, 16]]] as const) {
      const data = new Uint8ClampedArray(Array.from({ length: 16 }, () => [brightness, brightness, brightness, 255]).flat());
      ditherPixels(data, 4, 4, ramp);
      const colours = Array.from({ length: 16 }, (_, i) => `#${[...data.slice(i * 4, i * 4 + 3)].map((c) => c.toString(16).padStart(2, "0")).join("")}`);
      expect(colours.every((c) => ramp.steps.includes(c))).toBe(true);
      expect(ramp.steps.map((tone) => colours.filter((c) => c === tone).length)).toEqual(expectedCounts);
    }
  }
});

it("preserves transparent portrait pixels", () => {
  const data = new Uint8ClampedArray([255, 255, 255, 0]);
  ditherPixels(data, 1, 1, RAMPS.neutral);
  expect(data[3]).toBe(0);
});
