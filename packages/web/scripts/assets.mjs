// @ts-check
// Turns the renders in assets/raw/ (drawn by gen-templated.sh on the isometric
// templates, subjects on flat magenta) into game sprites: magenta keyed out,
// colour dropped, contrast stretched, cut per object, scaled from the template's
// tile size. Conditional unit outlines are rendered at runtime, never baked
// into the PNGs. Unit sheets give 5 facings (<name>_0..4: toward camera, front-right,
// right, back-right, away).
// The output is luminance + alpha; the renderer tints and the dither pass colours.
//   node scripts/assets.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
/** @import { EntityKind } from "../../shared/src/ruleset.ts" */
/** @import { ClipArt } from "../src/render/clips.ts" */

const RAW = resolve(import.meta.dirname, "../../../assets/raw");
const OUT = resolve(import.meta.dirname, "../../../assets/sprites");
/** Sprites are stored at 3× their on-screen size (zoom 1). */
const SCALE = 3;
/** Transparent padding, in stored pixels (1 screen px). Keeps existing anchors. */
const RING = 3;

/**
 * Where each object stands in its template (assets/templates, 1536×1024):
 * diamond centre (cx, cy) and diamond width `dw` in template pixels, and the
 * width `fw` that diamond takes on screen (32 = one tile). Scale and anchor
 * come from this geometry, so every asset shares the game's camera and scale.
 * Units instead set their on-screen height `fh` (outline included), shared by
 * the 5 facings, so each unit's size relative to the others is fixed here
 * whatever size the render drew it at.
 * @typedef {{ name: string, cx: number, cy: number, dw: number } & ({ fw: number } | { fh: number })} Placement
 */
/** @type {(name: EntityKind, fh: number) => Placement[]} */
const unitRow = (name, fh) => [0, 1, 2, 3, 4].map((i) => ({ name: `${name}_${i}`, cx: 190 + i * 290, cy: 900, dw: 240, fh }));
/** @type {Record<string, Placement[]> & { "buildings.png": (Placement & { name: ClipArt })[] }} */
const LAYOUT = {
  "buildings.png": [
    { name: "castle", cx: 380, cy: 830, dw: 600, fw: 66 },
    { name: "tower", cx: 760, cy: 880, dw: 240, fw: 32 },
    { name: "wall", cx: 1050, cy: 880, dw: 240, fw: 32 },
    { name: "wallpost", cx: 1330, cy: 880, dw: 220, fw: 30 },
  ],
  "resources.png": [
    { name: "mineral", cx: 560, cy: 760, dw: 400, fw: 32 },
    { name: "rock", cx: 1100, cy: 760, dw: 400, fw: 34 },
  ],
  "king_sheet.png": unitRow("king", 29),
  "worker_sheet.png": unitRow("worker", 25),
  "knight_sheet.png": unitRow("knight", 29),
  "ranger_sheet.png": unitRow("archer", 28),
};
const TEMPLATE_W = 1536;

mkdirSync(OUT, { recursive: true });
const manifestPath = resolve(OUT, "manifest.json");
// Retain hand-authored crop metadata and assets outside the source sheets.
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")).sprites : {};

/**
 * Background → alpha, colour → luminance. Magenta is keyed by hue (with its
 * spill removed on soft edges). Any other flat background (the model sometimes
 * paints black) is flood-filled from the borders with a tight tolerance, so
 * dark areas inside the figure survive.
 */
async function key(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const lum = new Float32Array(w * h);
  const alpha = new Uint8Array(w * h).fill(255);
  const px = (i) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
  const corners = [0, w - 1, (h - 1) * w, h * w - 1].map(px);
  const bg = [0, 1, 2].map((c) => corners.reduce((s, p) => s + p[c], 0) / 4);
  const magenta = bg[0] > 180 && bg[2] > 180 && bg[1] < 90;
  if (magenta) {
    for (let i = 0; i < w * h; i++) {
      const [r, g, b] = px(i);
      const m = Math.min(r, b) - g;
      alpha[i] = m > 150 ? 0 : m > 70 ? Math.round(255 * (1 - (m - 70) / 80)) : 255;
    }
  } else {
    const dist = (i) => {
      const p = px(i);
      return Math.max(Math.abs(p[0] - bg[0]), Math.abs(p[1] - bg[1]), Math.abs(p[2] - bg[2]));
    };
    const queue = [];
    const visit = (i) => {
      if (alpha[i] === 0 || dist(i) > 16) return;
      alpha[i] = 0;
      queue.push(i);
    };
    for (let x = 0; x < w; x++) (visit(x), visit((h - 1) * w + x));
    for (let y = 0; y < h; y++) (visit(y * w), visit(y * w + w - 1));
    while (queue.length) {
      const i = queue.pop();
      const x = i % w, y = (i / w) | 0;
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (y > 0) visit(i - w);
      if (y < h - 1) visit(i + w);
    }
  }
  for (let i = 0; i < w * h; i++) {
    const [r, g, b] = px(i);
    const soft = magenta && alpha[i] < 255;
    const rr = soft ? Math.min(r, g + 40) : r;
    const bb = soft ? Math.min(b, g + 40) : b;
    lum[i] = (0.3 * rr + 0.59 * g + 0.11 * bb) / 255;
  }
  return { w, h, lum, alpha };
}

