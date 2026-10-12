// The noninteractive hero fits a whole map into at most 900 CSS pixels. Keep
// every pose and action, but distribute half-resolution art for that viewport.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

export async function buildHeroSprites(source, target, kinds) {
  await mkdir(target, { recursive: true });
  const scale = 0.5;
  let bytes = 0;
  const manifest = JSON.parse(await readFile(resolve(source, 'manifest.json'), 'utf8'));
  manifest.scale *= scale;
  for (const [name, meta] of Object.entries(manifest.sprites)) {
    const input = resolve(source, `${name}.${meta.format ?? 'png'}`);
    const image = await sharp(input).metadata();
    const sourceWidth = meta.rasterWidth ?? image.width;
    const sourceHeight = meta.rasterHeight ?? Math.round(image.height * sourceWidth / image.width);
    let pipeline = sharp(input).resize(sourceWidth, sourceHeight);
    const width = meta.frame?.width ?? sourceWidth;
    const height = meta.frame?.height ?? sourceHeight;
    if (meta.frame) {
      const { x, y, width, height } = meta.frame;
      // Materialize rasterization before cropping: sharp reorders resize/extract.
      pipeline = sharp(await pipeline.toBuffer()).extract({ left: x, top: y, width, height });
      meta.anchorX = ((meta.anchorX ?? 0.5) * sourceWidth - x) / width;
      meta.anchorY = (meta.anchorY * sourceHeight - y) / height;
      delete meta.frame;
    }
    const output = resolve(target, `${name}.webp`);
    await pipeline.resize(Math.ceil(width * scale), Math.ceil(height * scale)).webp({ lossless: true, effort: 6 }).toFile(output);
    bytes += (await stat(output)).size;
    // orig/display dimensions avoid changing footprint for odd-sized sources.
    meta.displayWidth = width * scale;
    meta.displayHeight = height * scale;
    delete meta.rasterWidth;
    delete meta.rasterHeight;
    meta.format = 'webp';
  }
  await writeFile(resolve(target, 'manifest.json'), JSON.stringify(manifest));
  for (const kind of kinds) {
    const directory = resolve(target, kind);
    await mkdir(directory, { recursive: true });
    const actions = JSON.parse(await readFile(resolve(source, kind, 'manifest.json'), 'utf8'));
    for (const meta of Object.values(actions)) {
      if (meta.available === false) continue;
      const input = resolve(source, kind, meta.image);
      const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const width = Math.ceil(meta.frameWidth * scale);
      const height = Math.ceil(meta.frameHeight * scale);
      const columns = meta.columns ?? meta.frameCount;
      const rowsPerDirection = Math.ceil(meta.frameCount / columns);
      // Resize each cell independently. Fractional boundaries would blend poses
      // and odd-height death frames could shift the ground anchor while animating.
      const cells = await Promise.all(meta.rows.flatMap((_, row) => Array.from({ length: meta.frameCount }, async (_, frame) => ({
        input: await sharp(data, { raw: info }).extract({
          left: (frame % columns) * meta.frameWidth,
          top: (row * rowsPerDirection + Math.floor(frame / columns)) * meta.frameHeight,
          width: meta.frameWidth, height: meta.frameHeight,
        }).resize(width, height).png().toBuffer(),
        left: (frame % columns) * width,
        top: (row * rowsPerDirection + Math.floor(frame / columns)) * height,
      }))));
      meta.image = meta.image.replace(/\.[^.]+$/, '.webp');
      const output = resolve(directory, meta.image);
      await sharp({ create: { width: columns * width, height: meta.rows.length * rowsPerDirection * height, channels: 4, background: '#00000000' } })
        .composite(cells).webp({ lossless: true, effort: 6 }).toFile(output);
      bytes += (await stat(output)).size;
      meta.displayWidth = meta.frameWidth * scale;
      meta.displayHeight = meta.frameHeight * scale;
      meta.frameWidth = width;
      meta.frameHeight = height;
      meta.storedScale *= scale;
    }
    await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(actions));
  }
  return bytes;
}
