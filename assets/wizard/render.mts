import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ditherPixels } from "../../packages/web/src/render/cpuDither.ts";
import { normalizeCharacterContrast } from "../../packages/web/src/render/characterContrast.ts";
import { PLAYER_RAMPS } from "../../packages/web/src/render/palette.ts";

// Candidate art only: importing the real filters does not register a game unit.
const directory = dirname(fileURLToPath(import.meta.url));
const sharp = createRequire(resolve(directory, "../../packages/web/package.json"))("sharp");
const directions = ["s", "se", "e", "ne", "n"];
const actions = ["idle", "walk", "heal", "hack", "death"];
const size = 112;
const teams = ["teamA", "teamB", "teamC", "teamD"];
const measurements: object[] = [];
const assets: object[] = [];
const gameScaleCells: { input: Buffer; left: number; top: number }[] = [];

function grayscale(data: Uint8Array): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(data);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = pixels[i + 1] = pixels[i + 2] = Math.round(0.3 * pixels[i] + 0.59 * pixels[i + 1] + 0.11 * pixels[i + 2]);
  }
  return pixels;
}

async function save(pixels: Uint8ClampedArray, width: number, height: number, relative: string) {
  const path = resolve(directory, relative);
  await mkdir(dirname(path), { recursive: true });
  await sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } }).png().toFile(path);
}

for (const action of actions) {
  const source = resolve(directory, `source/${action}.png`);
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Generated turnarounds have approximately equal cells. Find the actual clear
  // gutters near their expected boundaries rather than cutting off equipment.
  const occupiedColumns = new Uint8Array(info.width);
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] >= 128) occupiedColumns[x] = 1;
  }
  const boundaries = [0];
  for (let view = 1; view < directions.length; view++) {
    const expected = Math.round(view * info.width / directions.length);
    const tolerance = Math.floor(info.width / directions.length * 0.2);
    let gutter = -1;
    for (let offset = 0; offset <= tolerance && gutter < 0; offset++) {
      for (const x of [expected - offset, expected + offset]) {
        if (!occupiedColumns[x]) { gutter = x; break; }
      }
    }
    if (gutter < 0) throw new Error(`${action}: overlapping source views at boundary ${view}`);
    boundaries.push(gutter);
  }
  boundaries.push(info.width);
  const boxes: { left: number; top: number; width: number; height: number }[] = [];
  for (let view = 0; view < directions.length; view++) {
    const left = boundaries[view];
    const right = boundaries[view + 1];
    let x0 = right, x1 = left - 1, y0 = info.height, y1 = -1;
    for (let y = 0; y < info.height; y++) for (let x = left; x < right; x++) {
      if (data[(y * info.width + x) * 4 + 3] < 128) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    if (x1 < x0 || x0 === 0 || x1 === info.width - 1 || y0 <= 0 || y1 >= info.height - 1) {
      throw new Error(`${action}/${directions[view]}: empty or clipped source cell`);
    }
    boxes.push({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 });
  }
  // One scale for the entire turnaround. Fallen bodies need horizontal room.
  const scale = Math.min(87 / Math.max(...boxes.map(b => b.height)), 100 / Math.max(...boxes.map(b => b.width)));
  const height = action === "death" ? 119 : size;
  const cells: Uint8ClampedArray[] = [];
  for (const [view, box] of boxes.entries()) {
    const width = Math.max(1, Math.round(box.width * scale));
    const characterHeight = Math.max(1, Math.round(box.height * scale));
    const cell = await sharp(source).extract(box).resize(width, characterHeight).ensureAlpha()
      .extend({ left: Math.floor((size - width) / 2), right: Math.ceil((size - width) / 2), top: 102 - characterHeight, bottom: height - 102, background: "#00000000" })
      .toColourspace("srgb").raw().toBuffer();
    const pixels = grayscale(cell);
    await save(pixels, size, height, `grayscale/${action}_${view}.png`);
    cells.push(pixels);
    assets.push({ action, direction: directions[view], image: `grayscale/${action}_${view}.png`, sourceBox: box, width: size, height, anchorX: 0.5, anchorY: 101.5 / height, storedScale: 3 });
  }
  const atlas = new Uint8ClampedArray(cells.length * size * height * 4);
  cells.forEach((cell, index) => atlas.set(cell, index * cell.length));
  normalizeCharacterContrast(atlas);
  for (const [view, cell] of cells.entries()) {
    const normalized = atlas.slice(view * cell.length, (view + 1) * cell.length);
    for (const [team, ramp] of PLAYER_RAMPS.entries()) {
      if (view === 1) {
        const width = Math.round(size / 3), displayHeight = Math.round(height / 3);
        const data = await sharp(Buffer.from(normalized), { raw: { width: size, height, channels: 4 } }).resize(width, displayHeight).raw().toBuffer();
        const screenPixels = new Uint8ClampedArray(data);
        ditherPixels(screenPixels, width, displayHeight, ramp);
        const input = await sharp(Buffer.from(screenPixels), { raw: { width, height: displayHeight, channels: 4 } }).resize(width * 3, displayHeight * 3, { kernel: "nearest" }).png().toBuffer();
        gameScaleCells.push({ input, left: actions.indexOf(action) * 140 + 14, top: team * 170 + 40 });
      }
      const pixels = normalized.slice();
      ditherPixels(pixels, size, height, ramp);
      const allowed = new Set(ramp.steps.map(color => color.toLowerCase()));
      let solid = 0, transparent = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (!pixels[i + 3]) { transparent++; continue; }
        const color = `#${[pixels[i], pixels[i + 1], pixels[i + 2]].map(value => value.toString(16).padStart(2, "0")).join("")}`;
        if (pixels[i + 3] !== 255 || !allowed.has(color)) throw new Error(`Unexpected dither pixel: ${color}`);
        solid++;
      }
      if (!solid || !transparent) throw new Error(`${action}/${view}: missing character or transparency`);
      await save(pixels, size, height, `dithered/${teams[team]}/${action}_${view}.png`);
      measurements.push({ action, direction: directions[view], team: teams[team], solid, transparent });
    }
  }
}

