/** Prepare MiniMax references, then package reviewed one-shot building collapses. */
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const root = new URL('../../../', import.meta.url).pathname;
const sprites = `${root}packages/web/public/sprites`;
const sources = `${root}assets/animations/buildings/collapse`;
const manifest = JSON.parse(await readFile(`${sprites}/manifest.json`, 'utf8'));
const files = { wall: 'wall', wallpost: 'wallpost', door: 'door', 'door-open': 'door-open', turret: 'tower', castle: 'castle' };
const prepare = process.argv.includes('--prepare');
const onlyKind = process.argv.includes('--kind') ? process.argv[process.argv.indexOf('--kind') + 1] : undefined;
const ff = (...args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args]);

function key(data) {
  for (let i = 0; i < data.length; i += 4) {
    const chroma = Math.min(data[i], data[i + 2]) - data[i + 1];
    data[i + 3] = chroma > 45 ? 0 : chroma > 15 ? Math.round(255 * (45 - chroma) / 30) : 255;
    data[i] = data[i + 2] = data[i + 1];
  }
  return data;
}

for (const [kind, file] of Object.entries(files)) {
  if (onlyKind && onlyKind !== kind) continue;
  if (!prepare && kind === 'castle' && await readFile(`${root}assets/animations/buildings/castle/damage-stages/death-healthy/generated.mp4`).then(() => true, () => false)) {
    console.log('castle: inward fall is owned by castle-damage.mjs; preserved newer atlas');
    continue;
  }
  const dir = `${sources}/${kind}`;
  await mkdir(dir, { recursive: true });
  if (prepare) {
    try {
      await readFile(`${dir}/reference.png`);
      await readFile(`${dir}/reference-layout.json`);
      console.log(`${kind}: preserved existing generation reference`);
      continue;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const m = manifest.sprites[file];
    const source = await sharp(`${sprites}/${file}.${m.format ?? 'png'}`).ensureAlpha().png().toBuffer();
    const { width, height } = await sharp(source).metadata();
    const extent = kind === 'turret' ? 300 : 380;
    const scale = Math.min(extent / width, extent / height);
    const w = Math.round(width * scale), h = Math.round(height * scale);
    const left = Math.round(272 - (m.anchorX ?? .5) * w);
    const top = Math.round((kind === 'turret' ? 330 : 400) - m.anchorY * h);
    await writeFile(`${dir}/source.png`, source);
    await sharp({ create: { width: 544, height: 544, channels: 3, background: '#ff00ff' } })
      .composite([{ input: await sharp(source).resize(w, h).png().toBuffer(), left, top }])
      .png().toFile(`${dir}/reference.png`);
    await writeFile(`${dir}/reference-layout.json`, JSON.stringify({ source: `${file}.${m.format ?? 'png'}`, width, height, left, top, w, h,
      scale: h / height, anchorX: (left + (m.anchorX ?? .5) * w) / 544, anchorY: (top + m.anchorY * h) / 544 }, null, 2) + '\n');
    console.log(`${kind}: reference ready`);
    continue;
  }
  const s = JSON.parse(await readFile(`${dir}/reference-layout.json`, 'utf8'));
  const exportSettings = JSON.parse(await readFile(`${sources}/export-settings.json`, 'utf8'))[kind] ?? {};
  await mkdir(`${dir}/frames`, { recursive: true });
  const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', `${dir}/generated.mp4`], { encoding: 'utf8' }).trim());
  const trim = exportSettings.trimStart ?? 0;
  const end = exportSettings.end ?? duration;
  ff('-ss', String(trim), '-i', `${dir}/generated.mp4`, '-vf', `fps=${26 / (end - trim)},scale=544:544`, '-frames:v', '26', `${dir}/frames/%02d.png`);
  const raw = [key(await sharp(`${dir}/reference.png`).ensureAlpha().raw().toBuffer())];
  for (let i = 1; i <= 26; i++) raw.push(key(await sharp(`${dir}/frames/${String(i).padStart(2, '0')}.png`).ensureAlpha().raw().toBuffer()));
  raw.push(Buffer.from(raw.at(-1)));
  // Full source canvas preserves scattered rubble, dust and the original ground.
  const size = Math.ceil(544 / s.scale);
  const variants = kind === 'wall' ? ['wall', 'wall-door-left', 'wall-door-right', 'wall-door-both'] : [kind];
  for (const variant of variants) {
    const cells = [];
    for (const data of raw) {
      const pixels = Buffer.from(data);
      if (variant !== kind) {
        const from = variant.endsWith('right') ? 0 : 20;
        const to = variant.endsWith('left') ? 103 : 68;
        for (let y = 0; y < 544; y++) for (let x = 0; x < 544; x++) {
          if (x < s.left + from * s.w / s.width || x >= s.left + to * s.w / s.width) pixels[(y * 544 + x) * 4 + 3] = 0;
        }
      }
      // Check the decoded video before scaling; padding cannot fix cropped debris.
      for (let i = 0; i < 544; i++) for (const at of [i * 4 + 3, (543 * 544 + i) * 4 + 3, (i * 544) * 4 + 3, (i * 544 + 543) * 4 + 3]) {
        if (pixels[at] > 32) throw new Error(`${kind}: foreground touches video boundary; review/retry source`);
      }
      const scaled = await sharp(pixels, { raw: { width: 544, height: 544, channels: 4 } }).resize(size, size).raw().toBuffer();
      // Drop almost-transparent compression/resampling speckles from the key.
      for (let i = 3; i < scaled.length; i += 4) if (scaled[i] <= 8) scaled[i] = 0;
      cells.push(await sharp(scaled, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer());
    }
    const out = `${sprites}/${variant}`;
    await mkdir(out, { recursive: true });
    // Seven columns keep the largest atlas below 4096 px on either axis.
    await sharp({ create: { width: size * 7, height: size * 4, channels: 4, background: '#00000000' } })
      .composite(cells.map((input, i) => ({ input, left: (i % 7) * size, top: Math.floor(i / 7) * size }))).png().toFile(`${out}/${variant}-death.png`);
    let metadata = {};
    try { metadata = JSON.parse(await readFile(`${out}/manifest.json`, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    metadata.death = { image: `${variant}-death.png`, fps: 12, frameCount: 28, columns: 7, frameWidth: size, frameHeight: size, storedScale: 3,
      anchorX: s.anchorX, anchorY: s.anchorY, loop: false, rows: ['se'] };
    await writeFile(`${out}/manifest.json`, JSON.stringify(metadata, null, 2) + '\n');
    if (variant === kind) {
      ff('-framerate', '12', '-i', `${dir}/frames/%02d.png`, '-vf', 'scale=272:272', `${dir}/source-preview.gif`);
      // Color-independent transparent sprite preview, before runtime tint/dither.
      await mkdir(`${dir}/sprite-frames`, { recursive: true });
      for (let i = 0; i < cells.length; i++) await writeFile(`${dir}/sprite-frames/${String(i).padStart(2, '0')}.png`, cells[i]);
      ff('-framerate', '12', '-i', `${dir}/sprite-frames/%02d.png`, '-filter_complex', 'split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=64', `${dir}/collapse-sprite.gif`);
    }
    console.log(`${variant}: 28 death frames at ${size}x${size}, preserved ground anchor`);
  }
}
