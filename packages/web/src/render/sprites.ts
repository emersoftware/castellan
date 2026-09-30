/**
 * Sprites generated from rendered art (see scripts/assets.mjs): grayscale +
 * alpha, stored at `scale`× their on-screen size. The
 * renderer tints them with a ramp key; nothing here knows about teams.
 *
 * Each sprite also gets a silhouette (for the occlusion depth pass) and x-ray
 * textures (an outline ring over a black interior) used where a unit is hidden
 * behind a building or a rock.
 */
import { Rectangle, Texture } from "pixi.js";
import { xrayMark } from "./xray";
import { averageTerrainPatches } from "./terrain";
import { isCharacter, normalizeCharacterContrast } from "./characterContrast";

export const TILE_W = 32;
export const TILE_H = 16;

export interface SpriteArt {
  texture: Texture;
  /** White where the sprite is solid: drawn tinted with a depth code. */
  silhouette: Texture;
  /** Colour + ring/interior codes for the x-ray shader, one texture per player. */
  xray: Texture[];
  /** Exterior ring, drawn only over a same-colour entity behind this unit. */
  outline?: Texture[];
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
  agent: "king", king: "king", worker: "worker", knight: "knight", ranger: "ranger",
  castle: "castle", nexus: "castle", door: "door", turret: "tower", wall: "wall", wallpost: "wallpost", deposit: "minerals-full", rock: "rock",
};

/**
 * Screen directions 0..7 = S, SE, E, NE, N, NW, W, SW. Turnaround sheets hold
 * S, SE, E, NE, N (files _0.._4); the west half is mirrored.
 */
const SHEET_VIEW = [0, 1, 2, 3, 4, 3, 2, 1];
const MIRRORED = [false, false, false, false, false, true, true, true];

export interface AnimationFrame { action: "idle" | "walk" | "shoot" | "attack" | "death" | "mine"; frame: number }
export type SpriteSet = (kind: string, dir?: number, animation?: AnimationFrame) => Facing;

/** Atlas cells have a local ground anchor, shared by all texture passes. */
export function animationCell(art: SpriteArt, frame: { x: number; y: number; width: number; height: number }): SpriteArt {
  return { ...cropSpriteArt(art, frame), anchorX: art.anchorX, anchorY: art.anchorY };
}

/** Select one sprite from a source image without moving its ground anchor. */
export function cropSpriteArt(art: SpriteArt, frame: { x: number; y: number; width: number; height: number }): SpriteArt {
  const crop = (texture: Texture) => new Texture({ source: texture.source, frame: new Rectangle(frame.x, frame.y, frame.width, frame.height) });
  return {
    ...art,
    anchorX: (art.anchorX * art.texture.width - frame.x) / frame.width,
    anchorY: (art.anchorY * art.texture.height - frame.y) / frame.height,
    texture: crop(art.texture),
    silhouette: crop(art.silhouette),
    xray: art.xray.map(crop),
    outline: art.outline?.map(crop),
  };
}

// Reconnects and replay perspective switches create new renderers. Atlas GPU
// sources are shared; rebuilding their masks on each mount wastes memory.
const spriteLoads = new Map<string, Promise<SpriteSet>>();
export function loadSprites(base = "/sprites"): Promise<SpriteSet> {
  let pending = spriteLoads.get(base);
  if (!pending) {
    pending = buildSprites(base).catch((error) => { spriteLoads.delete(base); throw error; });
    spriteLoads.set(base, pending);
  }
  return pending;
}

