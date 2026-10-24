import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { normalizeCharacterContrast } from "../../../packages/web/src/render/characterContrast.ts";
import { ditherPixels } from "../../../packages/web/src/render/cpuDither.ts";
import { PLAYER_RAMPS } from "../../../packages/web/src/render/palette.ts";

// Preview the real exported frames at normal game scale with screen-space dither.
// Each row is one player palette; columns are S, SE, E, NE, N, NW, W, SW.
const directory = dirname(fileURLToPath(import.meta.url));
const sharp = createRequire(resolve(directory, "../../../packages/web/package.json"))("sharp");
const action = process.argv[2];
const direction = process.argv.find(arg => arg.startsWith("--direction="))?.split("=")[1];
if (!["idle", "walk", "heal", "hack", "convert", "death"].includes(action)) throw new Error("Usage: node --import tsx assets/animations/wizard/preview.mts idle|walk|heal|hack|convert|death");
const base = resolve(directory, `${action}-directions`);
const exportFolder = direction ? `export-${direction}` : "export";
const suffix = direction ? `-${direction}` : "";
const meta = JSON.parse(await readFile(resolve(base, exportFolder, "manifest.json"), "utf8"));
const { data, info } = await sharp(resolve(base, exportFolder, meta.image)).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const pixels = new Uint8ClampedArray(data);
normalizeCharacterContrast(pixels);
const frames = resolve(base, `review${suffix}-frames`);
await mkdir(frames, { recursive: true });
const width = Math.round(meta.frameWidth / meta.storedScale);
const height = Math.round(meta.frameHeight / meta.storedScale);
const cell = 48;
const directions = Object.entries(meta.directions) as [string, { row: number; flip: boolean; screenDir: number }][];
directions.sort((a, b) => a[1].screenDir - b[1].screenDir);
let validated = 0;
for (let frame = 0; frame < meta.frameCount; frame++) {
  const composite: { input: Buffer; left: number; top: number }[] = [];
  for (const [column, [direction, position]] of directions.entries()) {
    const source = sharp(Buffer.from(pixels), { raw: { width: info.width, height: info.height, channels: 4 } })
      .extract({ left: frame * meta.frameWidth, top: position.row * meta.frameHeight, width: meta.frameWidth, height: meta.frameHeight });
    if (position.flip) source.flop();
    const resized = await source.resize(width, height).raw().toBuffer();
    for (const [team, ramp] of PLAYER_RAMPS.entries()) {
      const tinted = new Uint8ClampedArray(resized);
      ditherPixels(tinted, width, height, ramp);
      const allowed = new Set(ramp.steps.map(color => color.toLowerCase()));
      let solid = 0;
      for (let i = 0; i < tinted.length; i += 4) {
        if (!tinted[i + 3]) continue;
        const color = `#${[tinted[i], tinted[i + 1], tinted[i + 2]].map(value => value.toString(16).padStart(2, "0")).join("")}`;
        if (!allowed.has(color)) throw new Error(`${action}/${direction}/${frame}: unexpected colour`);
        solid++;
      }
      if (!solid) throw new Error(`${action}/${direction}/${frame}: empty frame`);
      composite.push({ input: await sharp(Buffer.from(tinted), { raw: { width, height, channels: 4 } }).png().toBuffer(), left: column * cell + Math.floor((cell - width) / 2), top: team * cell + Math.floor((cell - height) / 2) });
      validated++;
    }
  }
  const grid = await sharp({ create: { width: directions.length * cell, height: 4 * cell, channels: 4, background: "#000000" } }).composite(composite).png().toBuffer();
  await sharp(grid).resize(directions.length * cell * 3, 4 * cell * 3, { kernel: "nearest" }).png().toFile(resolve(frames, `frame-${String(frame).padStart(2, "0")}.png`));
}
const ff = (...args: string[]) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);
const input = resolve(frames, "frame-%02d.png");
ff("-framerate", String(meta.fps), "-i", input, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", resolve(base, `wizard-dithered${suffix}.mp4`));
ff("-framerate", String(meta.fps), "-i", input, "-filter_complex", "split[a][b];[a]palettegen[p];[b][p]paletteuse", "-loop", "0", resolve(base, `wizard-dithered${suffix}.gif`));
await writeFile(resolve(base, `review${suffix}.json`), JSON.stringify({ frames: meta.frameCount, fps: meta.fps, palettes: PLAYER_RAMPS.map(ramp => ramp.steps), directions: directions.map(([name]) => name), validatedFrames: validated, filters: ["normalizeCharacterContrast", "ditherPixels"], integrated: false }, null, 2) + "\n");
console.log(`${action}: ${validated} dithered frames validated across ${Object.keys(meta.directions).length} directions and four palettes.`);
