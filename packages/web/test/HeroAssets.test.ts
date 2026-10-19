import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { buildHeroSprites } from "../scripts/hero-assets.mjs";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

it("keeps odd-sized poses separate and preserves their display size, anchors and timing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "castellan-hero-art-"));
  directories.push(directory);
  const source = join(directory, "source"), target = join(directory, "hero");
  await mkdir(join(source, "knight"), { recursive: true });
  const manifest = { scale: 3, sprites: { knight: { anchorX: 0.3, anchorY: 0.8 } } };
  await writeFile(join(source, "manifest.json"), JSON.stringify(manifest));
  await sharp({ create: { width: 7, height: 5, channels: 4, background: "#999999" } }).png().toFile(join(source, "knight.png"));
  const action = { image: "attack.png", frameCount: 3, frameWidth: 3, frameHeight: 5, storedScale: 3,
    anchorX: 0.4, anchorY: 0.9, fps: 12, rows: ["s", "se"], impactFrames: [1, 2], loop: false };
  await writeFile(join(source, "knight/manifest.json"), JSON.stringify({ attack: action }));
  const pixels = Buffer.alloc(9 * 10 * 4);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
    const value = 50 + 30 * (Math.floor(y / 5) * 3 + Math.floor(x / 3));
    pixels.set([value, value, value, 255], (y * 9 + x) * 4);
  }
  const original = await sharp(pixels, { raw: { width: 9, height: 10, channels: 4 } }).png().toBuffer();
  await writeFile(join(source, "knight/attack.png"), original);

  await buildHeroSprites(source, target, ["knight"]);

  const reduced = JSON.parse(await readFile(join(target, "manifest.json"), "utf8"));
  expect(reduced.scale).toBe(1.5);
  expect(reduced.sprites.knight).toMatchObject({ anchorX: 0.3, anchorY: 0.8, displayWidth: 3.5, displayHeight: 2.5 });
  const { attack } = JSON.parse(await readFile(join(target, "knight/manifest.json"), "utf8"));
  expect(attack).toMatchObject({ ...action, image: "attack.webp", storedScale: 1.5, frameWidth: 2, frameHeight: 3, displayWidth: 1.5, displayHeight: 2.5 });
  expect(attack.displayWidth / attack.storedScale).toBe(action.frameWidth / action.storedScale);
  expect(attack.displayHeight / attack.storedScale).toBe(action.frameHeight / action.storedScale);
  const { data, info } = await sharp(join(target, "knight/attack.webp")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect([info.width, info.height]).toEqual([6, 6]);
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
    const value = 50 + 30 * (Math.floor(y / 3) * 3 + Math.floor(x / 2));
    expect([...data.subarray((y * 6 + x) * 4, (y * 6 + x) * 4 + 4)]).toEqual([value, value, value, 255]);
  }
  expect(await readFile(join(source, "knight/attack.png"))).toEqual(original);
});