async function buildSprites(base: string): Promise<SpriteSet> {
  const manifest = (await fetch(`${base}/manifest.json`).then((r) => r.json())) as {
    scale: number;
    sprites: Record<string, { format?: "svg"; anchorX?: number; anchorY: number; rasterWidth?: number; rasterHeight?: number; frame?: { x: number; y: number; width: number; height: number } }>;
  };
  const arts = new Map<string, SpriteArt>();
  await Promise.all(
    Object.entries(manifest.sprites).map(async ([name, m]) => {
      const img = await loadImage(`${base}/${name}.${m.format ?? "png"}`);
      const art = { ...derive(img, m.rasterWidth, m.rasterHeight, isCharacter(name)), scale: 1 / manifest.scale, anchorX: m.anchorX ?? 0.5, anchorY: m.anchorY };
      arts.set(name, m.frame ? cropSpriteArt(art, m.frame) : art);
    }),
  );
  const fallback = arts.get("knight") ?? arts.get("knight_2") ?? [...arts.values()][0];
  const animations = new Map<string, SpriteArt[][]>();
  await Promise.all(["ranger", "knight", "king", "worker"].map(async kind => {
    const metadata = await fetch(`${base}/${kind}/manifest.json`).then((r) => r.json()) as Partial<Record<AnimationFrame["action"], {
      available?: boolean; image: string; frameCount: number; frameWidth: number; frameHeight: number; storedScale: number; anchorX: number; anchorY: number; rows: string[];
    }>>;
    await Promise.all(Object.entries(metadata).map(async ([action, m]) => {
      if (m.available === false) return;
      const img = await loadImage(`${base}/${kind}/${m.image}`);
      const atlas = { ...derive(img, undefined, undefined, true), scale: 1 / m.storedScale, anchorX: m.anchorX, anchorY: m.anchorY };
      animations.set(`${kind}:${action}`, m.rows.map((_, row) => Array.from({ length: m.frameCount }, (_, frame) => animationCell(atlas, {
        x: frame * m.frameWidth, y: row * m.frameHeight, width: m.frameWidth, height: m.frameHeight,
      }))));
    }));
  }));
  return (kind, dir = 2, animation) => {
    if (animation) {
      const frames = animations.get(`${kind === "agent" ? "king" : kind}:${animation.action}`)?.[SHEET_VIEW[dir]];
      if (frames) return { art: frames[Math.max(0, Math.min(frames.length - 1, Math.floor(animation.frame)))], flip: MIRRORED[dir] };
    }
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
function derive(img: HTMLImageElement, rasterWidth = img.naturalWidth, rasterHeight = Math.round(img.naturalHeight * rasterWidth / img.naturalWidth), character = false): Pick<SpriteArt, "texture" | "silhouette" | "xray" | "outline"> {
  // Generated source art can be large. Rasterize once at game resolution before
  // deriving the masks, preserving alpha and a consistent on-screen footprint.
  const w = rasterWidth;
  const h = rasterHeight;
  const base = document.createElement("canvas");
  base.width = w;
  base.height = h;
  // CPU-backed: reading back a GPU canvas costs ~100 ms per atlas.
  const ctx = base.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const src = imageData.data;
  if (character) {
    normalizeCharacterContrast(src);
    ctx.putImageData(imageData, 0, 0);
  }
  const masks = spriteMasks(src, w, h);
  const make = (pixels: Uint8ClampedArray<ArrayBuffer>) => {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    cv.getContext("2d")!.putImageData(new ImageData(pixels, w, h), 0, 0);
    const t = Texture.from(cv);
    t.source.scaleMode = "nearest";
    return t;
  };
  const texture = Texture.from(base);
  texture.source.scaleMode = "linear";
  return {
    texture,
    silhouette: make(masks.silhouette),
    xray: masks.xray.map(make),
    outline: masks.outline.map(make),
  };
}

/**
 * RGBA mask pixels of a sprite: a white silhouette, per-colour x-ray codes
 * (ring or interior) and per-colour exterior rings. The ring holds pixels
 * within 3 stored px (1 screen px) of the edge along either axis.
 */
export function spriteMasks(src: Uint8ClampedArray, w: number, h: number) {
  const n = w * h;
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) solid[i] = src[i * 4 + 3] > 127 ? 1 : 0;
  // Filled through 32-bit views: bytes R, G, B, A on little-endian hosts.
  const pixel = (b: number) => (0xff000000 | (b << 16) | 0xffff) >>> 0;
  const colours = [0, 1, 2, 3];
  const core = colours.map((c) => pixel(xrayMark(c, false)));
  const ring = colours.map((c) => pixel(xrayMark(c, true)));
  const silhouette = new Uint32Array(n);
  const xray = colours.map(() => new Uint32Array(n));
  const outline = colours.map(() => new Uint32Array(n));
  const [x0, x1, x2, x3] = xray;
  const [o0, o1, o2, o3] = outline;
  // Solid pixels in the 7-px row and column windows around each pixel; outside
  // the image counts as empty. A full window means no edge within 3 px.
  const column = new Uint8Array(w);
  for (let y = 0; y < Math.min(3, h); y++) for (let x = 0; x < w; x++) column[x] += solid[y * w + x];
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < Math.min(3, w); x++) row += solid[y * w + x];
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const s = solid[i];
      if (x + 3 < w) row += solid[i + 3];
      if (y + 3 < h) column[x] += solid[i + 3 * w];
      const edge = s ? row < 7 || column[x] < 7 : row > 0 || column[x] > 0;
      if (x >= 3) row -= solid[i - 3];
      if (y >= 3) column[x] -= solid[i - 3 * w];
      if (s) {
        silhouette[i] = 0xffffffff;
        const mark = edge ? ring : core;
        x0[i] = mark[0]; x1[i] = mark[1]; x2[i] = mark[2]; x3[i] = mark[3];
      } else if (edge) {
        o0[i] = ring[0]; o1[i] = ring[1]; o2[i] = ring[2]; o3[i] = ring[3];
      }
    }
  }
  const bytes = (a: Uint32Array<ArrayBuffer>) => new Uint8ClampedArray(a.buffer);
  return { silhouette: bytes(silhouette), xray: xray.map(bytes), outline: outline.map(bytes) };
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
  const patches = averageTerrainPatches(width, height, (mx, my) => {
    const n = noise(mx / 4, my / 4, 7) * 0.6 + noise(mx / 1.3, my / 1.3, 11) * 0.4;
    const shade = 1.1 - ((mx + my) / (width + height)) * 0.35;
    return Math.min(1, (0.02 + n * n * 0.34) * shade);
  });
  for (let sy = 0; sy < h + 8; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const u = (sx - ox) / (TILE_W / 2);
      const v = (sy - TILE_H / 2) / (TILE_H / 2);
      const mx = (u + v) / 2 + 0.5;
      const my = (v - u) / 2 + 0.5;
      if (mx < 0 || my < 0 || mx >= width || my >= height) continue;
      const L = patches[Math.floor(my * 2) * (width * 2) + Math.floor(mx * 2)];
      const i = (sy * w + sx) * 4;
      px[i + 1] = Math.round(Math.min(1, L) * 255);
      px[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const texture = Texture.from(cv);
  // Keep half-tile boundaries crisp; the final shader supplies the semitones.
  texture.source.scaleMode = "nearest";
  return { texture, originX: ox, originY: TILE_H / 2 };
}
