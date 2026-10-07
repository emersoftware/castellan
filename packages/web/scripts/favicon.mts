// Favicons from the castle sprite, dithered at each final size
// with the game's pipeline. node --import tsx packages/web/scripts/favicon.mts
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ditherPixels } from "../src/render/cpuDither.ts";
import { RAMPS } from "../src/render/palette.ts";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sharp = createRequire(resolve(web, "package.json"))("sharp");
const castle = await sharp(resolve(web, "public/sprites/castle.png")).trim().toBuffer();

for (const [size, name] of [[64, "favicon-64.png"], [180, "apple-touch-icon.png"]] as const) {
  const { data } = await sharp(castle).resize(size, size, { fit: "contain", background: "#00000000" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = new Uint8ClampedArray(data);
  ditherPixels(pixels, size, size, RAMPS.teamA, 1.25);
  await sharp(Buffer.from(pixels), { raw: { width: size, height: size, channels: 4 } }).flatten({ background: "#000000" }).png().toFile(resolve(web, "public", name));
}
