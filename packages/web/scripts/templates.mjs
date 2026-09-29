// Reference templates for asset generation: magenta canvas with exact 2:1
// isometric tile diamonds (the game's projection) and a shaded reference cube,
// so every generated asset shares one camera.
//   node scripts/templates.mjs
import { resolve } from "node:path";
import sharp from "sharp";

const OUT = resolve(import.meta.dirname, "../../../assets/templates");

/** Diamond of a tiles×tiles footprint centred at (cx, cy), tile half-width a. */
const diamond = (cx, cy, a, tiles = 1) => {
  const w = a * tiles, h = (a / 2) * tiles;
  return `<polygon points="${cx},${cy - h} ${cx + w},${cy} ${cx},${cy + h} ${cx - w},${cy}" fill="none" stroke="#9a9a9a" stroke-width="3"/>`;
};
/** A shaded iso cube whose base is one tile (side = tile height), lit from the top-left. */
const cube = (cx, cy, a) => {
  const h = a / 2, z = a;
  return `
  <polygon points="${cx},${cy - h - z} ${cx + a},${cy - z} ${cx},${cy + h - z} ${cx - a},${cy - z}" fill="#e6e6e6"/>
  <polygon points="${cx - a},${cy - z} ${cx},${cy + h - z} ${cx},${cy + h} ${cx - a},${cy}" fill="#9c9c9c"/>
  <polygon points="${cx},${cy + h - z} ${cx + a},${cy - z} ${cx + a},${cy} ${cx},${cy + h}" fill="#4a4a4a"/>`;
};
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#ff00ff"/>${body}</svg>`;

// Units: five tiles in a row, a reference cube at the far left.
const W = 1536, H = 1024, a = 90;
let units = cube(110, 170, 60);
for (let i = 0; i < 5; i++) units += diamond(190 + i * 290, 900, 120);
await sharp(Buffer.from(svg(W, H, units))).png().toFile(resolve(OUT, "units.png"));

// Buildings: castle on 2×2, then tower, wall piece, wall post on 1×1 tiles.
let blds = cube(110, 170, 60);
blds += diamond(380, 830, 150, 2);
blds += diamond(760, 880, 120);
blds += diamond(1050, 880, 120);
blds += diamond(1330, 880, 110);
await sharp(Buffer.from(svg(W, H, blds))).png().toFile(resolve(OUT, "buildings.png"));

// Resources and terrain: gold mine and rock outcrop on 1×1 tiles.
let res = cube(110, 170, 60);
res += diamond(560, 760, 200);
res += diamond(1100, 760, 200);
await sharp(Buffer.from(svg(W, H, res))).png().toFile(resolve(OUT, "resources.png"));
console.log("templates written");
