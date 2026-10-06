import { expect, it } from 'vitest';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

it.each(['castle', 'turret', 'wall', 'wallpost', 'door', 'door-open', 'wall-door-left', 'wall-door-right', 'wall-door-both'])('%s collapse has clear borders, lower rubble and a held endpoint', async kind => {
  const dir = new URL(`../public/sprites/${kind}/`, import.meta.url);
  const { death: m } = JSON.parse(await readFile(new URL('manifest.json', dir), 'utf8'));
  const { data, info } = await sharp(new URL(m.image, dir).pathname).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(m.loop).toBe(false);
  expect(info.width).toBe(m.frameWidth * m.columns);
  expect(info.height).toBe(m.frameHeight * Math.ceil(m.frameCount / m.columns));
  expect(Math.max(info.width, info.height)).toBeLessThanOrEqual(4096);
  const heights = [];
  for (let frame = 0; frame < m.frameCount; frame++) {
    let minY = m.frameHeight, maxY = -1, solid = 0;
    for (let y = 0; y < m.frameHeight; y++) for (let x = 0; x < m.frameWidth; x++) {
      const at = ((y + Math.floor(frame / m.columns) * m.frameHeight) * info.width + (frame % m.columns) * m.frameWidth + x) * 4;
      if (x === 0 || y === 0 || x === m.frameWidth - 1 || y === m.frameHeight - 1) expect(data[at + 3]).toBe(0);
      if (data[at + 3] > 32) {
        solid++; minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        if (data[at] !== data[at + 1] || data[at + 1] !== data[at + 2]) throw new Error(`${kind}: non-grayscale pixel`);
      }
      if (frame === m.frameCount - 1) {
        const previous = ((y + Math.floor((frame - 1) / m.columns) * m.frameHeight) * info.width + ((frame - 1) % m.columns) * m.frameWidth + x) * 4;
        if (!data.subarray(at, at + 4).equals(data.subarray(previous, previous + 4))) throw new Error(`${kind}: endpoint is not held`);
      }
    }
    expect(solid).toBeGreaterThan(100);
    expect(solid).toBeLessThan(m.frameWidth * m.frameHeight * .7);
    heights.push(maxY - minY + 1);
  }
  expect(heights.at(-1)).toBeLessThan(heights[0] * .8);
});
