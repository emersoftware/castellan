/**
 * Sprites generated from rendered art (see scripts/assets.mjs): grayscale +
 * alpha with a black outline, stored at `scale`× their on-screen size. The
 * renderer tints them with a ramp key; nothing here knows about teams.
 *
 * Each sprite also gets a silhouette (for the occlusion depth pass) and x-ray
 * textures (an outline ring over a black interior) used where a unit is hidden
 * behind a building or a rock.
 */
import { Texture } from "pixi.js";

export const TILE_W = 32;
export const TILE_H = 16;

export interface SpriteArt {
  texture: Texture;
  /** White where the sprite is solid: drawn tinted with a depth code. */
  silhouette: Texture;
  /** Outline ring + black interior, per player colour (ring blue channel 1.0, 0.8, 0.6, 0.4; interior 0.15). */
  xray: Texture[];
  /** Display scale to apply (1/stored scale). */
  scale: number;
  /** The point that stands on the tile centre, 0..1 of the width/height. */
  anchorX: number;
  anchorY: number;
}

/** The art to draw for a kind facing a screen direction, and whether to mirror it. */
export interface Facing {
  art: SpriteArt;
  flip: boolean;
}

/** Game kind → sprite file. */
const FILES: Record<string, string> = {
  agent: "agent", worker: "worker", knight: "knight", ranger: "ranger",
  nexus: "nexus", turret: "tower", wall: "wall", wallpost: "wallpost", deposit: "gold", rock: "rock",
};

/**
 * Screen directions 0..7 = S, SE, E, NE, N, NW, W, SW. Turnaround sheets hold
 * S, SE, E, NE, N (files _0.._4); the west half is mirrored.
 */
const SHEET_VIEW = [0, 1, 2, 3, 4, 3, 2, 1];
const MIRRORED = [false, false, false, false, false, true, true, true];

export type SpriteSet = (kind: string, dir?: number) => Facing;

export async function loadSprites(base = "/sprites"): Promise<SpriteSet> {
  const manifest = (await fetch(`${base}/manifest.json`).then((r) => r.json())) as {
    scale: number;
    sprites: Record<string, { anchorX?: number; anchorY: number }>;
  };
  const arts = new Map<string, SpriteArt>();
  await Promise.all(
    Object.entries(manifest.sprites).map(async ([name, m]) => {
      const img = await loadImage(`${base}/${name}.png`);
      arts.set(name, { ...derive(img), scale: 1 / manifest.scale, anchorX: m.anchorX ?? 0.5, anchorY: m.anchorY });
    }),
  );
  const fallback = arts.get("knight") ?? arts.get("knight_2") ?? [...arts.values()][0];
  return (kind, dir = 2) => {
    const file = FILES[kind] ?? kind;
    const view = arts.get(`${file}_${SHEET_VIEW[dir]}`);
    if (view) return { art: view, flip: MIRRORED[dir] };
    // Single renders face right (E): mirror for the west half.
    return { art: arts.get(file) ?? fallback, flip: dir >= 5 };
  };
}

/** Screen direction 0..7 (S, SE, E, NE, N, NW, W, SW) of a screen-space vector. */
export function screenDir(dx: number, dy: number): number {
  const a = Math.atan2(dy, dx); // 0 = east, +π/2 = south
  const octant = Math.round(a / (Math.PI / 4));
  return [2, 1, 0, 7, 6, 5, 4, 3][((octant % 8) + 8) % 8] ?? 2;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error(`cannot load ${src}`));
    img.src = src;
  });
}

/** Builds the sprite texture plus its silhouette and x-ray variants. */
function derive(img: HTMLImageElement): Pick<SpriteArt, "texture" | "silhouette" | "xray"> {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const base = document.createElement("canvas");
  base.width = w;
  base.height = h;
  const ctx = base.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const src = ctx.getImageData(0, 0, w, h).data;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && src[(y * w + x) * 4 + 3] > 127;
  const make = (fill: (x: number, y: number, ring: boolean) => [number, number, number] | null) => {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const c = cv.getContext("2d")!;
    const out = c.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!solid(x, y)) continue;
        // The ring: solid pixels within 3 stored px (1 screen px) of the edge.
        let ring = false;
        for (let d = 1; d <= 3 && !ring; d++) ring = !solid(x - d, y) || !solid(x + d, y) || !solid(x, y - d) || !solid(x, y + d);
        const col = fill(x, y, ring);
        if (!col) continue;
        const i = (y * w + x) * 4;
        [out.data[i], out.data[i + 1], out.data[i + 2], out.data[i + 3]] = [...col, 255];
      }
    }
    c.putImageData(out, 0, 0);
    const t = Texture.from(cv);
    t.source.scaleMode = "nearest";
    return t;
  };
  const texture = Texture.from(base);
  texture.source.scaleMode = "linear";
  return {
    texture,
    silhouette: make(() => [255, 255, 255]),
    xray: [255, 204, 153, 102].map((b) => make((_x, _y, ring) => (ring ? [255, 255, b] : [255, 255, 38]))),
  };
}

/** Smooth value noise in [0,1]. */
function noise(x: number, y: number, seed: number): number {
  const h = (i: number, j: number) => {
    let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 982451653);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = h(xi, yi) + (h(xi + 1, yi) - h(xi, yi)) * s(fx);
  const b = h(xi, yi + 1) + (h(xi + 1, yi + 1) - h(xi, yi + 1)) * s(fx);
  return a + (b - a) * s(fy);
}

/**
 * The map's ground, in the terrain key (green channel only): mostly dark, so
 * the dither leaves black showing between sparse green dots.
 */
export function terrainTexture(width: number, height: number): { texture: Texture; originX: number; originY: number } {
  const w = (width + height) * (TILE_W / 2);
  const h = (width + height) * (TILE_H / 2);
  const ox = height * (TILE_W / 2);
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h + 8;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(w, h + 8);
  const px = img.data;
  for (let sy = 0; sy < h + 8; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const u = (sx - ox) / (TILE_W / 2);
      const v = (sy - TILE_H / 2) / (TILE_H / 2);
      const mx = (u + v) / 2 + 0.5;
      const my = (v - u) / 2 + 0.5;
      if (mx < 0 || my < 0 || mx > width || my > height) continue;
      const n = noise(mx / 4, my / 4, 7) * 0.6 + noise(mx / 1.3, my / 1.3, 11) * 0.4;
      const shade = 1.1 - ((mx + my) / (width + height)) * 0.35;
      const L = (0.02 + n * n * 0.34) * shade;
      const i = (sy * w + sx) * 4;
      px[i + 1] = Math.round(Math.min(1, L) * 255);
      px[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Brighter grass tufts.
  for (let i = 0; i < width * height * 0.9; i++) {
    const x = noise(i * 1.7, 3, 5) * width;
    const y = noise(5, i * 1.3, 9) * height;
    const cx = ox + (x - y) * (TILE_W / 2);
    const cy = (x + y) * (TILE_H / 2) + TILE_H / 2;
    ctx.strokeStyle = `rgba(0,${90 + (i % 5) * 25},0,0.9)`;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - 0.6, cy - 1.8);
    ctx.moveTo(cx + 0.8, cy);
    ctx.lineTo(cx + 1.2, cy - 1.5);
    ctx.stroke();
  }
  const texture = Texture.from(cv);
  texture.source.scaleMode = "linear";
  return { texture, originX: ox, originY: TILE_H / 2 };
}
