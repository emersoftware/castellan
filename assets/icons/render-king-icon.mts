import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { ditherPixels } from '../../packages/web/src/render/cpuDither.ts';
import { normalizeCharacterContrast } from '../../packages/web/src/render/characterContrast.ts';
import { RAMPS } from '../../packages/web/src/render/palette.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sharp = createRequire(resolve(root, 'packages/web/package.json'))('sharp');
const source = resolve(root, 'assets/raw/king-head-icon.png');
const size = 256;
const { data, info } = await sharp(source).resize(size, size, { fit: 'contain', background: '#00000000' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const pixels = new Uint8ClampedArray(data);
normalizeCharacterContrast(pixels);
ditherPixels(pixels, size, size, RAMPS.teamA, 1.1);
const output = resolve(root, 'assets/icons/king-head-dithered.png');
await sharp(Buffer.from(pixels), { raw: { width: size, height: size, channels: 4 } }).png().toFile(output);
await sharp(output).flatten({ background: '#000000' }).resize(768, 768, { kernel: 'nearest' }).png().toFile(resolve(root, 'assets/icons/king-head-preview.png'));
const colors = new Set<string>();
let transparent = 0;
for (let i = 0; i < pixels.length; i += 4) {
  if (!pixels[i + 3]) transparent++;
  else colors.add([pixels[i], pixels[i + 1], pixels[i + 2]].join(','));
}
console.log({ output, channels: info.channels, colors: [...colors], transparentPixels: transparent });
