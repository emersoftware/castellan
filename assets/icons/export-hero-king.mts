/** Export undithered channel-keyed frames for the game's runtime dither shader. */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { normalizeCharacterContrast } from '../../packages/web/src/render/characterContrast.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sharp = createRequire(resolve(root, 'packages/web/package.json'))('sharp');
const layers = resolve(root, 'assets/animations/king/inner-fire/layers-frames');
const out = resolve(root, 'packages/web/public/hero');
await mkdir(out, { recursive: true });
const size = 544, columns = 7, overlap = 8, count = 37;
const material = new Uint8ClampedArray(await sharp(resolve(layers, 'material.png')).ensureAlpha().raw().toBuffer());
normalizeCharacterContrast(material);
const fire: Buffer[] = [];
for (let i = 10; i <= 54; i++) fire.push(await sharp(resolve(layers, `fire-${String(i).padStart(3, '0')}.png`))
  .removeAlpha().raw().toBuffer());
const tiles = [];
for (let index = 0; index < count; index++) {
  const pixels = Buffer.alloc(size * size * 3);
  const t = (index + 1) / (overlap + 1);
  const mix = index < overlap ? t * t * (3 - 2 * t) : 1;
  for (let pixel = 0; pixel < size * size; pixel++) {
    const k = pixel * 3;
    const current = Math.max(fire[index][k], fire[index][k + 1], fire[index][k + 2]);
    const tail = index < overlap ? fire[fire.length - overlap + index] : null;
    const brightness = tail ? Math.max(tail[k], tail[k + 1], tail[k + 2]) * (1 - mix) + current * mix : current;
    if (brightness > 2) pixels[k + 2] = Math.min(255, Math.round(brightness * 1.1));
    else if (material[pixel * 4 + 3] >= 128) pixels[k] = Math.min(255, Math.round(material[pixel * 4] * 1.1));
  }
  tiles.push({ input: await sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer(),
    left: index % columns * size, top: Math.floor(index / columns) * size });
}
await sharp({ create: { width: columns * size, height: Math.ceil(count / columns) * size, channels: 3, background: '#000' } })
  .composite(tiles).png().toFile(resolve(out, 'king-fire-keys.png'));
await writeFile(resolve(out, 'king-fire.json'), JSON.stringify({ size, columns, count, fps: 24 }) + '\n');
console.log({ output: out, size, columns, count, fps: 24 });