function bbox(img, x0 = 0, x1 = img.w - 1) {
  let bx0 = img.w, by0 = img.h, bx1 = -1, by1 = -1;
  for (let y = 0; y < img.h; y++) {
    for (let x = x0; x <= x1; x++) {
      if (img.alpha[y * img.w + x] <= 40) continue;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
  }
  return bx1 < 0 ? null : { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 };
}

/** Contrast-stretched grayscale RGBA of the whole image (stats from `boxes`). */
function grade(img, boxes) {
  const vals = [];
  for (const b of boxes) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    const i = y * img.w + x;
    if (img.alpha[i] > 200) vals.push(img.lum[i]);
  }
  vals.sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.02)] ?? 0;
  const hi = vals[Math.floor(vals.length * 0.98)] ?? 1;
  const out = Buffer.alloc(img.w * img.h * 4);
  for (let i = 0; i < img.w * img.h; i++) {
    let v = Math.min(1, Math.max(0, (img.lum[i] - lo) / Math.max(0.01, hi - lo)));
    v = v * v * (3 - 2 * v) * 0.85 + v * 0.15;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = Math.round(v * 255);
    out[i * 4 + 3] = img.alpha[i];
  }
  return out;
}

/** Crops/scales with transparent padding; (ax, ay) is the anchor in image pixels. */
async function emit(name, img, graded, box, k, ax, ay) {
  const tw = Math.max(1, Math.round(box.w * k));
  const th = Math.max(1, Math.round(box.h * k));
  const { data } = await sharp(graded, { raw: { width: img.w, height: img.h, channels: 4 } })
    .extract({ left: box.x, top: box.y, width: box.w, height: box.h })
    .resize(tw, th, { kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  // Keep padding transparent. Outlines depend on overlapping player colours.
  const W = tw + RING * 2;
  const H = th + RING * 2;
  const out = Buffer.alloc(W * H * 4);
  const solid = (x, y) => x >= 0 && y >= 0 && x < tw && y < th && data[(y * tw + x) * 4 + 3] > 110;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = x - RING, sy = y - RING;
      const o = (y * W + x) * 4;
      if (solid(sx, sy)) {
        const i = (sy * tw + sx) * 4;
        out[o] = data[i]; out[o + 1] = data[i + 1]; out[o + 2] = data[i + 2]; out[o + 3] = 255;
        continue;
      }
    }
  }
  await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toFile(resolve(OUT, `${name}.png`));
  // The anchor (the diamond's centre) in the padded sprite.
  manifest[name] = {
    ...manifest[name],
    width: W / SCALE,
    height: H / SCALE,
    anchorX: ((ax - box.x) * k + RING) / W,
    anchorY: ((ay - box.y) * k + RING) / H,
  };
}

for (const [file, objects] of Object.entries(LAYOUT)) {
  const path = resolve(RAW, file);
  if (!existsSync(path)) {
    console.log(`skip ${file}`);
    continue;
  }
  const img = await key(path);
  const u = img.w / TEMPLATE_W; // the render may not keep the template's size
  const boxes = objects.map((o, i) => {
    const left = i === 0 ? 0 : Math.round(((objects[i - 1].cx + o.cx) / 2) * u);
    const right = i === objects.length - 1 ? img.w - 1 : Math.round(((o.cx + objects[i + 1].cx) / 2) * u);
    return bbox(img, left, right);
  });
  const graded = grade(img, boxes.filter(Boolean));
  const tallest = Math.max(...boxes.filter((b) => b !== null).map((b) => b.h));
  for (const [i, o] of objects.entries()) {
    if (!boxes[i]) continue;
    const k = "fh" in o ? (o.fh * SCALE - 2 * RING) / tallest : (o.fw * SCALE) / (o.dw * u);
    // Units stand on their soles: the renders don't keep the diamond's height exactly.
    const ay = "fh" in o ? boxes[i].y + boxes[i].h - 1 : o.cy * u;
    await emit(o.name, img, graded, boxes[i], k, o.cx * u, ay);
  }
  console.log(`${file}: ${objects.map((o) => o.name).join(" ")}`);
}
writeFileSync(resolve(OUT, "manifest.json"), JSON.stringify({ scale: SCALE, sprites: manifest }, null, 1));