for (const name of ["heal-icon", "hack-icon"]) {
  const { data } = await sharp(resolve(directory, `source/${name}.png`)).trim().resize(128, 128, { fit: "contain", background: "#00000000" }).ensureAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const pixels = grayscale(data);
  normalizeCharacterContrast(pixels);
  await save(pixels, 128, 128, `grayscale/${name}.png`);
  for (const [team, ramp] of PLAYER_RAMPS.entries()) {
    const tinted = pixels.slice();
    ditherPixels(tinted, 128, 128, ramp, 1.1);
    await save(tinted, 128, 128, `dithered/${teams[team]}/${name}.png`);
  }
}

// Match Portrait's standing south-east image, rather than inventing another face.
for (const team of teams) {
  await sharp(resolve(directory, `dithered/${team}/idle_1.png`)).png().toFile(resolve(directory, `dithered/${team}/portrait.png`));
}

const xml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const title = (value: string, width: number, height = 40) => Buffer.from(`<svg width="${width}" height="${height}"><text x="12" y="27" fill="#c8c8c8" font-size="18" font-family="monospace">${xml(value)}</text></svg>`);
for (const [row, team] of teams.entries()) for (const [column, action] of actions.entries()) {
  gameScaleCells.push({ input: title(`${team} ${action}`, 140), left: column * 140, top: row * 170 });
}
await sharp({ create: { width: actions.length * 140, height: teams.length * 170, channels: 4, background: "#080808" } }).composite(gameScaleCells).png().toFile(resolve(directory, "game-scale.png"));
const cellWidth = 224, rowHeight = 286;
const columns = [...actions, "heal-icon", "hack-icon"];
const width = columns.length * cellWidth;
const composite: { input: Buffer; left: number; top: number }[] = [{ input: title("WIZARD / source poses / engine Bayer 4x4 / four player ramps", width), left: 0, top: 0 }];
for (const [row, team] of teams.entries()) {
  for (const [column, action] of columns.entries()) {
    const file = actions.includes(action) ? `${action}_1` : action;
    const sprite = await sharp(resolve(directory, `dithered/${team}/${file}.png`)).resize(224, 224, { fit: "contain", background: "#00000000", kernel: "nearest" }).png().toBuffer();
    composite.push({ input: sprite, left: column * cellWidth, top: 82 + row * rowHeight });
    composite.push({ input: title(`${team} / ${action}`, cellWidth), left: column * cellWidth, top: 42 + row * rowHeight });
  }
}
await sharp({ create: { width, height: 42 + teams.length * rowHeight, channels: 4, background: "#080808" } }).composite(composite).png().toFile(resolve(directory, "contact-sheet.png"));

const turnarounds: { input: Buffer; left: number; top: number }[] = [];
for (const [row, action] of actions.entries()) for (const [column, direction] of directions.entries()) {
  const sprite = await sharp(resolve(directory, `dithered/teamA/${action}_${column}.png`)).resize(224, 238, { fit: "contain", background: "#00000000", kernel: "nearest" }).png().toBuffer();
  turnarounds.push({ input: sprite, left: column * cellWidth, top: row * rowHeight + 40 });
  turnarounds.push({ input: title(`${action} / ${direction}`, cellWidth), left: column * cellWidth, top: row * rowHeight });
}
await sharp({ create: { width: directions.length * cellWidth, height: actions.length * rowHeight, channels: 4, background: "#080808" } }).composite(turnarounds).png().toFile(resolve(directory, "turnarounds.png"));
await writeFile(resolve(directory, "manifest.json"), JSON.stringify({ status: "candidate-source-poses", integrated: false, animationFrameCount: 1, directions, mirrored: { sw: "se", w: "e", nw: "ne" }, assets }, null, 2) + "\n");
await writeFile(resolve(directory, "validation.json"), JSON.stringify({ filters: ["normalizeCharacterContrast", "ditherPixels"], spriteLift: 1, iconLift: 1.1, measurements }, null, 2) + "\n");
console.log(`Rendered ${assets.length} source poses in ${teams.length} player ramps; source-cell clipping, alpha and sprite palettes validated.`);
