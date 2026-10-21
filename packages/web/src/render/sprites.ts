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
import { currentKind } from "@castellan/shared";
import { CLIP_ART } from "./clips";
import { spriteMasks } from "./xray";
import { averageTerrainPatches } from "./terrain";
import { isCharacter, normalizeCharacterContrast } from "./characterContrast";

export const TILE_W = 32;
export const TILE_H = 16;
/** Half-resolution distribution for the landing's fixed, whole-map view, and for phones. */
export const HERO_SPRITE_BASE = "/game-assets/hero-sprites";
const FULL_SPRITE_BASE = "/game-assets/sprites";

/**
 * Full atlases and their masks run past the memory iOS Safari allows a tab, which
 * then reloads in a loop. Touch screens get the half-resolution set instead.
 */
function defaultSpriteBase() {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? HERO_SPRITE_BASE : FULL_SPRITE_BASE;
}

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
interface Facing {
  art: SpriteArt;
  flip: boolean;
}

/**
 * Screen directions 0..7 = S, SE, E, NE, N, NW, W, SW. Turnaround sheets hold
 * S, SE, E, NE, N (files _0.._4); the west half is mirrored.
 */
const SHEET_VIEW = [0, 1, 2, 3, 4, 3, 2, 1];
const MIRRORED = [false, false, false, false, false, true, true, true];

export interface AnimationFrame { action: "idle" | "walk" | "shoot" | "attack" | "death" | "mine" | "damaged25" | "damaged50" | "fire25" | "fire50" | "death25" | "death50" | "deathFire25" | "deathFire50"; frame: number }
export type SpriteSet = (kind: string, dir?: number, animation?: AnimationFrame) => Facing;

/** Atlas cells have a local ground anchor, shared by all texture passes. */
export function animationCell(art: SpriteArt, frame: { x: number; y: number; width: number; height: number; displayWidth?: number; displayHeight?: number }): SpriteArt {
  return { ...cropSpriteArt(art, frame), anchorX: art.anchorX, anchorY: art.anchorY };
}

/** Select one sprite from a source image without moving its ground anchor. */
export function cropSpriteArt(art: SpriteArt, frame: { x: number; y: number; width: number; height: number; displayWidth?: number; displayHeight?: number }): SpriteArt {
  const crop = (texture: Texture) => new Texture({
    source: texture.source,
    frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
    // Reduced atlases round each cell up to whole pixels. Its display rectangle
    // keeps the original footprint and ground anchor despite that rounding.
    orig: new Rectangle(0, 0, frame.displayWidth ?? frame.width, frame.displayHeight ?? frame.height),
  });
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
export function loadSprites(base = defaultSpriteBase()): Promise<SpriteSet> {
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
    sprites: Record<string, { format?: "svg" | "webp"; anchorX?: number; anchorY: number; rasterWidth?: number; rasterHeight?: number; displayWidth?: number; displayHeight?: number; frame?: { x: number; y: number; width: number; height: number } }>;
  };
  const arts = new Map<string, SpriteArt>();
  const statics = Promise.all(
    Object.entries(manifest.sprites).map(async ([name, m]) => {
      const img = await loadImage(`${base}/${name}.${m.format ?? "png"}`);
      let art = { ...derive(img, m.rasterWidth, m.rasterHeight, Math.round(manifest.scale), name), scale: 1 / manifest.scale, anchorX: m.anchorX ?? 0.5, anchorY: m.anchorY };
      if (m.displayWidth !== undefined) art = animationCell(art, { x: 0, y: 0, width: art.texture.width, height: art.texture.height, displayWidth: m.displayWidth, displayHeight: m.displayHeight });
      arts.set(name, m.frame ? cropSpriteArt(art, m.frame) : art);
    }),
  );
  const animations = new Map<string, SpriteArt[][]>();
  const animated = Promise.all(CLIP_ART.map(async kind => {
    const metadata = await fetch(`${base}/${kind}/manifest.json`).then((r) => r.json()) as Partial<Record<AnimationFrame["action"], {
      available?: boolean; image: string; frameCount: number; columns?: number; frameWidth: number; frameHeight: number; displayWidth?: number; displayHeight?: number; storedScale: number; anchorX: number; anchorY: number; rows: string[];
    }>>;
    await Promise.all(Object.entries(metadata).map(async ([action, m]) => {
      if (m.available === false) return;
      const img = await loadImage(`${base}/${kind}/${m.image}`);
      const atlas = { ...derive(img, undefined, undefined, Math.round(m.storedScale), kind, action as AnimationFrame["action"]), scale: 1 / m.storedScale, anchorX: m.anchorX, anchorY: m.anchorY };
      const columns = m.columns ?? m.frameCount;
      animations.set(`${kind}:${action}`, m.rows.map((_, row) => Array.from({ length: m.frameCount }, (_, frame) => animationCell(atlas, {
        x: (frame % columns) * m.frameWidth, y: (row * Math.ceil(m.frameCount / columns) + Math.floor(frame / columns)) * m.frameHeight, width: m.frameWidth, height: m.frameHeight, displayWidth: m.displayWidth, displayHeight: m.displayHeight,
      }))));
    }));
  }));
  await Promise.all([statics, animated]);
  const fallback = arts.get("knight_2") ?? [...arts.values()][0];
  return (kind, dir = 2, animation) => {
    kind = currentKind(kind);
    if (animation) {
      // Buildings have one view, never mirrored; units a turnaround.
      const rows = animations.get(`${kind}:${animation.action}`);
      const single = rows?.length === 1;
      const frames = rows?.[single ? 0 : SHEET_VIEW[dir]];
      if (frames) return { art: frames[Math.max(0, Math.min(frames.length - 1, Math.floor(animation.frame)))], flip: single ? false : MIRRORED[dir] };
    }
    const view = arts.get(`${kind}_${SHEET_VIEW[dir]}`);
    if (view) return { art: view, flip: MIRRORED[dir] };
    // Single renders face right (E): mirror for the west half.
    return { art: arts.get(kind) ?? fallback, flip: dir >= 5 };
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

/**
 * Builds the sprite texture of `name` (a static sprite, or a kind's `action` clip) plus its silhouette and x-ray variants.
 * Characters get their contrast normalized. Collapses and fire no longer take part in the depth and x-ray passes:
 * their larger cells need only colour, avoiding unused atlas masks.
 */
function derive(img: HTMLImageElement, rasterWidth = img.naturalWidth, rasterHeight = Math.round(img.naturalHeight * rasterWidth / img.naturalWidth), maskRadius: number, name: string, action?: AnimationFrame["action"]): Pick<SpriteArt, "texture" | "silhouette" | "xray" | "outline"> {
  const character = isCharacter(name);
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
  const texture = Texture.from(base);
  texture.source.scaleMode = "linear";
  if (!character && action && /^(death|fire)/.test(action)) return { texture, silhouette: texture, xray: [] };
  const masks = spriteMasks(src, w, h, maskRadius);
  const make = (pixels: Uint8ClampedArray<ArrayBuffer>) => {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    cv.getContext("2d")!.putImageData(new ImageData(pixels, w, h), 0, 0);
    const t = Texture.from(cv);
    t.source.scaleMode = "nearest";
    return t;
  };
  return {
    texture,
    silhouette: make(masks.silhouette),
    xray: masks.xray.map(make),
    outline: masks.outline.map(make),
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
