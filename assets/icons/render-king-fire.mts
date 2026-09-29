/** Dither the animated effect and static character with separate game palettes. */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { mkdir, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { ditherPixels } from '../../packages/web/src/render/cpuDither.ts';
import { normalizeCharacterContrast } from '../../packages/web/src/render/characterContrast.ts';
import { RAMPS } from '../../packages/web/src/render/palette.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sharp = createRequire(resolve(root, 'packages/web/package.json'))('sharp');
const directory = resolve(root, 'assets/animations/king/inner-fire');
const layers = resolve(directory, 'layers-frames');
const smooth = process.argv.includes('--smooth');
const frames = resolve(directory, smooth ? 'smooth-frames' : 'dither-frames');
await mkdir(frames, { recursive: true });
const size = 256;
const material = new Uint8ClampedArray(await sharp(resolve(layers, 'material.png'))
  .resize(size, size).ensureAlpha().raw().toBuffer());
normalizeCharacterContrast(material);
ditherPixels(material, size, size, RAMPS.teamB, 1.1);
const files = (await readdir(layers)).filter(name => /^fire-\d+\.png$/.test(name)).sort();
const sourceFiles = smooth ? files.slice(10, 55) : files;
const sourcePixels: Uint8ClampedArray[] = [];
for (const name of sourceFiles) sourcePixels.push(new Uint8ClampedArray(
  await sharp(resolve(layers, name)).resize(size, size).ensureAlpha().raw().toBuffer()));
// Overlap the two ends in the continuous fire layer before quantizing colors.
// Both sequences move forward; the static material never participates in the blend.
const overlap = smooth ? 8 : 0;
const renderPixels = sourcePixels.slice(0, sourcePixels.length - overlap).map((frame, index) => {
  if (index >= overlap) return frame;
  const tail = sourcePixels[sourcePixels.length - overlap + index];
  const t = (index + 1) / (overlap + 1);
  const weight = t * t * (3 - 2 * t);
  return Uint8ClampedArray.from(frame, (value, pixel) =>
    pixel % 4 === 3 ? 255 : tail[pixel] * (1 - weight) + value * weight);
});
const palette = new Set(['0,0,0', '45,99,200', '180,220,255', '210,74,28', '255,202,160']);
const observed = new Set<string>();
for (const [index, pixels] of renderPixels.entries()) {
  const fire = pixels.slice();
  ditherPixels(fire, size, size, RAMPS.teamA, 1.1);
  const output = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < output.length; i += 4) {
    const layer = fire[i] || fire[i + 1] || fire[i + 2] ? fire : material;
    if (layer[i + 3]) output.set(layer.subarray(i, i + 3), i);
    output[i + 3] = 255;
    observed.add(`${output[i]},${output[i + 1]},${output[i + 2]}`);
  }
  if ([...observed].some(color => !palette.has(color))) throw new Error('Unexpected dither color');
  await sharp(Buffer.from(output), { raw: { width: size, height: size, channels: 4 } })
    .resize(768, 768, { kernel: 'nearest' }).png()
    .toFile(resolve(frames, `${String(index).padStart(3, '0')}.png`));
}
const ff = (...args: string[]) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args]);
const input = resolve(frames, '%03d.png');
// User-selected cut: remove source frames 0..9 and 55.
const startFrame = smooth ? 0 : 10;
const frameCount = smooth ? renderPixels.length : 45;
const exportName = smooth ? 'king-fire-dithered-smooth' : 'king-fire-dithered-loop';
ff('-framerate', '24', '-start_number', String(startFrame), '-i', input,
  '-frames:v', String(frameCount), '-an', '-c:v', 'libx264', '-crf', '15',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', resolve(directory, `${exportName}.mp4`));
ff('-framerate', '24', '-start_number', String(startFrame), '-i', input, '-filter_complex',
  `[0:v]trim=end_frame=${frameCount},setpts=PTS-STARTPTS,split[a][b];[a]palettegen=max_colors=8[p];[b][p]paletteuse=dither=none`,
  '-loop', '0', resolve(directory, `${exportName}.gif`));
await sharp(resolve(frames, '018.png')).toFile(resolve(directory, `${exportName}.png`));
console.log({ sourceFrames: files.length, startFrame, frameCount, overlap, colors: [...observed], fire: RAMPS.teamA.steps, king: RAMPS.teamB.steps });
