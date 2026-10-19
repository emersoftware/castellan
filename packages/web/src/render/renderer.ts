/**
 * Isometric renderer in the spirit of Age of Empires, drawn through a
 * monochrome-ramp dither: each side, the grass, the mineral and the rest each
 * live on their own black-to-light ramp. Feed it one state per game tick with `setFrame`; it
 * interpolates movement, turns events into effects and sounds, and leaves
 * corpses on the field.
 */
import { Application, Container, Graphics, RenderTexture, Sprite, Text, type Filter } from "pixi.js";
import type { DepositView, EntityView, GameEvent, KindSpec, ProjectileView, Ruleset, SoundName, SpectatorView } from "@aoa/shared";
import type { CameraBox } from "../showcaseCamera";
import { TILE_H, TILE_W, loadSprites, screenDir, terrainTexture, type SpriteArt, type SpriteSet } from "./sprites";
import type { ClipArt } from "./clips";
import { createOutlineFilter, createXrayFilter, depthTint, occluderTint } from "./xray";
import { createDitherFilter } from "./dither";
import { createDissolveFilter } from "./dissolve";
import { RAMPS, PLAYER_RAMPS, dim } from "./palette";
import { depositSprite, initialDepositAmount } from "./deposits";

import { barrierAxes, currentKind, NEUTRAL_OWNER } from "@aoa/shared";

import { animatedUnit, buildingLook, fall, strikeMs, unitLook, type FireLook, type Strike } from "./look";
import { corpseFade } from "./corpseFade";

export interface HoverInfo {
  x: number;
  y: number;
  rock?: boolean;
  terrainWall?: boolean;
  entity?: EntityView;
  deposit?: DepositView;
}

/** Plays a named sound effect, panned -1 (left) … 1 (right). */
export type SoundSink = (name: SoundName, pan: number, volume: number) => void;
/** Only units on screen are heard walking and mining. */
const ON_SCREEN_ONLY = new Set<SoundName>(["footstep", "pick"]);

interface Drawn {
  view: EntityView;
  sprite: Sprite;
  shadow: Graphics;
  bar: Graphics;
  /** Player colour index (PLAYER_RAMPS). */
  color: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Screen direction 0..7 (S, SE, E, NE, N, NW, W, SW) the unit faces. */
  dir: number;
  shot?: Strike;
  /** Simulation time of the next possible tile step; unchanged ticks are not idle. */
  walkUntil?: number;
  step?: { at: number; ms: number };
  /** Grid steps completed before the current interpolated step. */
  walkDistance?: number;
  /** Units: drawn where an occluder hides them. Buildings: their depth silhouette. */
  xray: Sprite | null;
  outline: Sprite | null;
  depth: Sprite | null;
  flashUntil: number;
  lungeUntil: number;
  lunge: { x: number; y: number };
  /** Half-tile footfalls walked so far, and whether the pick is in the rock: sound cues. */
  footfalls?: number;
  pickDown?: boolean;
  /** Preserve the visible barrier shape and axis when it is destroyed. */
  barrierArt?: ClipArt;
  flame?: Sprite;
  sparks?: Graphics;
  /** One mask clips masonry, flame and particles together at a fixed ground edge. */
  collapseLayer?: Container;
}

interface Effect {
  /** Returns false when finished. */
  update(now: number): boolean;
  /** Remove persistent remains when seeking away from their timeline. */
  destroy?(): void;
}

/** Hero close-ups stop where the hero art (stored at 1.5×) would be enlarged. */
const CLOSE_UP_ZOOM = 1.5;
/** Seconds the hero camera takes to settle on a moving target: centre, then zoom (slower, so it eases in). */
const FOLLOW_S = 1.4, ZOOM_S = 2.2;
/** Handheld sway: screen pixels of drift and the fraction the zoom breathes. */
const SWAY_PX = 7, BREATH = 0.012;
/** Each full layer assembles through the game dither: terrain, structures, then units. */
const REVEAL_LAYER_MS = 350;
interface View { cx: number; cy: number; z: number }
const sameBox = (a: CameraBox | null, b: CameraBox | null) =>
  a === b || (!!a && !!b && a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1);
/** Critically damped approach (Unity's SmoothDamp): eases out without overshoot, and eases in when the target starts moving. */
function smoothDamp(from: number, to: number, velocity: number, smoothS: number, dt: number) {
  const omega = 2 / smoothS, x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = from - to, temp = (velocity + omega * change) * dt;
  return { value: to + (change + temp) * decay, velocity: (velocity - omega * temp) * decay };
}
/** Smooth, non-repeating drift in [-1, 1] from incommensurate sines, like a hand holding the camera. */
const sway = (t: number, phase: number) =>
  (Math.sin(t * 0.69 + phase) + 0.6 * Math.sin(t * 1.43 + phase * 2.1) + 0.3 * Math.sin(t * 2.97 + phase * 3.7)) / 1.9;
const iso = (x: number, y: number) => ({ sx: (x - y) * (TILE_W / 2), sy: (x + y) * (TILE_H / 2) });
/** The piece a barrier shows: a door open or shut, a wall running along one axis (cut for doors beside it), or a post. */
function barrierPiece(view: EntityView, axes: { alongX: boolean; alongY: boolean }, doorAt: (sign: number) => boolean): ClipArt {
  if (view.kind === "door") return view.open ? "door-open" : "door";
  if (axes.alongX === axes.alongY) return "wallpost";
  const left = doorAt(1), right = doorAt(-1);
  if (left && right) return "wall-door-both";
  if (left) return "wall-door-left";
  return right ? "wall-door-right" : "wall";
}
/** Grid steps between two points, Chebyshev like the engine: a diagonal step is one step, so feet keep the same cadence. */
const gridSteps = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export class GameRenderer {
  private app!: Application;
  private sprites!: SpriteSet;
  private root = new Container();
  private world = new Container();
  private ground = new Container();
  private shadows = new Container();
  private objects = new Container();
  private fx = new Container();
  private hoverMark = new Graphics();
  private selectMark = new Graphics();
  private fog = new Graphics();
  private visibility?: string[];
  /** Only units get x-ray outlines, behind buildings of their own colour. */
  private xrayLayer = new Container();
  private outlineLayer = new Container();
  /** Occluders' silhouettes tinted with depth codes, rendered off-screen each frame. */
  private depthWorld = new Container();
  private depthLayer = new Container();
  private depthRT!: RenderTexture;
  private xrayFilter!: Filter;
  private outlineFilter!: Filter;
  /** Static occluders (rocks, mines) and their depth sprites. */
  private staticDepth: { sprite: Sprite; depth: Sprite; x: number; y: number }[] = [];
  private drawn = new Map<string, Drawn>();
  private deposits = new Map<string, { view: DepositView; sprite: Sprite; shadow: Graphics; depth: Sprite }>();
  private effects: Effect[] = [];
  private shots = new Map<string, { graphic: Graphics; from: { x: number; y: number }; to: ProjectileView;
    launchOffset?: { x: number; y: number; at: number } }>();
  private frameAt = 0;
  private tickMs = 100;
  private first = true;
  private gameMs = 0;
  private gameTickMs = 100;
  private lastTick = -1;
  private pausedAt?: number;
  private pauseOffset = 0;
  private zoomLevel = 1;
  private fitted = false;
  /** Hero camera: tiles to frame (`null` the whole map); undefined when the view is the viewer's. */
  private focusBox?: CameraBox | null;
  /** Hero camera: the canvas region (CSS px) where shots are framed; the rest of the canvas shows what lies around them. */
  private area?: { x: number; y: number; w: number; h: number };
  /** Staged entrance: when it started (Infinity while waiting for the text). */
  private revealAt?: number;
  private revealGroundFilter?: ReturnType<typeof createDissolveFilter>;
  /** Restore the real presentation alpha before advancing effects on the next frame. */
  private revealAlphas = new Map<Container, number>();
  /** The hero camera's smoothed view (before sway), its velocities and the last update time. */
  private follow?: { view: View; vx: number; vy: number; vz: number; at: number };
  private hoverCb: (h: HoverInfo | null) => void = () => {};
  private selectCb: (id: string | null) => void = () => {};
  /** The entity the viewer clicked; kept across frames until another click or `select(null)`. */
  private selectedId: string | null = null;
  private hovered: { x: number; y: number } | null = null;
  /** Pointer position in renderer pixels, to pick the sprite under it. */
  private pointer: { x: number; y: number } | null = null;
  /** The entity or deposit under the pointer, outlined on the ground like the selection. */
  private hoverId: string | null = null;
  /** Readable copies of sprite sheets, to hit-test only opaque pixels. */
  private alphaSources = new WeakMap<object, CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null>();
  private resize?: ResizeObserver;
  private width: number;
  private height: number;
  private sound: SoundSink = () => {};
  /** Wall clock by default; a virtual one while recording video. */
  private now: () => number = () => performance.now();

  private constructor(private host: HTMLElement, private ruleset: Ruleset, private colors: Record<string, number>, private fitOnResize = false, private interactive = true, private spriteBase?: string) {
    this.width = ruleset.map.width;
    this.height = ruleset.map.height;
  }

  /** `colors`: each player's colour index (0..3). */
  static async create(host: HTMLElement, ruleset: Ruleset, colors: Record<string, number>, options: { fitOnResize?: boolean; interactive?: boolean; spriteBase?: string } = {}): Promise<GameRenderer> {
    const r = new GameRenderer(host, ruleset, colors, options.fitOnResize, options.interactive, options.spriteBase);
    try { await r.init(); }
    catch (error) {
      // Initialization may fail after WebGL is ready but before assets arrive.
      if (r.app?.renderer) r.destroy();
      throw error;
    }
    return r;
  }

  private async init() {
    this.app = new Application();
    // Fetch/derive art while WebGL initializes. Settle both before cleanup, so a
    // rejected image cannot leak an application that finishes a moment later.
    const [sprites, application] = await Promise.allSettled([
      loadSprites(this.spriteBase),
      this.app.init({ preference: "webgl", antialias: false, resolution: 1, background: "#000000", width: 320, height: 200, autoStart: false }),
    ]);
    if (sprites.status === "rejected") throw sprites.reason;
    if (application.status === "rejected") throw application.reason;
    this.sprites = sprites.value;
    const cv = this.app.canvas;
    Object.assign(cv.style, { width: "100%", height: "100%", imageRendering: "pixelated", display: "block" });
    this.host.appendChild(cv);

    this.objects.sortableChildren = true;
    this.depthLayer.sortableChildren = true;
    this.xrayLayer.sortableChildren = true;
    this.outlineLayer.sortableChildren = true;
    this.depthWorld.addChild(this.depthLayer);
    // Fog darkens the ground only; objects on fogged tiles are dimmed whole (see fogDim), so a
    // tall building is never half-dark where it overlaps tiles of different visibility.
    this.world.addChild(this.ground, this.shadows, this.fog, this.hoverMark, this.selectMark, this.objects, this.outlineLayer, this.xrayLayer, this.fx);
    this.root.addChild(this.world);
    this.root.filters = [createDitherFilter()];
    this.app.stage.addChild(this.root);

    this.buildGround();
    this.fit();
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(this.host);
    if (this.interactive) this.bindInput();
    this.app.ticker.add(() => this.animate());
    this.app.start();
  }

  onSelect(cb: (id: string | null) => void) {
    this.selectCb = cb;
  }

  select(id: string | null) {
    this.selectedId = id;
  }

  onHover(cb: (h: HoverInfo | null) => void) {
    this.hoverCb = cb;
  }

  onSound(sink: SoundSink) {
    this.sound = sink;
  }

  /** Freeze the presentation clock along with a paused replay. */
  setPaused(paused: boolean) {
    if (paused && this.pausedAt === undefined) this.pausedAt = this.now();
    else if (!paused && this.pausedAt !== undefined) {
      this.pauseOffset += this.now() - this.pausedAt;
      this.pausedAt = undefined;
    }
  }

  private presentationNow() { return (this.pausedAt ?? this.now()) - this.pauseOffset; }
  private animationMs(now: number) { return this.gameMs + this.alpha(now) * this.gameTickMs; }

  /** Zoom by a factor around the screen center (0.35×–3×). */
  zoom(factor: number) {
    const next = Math.min(3, Math.max(0.35, this.zoomLevel * factor));
    const cx = this.app.renderer.width / 2;
    const cy = this.app.renderer.height / 2;
    const wx = (cx - this.world.x) / this.zoomLevel;
    const wy = (cy - this.world.y) / this.zoomLevel;
    this.zoomLevel = next;
    this.world.scale.set(next);
    this.world.position.set(Math.round(cx - wx * next), Math.round(cy - wy * next));
  }

  /**
   * Recordings: show units (and their shadows, marks and effects) or the whole world through a Bayer screen
   * door, 0 hidden … 1 shown, so shots dissolve between games the way the game dithers. A player's fog can go
   * with its units (`fog`).
   */
  dissolve(units: number, world = 1, fog = world) {
    const set = (c: Container, shown: number) => {
      if (shown >= 1) { if (c.filters?.length) c.filters = c.filters.filter((f) => !(f as { shown?: number }).hasOwnProperty("shown")); return; }
      const f = (c.filters?.find((x) => Object.prototype.hasOwnProperty.call(x, "shown")) as (Filter & { shown: number }) | undefined) ?? createDissolveFilter();
      f.shown = shown;
      if (!c.filters?.includes(f)) c.filters = [...(c.filters ?? []), f];
    };
    for (const c of [this.objects, this.shadows, this.outlineLayer, this.xrayLayer, this.fx, this.hoverMark, this.selectMark]) set(c, Math.min(units, world));
    set(this.ground, world);
    set(this.fog, Math.min(fog, world));
  }

  /** Camera for recordings: tile (x, y) at the screen centre (`dy` pixels lower), `zoom` relative to the whole map fitting the screen (1). */
  camera(x: number, y: number, zoom: number, dy = 0) {
    const w = this.app.renderer.width, h = this.app.renderer.height;
    const mapW = (this.width + this.height) * (TILE_W / 2) + 40;
    const mapH = (this.width + this.height) * (TILE_H / 2) + 110;
    this.zoomLevel = Math.min(w / mapW, h / mapH) * zoom;
    this.world.scale.set(this.zoomLevel);
    const c = iso(x, y);
    this.world.position.set(Math.round(w / 2 - c.sx * this.zoomLevel), Math.round(h / 2 + dy - c.sy * this.zoomLevel));
  }

  /**
   * Hero camera: frame `box` (tiles) or, with `null`, the whole map. The box may
   * change every tick; the camera follows it smoothly, with a handheld sway,
   * unless motion is reduced.
   */
  focus(box: CameraBox | null) {
    if (this.focusBox !== undefined && sameBox(this.focusBox, box)) return;
    this.focusBox = box;
    if (this.reducedMotion()) { this.follow = undefined; this.applyView(this.viewFor(box)); return; }
    // The first shot starts framed: nothing glides in when the board appears.
    if (!this.follow) {
      const view = this.viewFor(box);
      this.follow = { view, vx: 0, vy: 0, vz: 0, at: this.now() };
      this.applyView(view);
    }
  }

  /**
   * Hero camera: frame shots inside `area` (canvas CSS px) instead of the whole
   * canvas. The whole map fits the area; close-ups spill over the rest of the canvas.
   */
  setFocusArea(area: { x: number; y: number; w: number; h: number } | undefined) {
    const same = area && this.area && area.x === this.area.x && area.y === this.area.y && area.w === this.area.w && area.h === this.area.h;
    if (same || (!area && !this.area)) return;
    this.area = area;
    if (this.focusBox === undefined || !this.app?.renderer) return;
    const view = this.viewFor(this.focusBox);
    if (this.follow) this.follow = { ...this.follow, view, vx: 0, vy: 0, vz: 0 };
    this.applyView(view);
  }

  /** Where views are framed: the focus area, or the whole canvas. */
  private frameRect() {
    return this.area ?? { x: 0, y: 0, w: this.app.renderer.width, h: this.app.renderer.height };
  }

  /** Prepare every layer while the preceding text is entering. */
  prepareReveal() {
    if (this.reducedMotion()) return;
    this.revealAt = Number.POSITIVE_INFINITY;
    this.revealGroundFilter = createDissolveFilter();
    this.root.filters = [...(this.root.filters ?? []), this.revealGroundFilter];
    this.applyReveal();
  }

  /** Reassemble the board through dither, reversing the game's corpse fade. */
  reveal() {
    if (this.revealAt === undefined) return;
    this.revealAt = this.now();
    this.applyReveal();
  }

  private restoreRevealAlphas() {
    for (const [part, alpha] of this.revealAlphas) if (!part.destroyed) part.alpha = alpha;
    this.revealAlphas.clear();
  }

  private applyReveal() {
    if (this.revealAt === undefined) return;
    this.restoreRevealAlphas();
    const elapsed = this.reducedMotion() ? Infinity : this.now() - this.revealAt;
    // The terrain has no opaque layer behind it, so alpha would be normalized
    // away by the palette shader. Dissolve the whole view through its Bayer
    // pattern until the terrain is complete, then remove this temporary pass.
    if (this.revealGroundFilter) {
      this.revealGroundFilter.shown = 1 - corpseFade(elapsed, 0, REVEAL_LAYER_MS).alpha;
      if (elapsed >= REVEAL_LAYER_MS) {
        this.root.filters = this.root.filters?.filter(f => f !== this.revealGroundFilter) ?? [];
        this.revealGroundFilter.destroy();
        this.revealGroundFilter = undefined;
      }
    }
    if (elapsed >= REVEAL_LAYER_MS * 3) { this.revealAt = undefined; return; }
    const show = (part: Container | null | undefined, amount: number) => {
      if (!part || amount >= 1) return;
      this.revealAlphas.set(part, part.alpha);
      part.alpha *= amount;
    };
    for (const d of this.drawn.values()) {
      const delay = REVEAL_LAYER_MS * (this.ruleset.kinds[d.view.kind]?.building ? 1 : 2);
      const amount = 1 - corpseFade(elapsed, delay, REVEAL_LAYER_MS).alpha;
      // Fade in key-colour space, before the existing palette dither: the same
      // pixels as a corpse disappearing, played backwards. No per-unit filters.
      for (const part of [d.sprite, d.shadow, d.flame, d.sparks]) show(part, amount);
    }
    const units = 1 - corpseFade(elapsed, REVEAL_LAYER_MS * 2, REVEAL_LAYER_MS).alpha;
    for (const part of [this.fx, this.outlineLayer, this.xrayLayer, this.hoverMark, this.selectMark]) show(part, units);
  }

  private reducedMotion() {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  private viewFor(box: CameraBox | null): View {
    const { w, h } = this.frameRect();
    const mapW = (this.width + this.height) * (TILE_W / 2) + 40;
    const mapH = (this.width + this.height) * (TILE_H / 2) + 110;
    const whole = Math.min(2, Math.min(w / mapW, h / mapH));
    if (!box) {
      const c = iso((this.width - 1) / 2, (this.height - 1) / 2);
      return { cx: c.sx, cy: c.sy - 18 / whole, z: whole };
    }
    const corners = [iso(box.x0, box.y0), iso(box.x1, box.y0), iso(box.x0, box.y1), iso(box.x1, box.y1)];
    const left = Math.min(...corners.map(c => c.sx)), right = Math.max(...corners.map(c => c.sx));
    // Room above the northern tiles for the units and buildings standing on them.
    const top = Math.min(...corners.map(c => c.sy)) - 40, bottom = Math.max(...corners.map(c => c.sy));
    const z = Math.max(whole, Math.min(CLOSE_UP_ZOOM, w / (right - left), h / (bottom - top)));
    return { cx: (left + right) / 2, cy: (top + bottom) / 2, z };
  }

  private applyView(v: View) {
    const { x, y, w, h } = this.frameRect();
    this.zoomLevel = v.z;
    this.world.scale.set(v.z);
    this.world.position.set(Math.round(x + w / 2 - v.cx * v.z), Math.round(y + h / 2 - v.cy * v.z));
  }

  /**
   * Advance the hero camera: damp the centre and the zoom (in log scale, so zooming
   * in and out feel alike) towards the target, then add the handheld sway.
   */
  private moveCamera() {
    const f = this.follow;
    if (!f || this.focusBox === undefined) return;
    const now = this.now(), dt = Math.min(0.1, Math.max(0, (now - f.at) / 1000));
    f.at = now;
    const to = this.viewFor(this.focusBox);
    const x = smoothDamp(f.view.cx, to.cx, f.vx, FOLLOW_S, dt), y = smoothDamp(f.view.cy, to.cy, f.vy, FOLLOW_S, dt);
    const z = smoothDamp(Math.log(f.view.z), Math.log(to.z), f.vz, ZOOM_S, dt);
    f.view = { cx: x.value, cy: y.value, z: Math.exp(z.value) };
    f.vx = x.velocity; f.vy = y.velocity; f.vz = z.velocity;
    const t = now / 1000, { cx, cy, z: zoom } = f.view;
    const swayed = zoom * (1 + BREATH * sway(t * 0.6, 4.2));
    this.applyView({ cx: cx + SWAY_PX * sway(t, 0) / swayed, cy: cy + SWAY_PX * sway(t, 1.7) / swayed, z: swayed });
  }

  /**
   * Recording mode: stops the real-time loop. `setTime` moves the virtual clock
   * (call it before `setFrame` too); `draw` renders one frame at that time.
   */
  manualClock(): { setTime(ms: number): void; draw(): void } {
    let t = 0;
    this.now = () => t;
    this.app.ticker.stop();
    return {
      setTime: (ms) => (t = ms),
      draw: () => {
        this.animate();
        this.app.render();
      },
    };
  }

  /**
   * A new game state. `tickMs` is how long until the next one (for interpolation).
   * `jump` (seeking a replay) snaps to the state without animations, effects or sounds.
   */
  setFrame(v: SpectatorView, tickMs: number, jump = false) {
    const now = this.presentationNow();
    const alpha = this.alpha(now);
    const previousGameMs = this.animationMs(now);
    const sameTick = v.tick === this.lastTick;
    const quiet = jump || this.first || sameTick;
    this.lastTick = v.tick;
    if (v.tick > 0 && Number.isFinite(v.timeMs)) this.gameTickMs = v.timeMs / v.tick;
    this.gameMs = v.timeMs ?? v.tick * this.gameTickMs;
    this.tickMs = tickMs;
    // GameCanvas also resends the current snapshot when replay speed changes.
    // Preserve its fraction instead of rewinding the animation by a tick.
    this.frameAt = sameTick && !jump ? now - alpha * tickMs : now;
    this.visibility = v.visibility;
    this.fog.clear();
    for (const rock of this.staticDepth) {
      rock.sprite.visible = !v.visibility || v.visibility[rock.y]?.[rock.x] !== "0";
      rock.sprite.tint = this.fogDim(RAMPS.neutral.key, rock.x, rock.y);
    }
    if (v.visibility) for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      const visibility = v.visibility[y]?.[x];
      if (visibility === "2") continue;
      const { sx, sy } = iso(x, y);
      // Unexplored tiles are opaque, so they can overlap: grow them a pixel so the
      // ground's edge never peeks out as a dotted line along the map border.
      const grow = visibility === "1" ? 0 : 1;
      const hw = TILE_W / 2 + grow * 2, hh = TILE_H / 2 + grow;
      this.fog.poly([sx, sy - hh, sx + hw, sy, sx, sy + hh, sx - hw, sy]).fill({ color: 0x000000, alpha: visibility === "1" ? 0.8 : 1 });
    }
    const seen = new Set<string>();

    for (const e of v.entities) {
      seen.add(e.id);
      const d = this.drawn.get(e.id);
      if (!d) {
        this.addEntity(e);
        continue;
      }
      // A remembered enemy (fog memory) keeps its id: when sighted again it
      // reappears where it is now, not walking there from where it was last seen.
      const recalled = d.view.lastSeenMs !== undefined;
      if (animatedUnit(e.kind)) {
        if (jump || recalled) {
          d.walkUntil = undefined;
          d.step = undefined;
          d.walkDistance = 0;
          d.pickDown = undefined;
          d.from = d.to = { x: e.x, y: e.y };
        }
        else if (e.x !== d.to.x || e.y !== d.to.y) {
          const dx = e.x - d.to.x, dy = e.y - d.to.y;
          // Same timing as the engine: a diagonal step takes diagonalMove times
          // as long, and steps are quantized to ticks (380 ms at 10 Hz is four
          // ticks). Only an actual tile change renews this window.
          const moveMs = (e.stats?.moveMs ?? this.ruleset.kinds[e.kind]?.moveMs ?? this.gameTickMs) * (dx && dy ? this.ruleset.diagonalMove ?? 1 : 1);
          const cadence = Math.max(1, Math.round(moveMs / this.gameTickMs)) * this.gameTickMs;
          const position = this.position(d, alpha, previousGameMs);
          d.walkDistance = (d.walkDistance ?? 0) + gridSteps(position, d.from);
          d.from = position;
          d.to = { x: e.x, y: e.y };
          d.step = { at: this.gameMs, ms: cadence };
          d.walkUntil = this.gameMs + cadence;
          d.dir = screenDir(dx - dy, (dx + dy) / 2);
        }
      } else {
        if (!sameTick || jump || recalled) d.from = jump || recalled ? { x: e.x, y: e.y } : this.position(d, alpha, previousGameMs);
        d.to = { x: e.x, y: e.y };
        const mx = e.x - d.from.x;
        const my = e.y - d.from.y;
        if (Math.abs(mx) + Math.abs(my) > 0.01) d.dir = screenDir(mx - my, (mx + my) / 2);
      }
      d.view = e;
      if (jump) d.shot = undefined;
    }
    for (const [id, d] of this.drawn) {
      if (seen.has(id)) continue;
      this.drawn.delete(id);
      d.bar.destroy();
      d.xray?.destroy();
      d.outline?.destroy();
      d.depth?.destroy();
      if (quiet || (v.visibility && !v.events.some((e) => e.type === "death" && e.id === id))) {
        this.clearCastleFire(d);
        d.sprite.destroy();
        d.shadow.destroy();
      } else this.effects.push(this.corpse(d));
    }

    const depSeen = new Set<string>();
    for (const dv of v.deposits) {
      depSeen.add(dv.id);
      const { art } = this.sprites(depositSprite(dv.amount, initialDepositAmount(this.ruleset.map, dv)));
      let d = this.deposits.get(dv.id);
      if (!d) {
        const { sx, sy } = iso(dv.x, dv.y);
        const sprite = new Sprite(art.texture);
        sprite.anchor.set(art.anchorX, art.anchorY);
        sprite.tint = RAMPS.neutral.key;
        sprite.position.set(sx, sy + 2);
        sprite.zIndex = (dv.x + dv.y) * 10 + 1;
        const shadow = new Graphics().ellipse(sx, sy + 3, 12, 4).fill({ color: 0x000000, alpha: 0.35 });
        this.shadows.addChild(shadow);
        this.objects.addChild(sprite);
        d = { view: dv, sprite, shadow, depth: this.depthSprite(art) };
        this.deposits.set(dv.id, d);
      }
      d.sprite.texture = art.texture;
      d.sprite.anchor.set(art.anchorX, art.anchorY);
      d.sprite.scale.set(art.scale);
      d.sprite.tint = this.fogDim(RAMPS.neutral.key, dv.x, dv.y);
      d.depth.texture = art.silhouette;
      d.view = dv;
    }
    for (const [id, d] of this.deposits) {
      if (depSeen.has(id)) continue;
      if (!quiet && !v.visibility) this.effects.push(this.dust(d.view.x, d.view.y, RAMPS.neutral.key, 10));
      d.sprite.destroy();
      d.shadow.destroy();
      d.depth.destroy();
      this.deposits.delete(id);
    }

    if (jump) {
      this.effects = this.effects.filter((effect) => {
        if (!effect.destroy) return true;
        effect.destroy();
        return false;
      });
      for (const shot of this.shots.values()) shot.graphic.destroy();
      this.shots.clear();
    }
    const activeShots = new Set((v.projectiles ?? []).map((p) => p.id));
    for (const [id, shot] of this.shots) {
      if (activeShots.has(id)) continue;
      // Impact state already includes damage: stop the shot in this same frame.
      shot.graphic.destroy();
      this.shots.delete(id);
    }
    for (const p of v.projectiles ?? []) {
      const shot = this.shots.get(p.id);
      if (shot) {
        if (!sameTick) shot.from = { x: shot.from.x + (shot.to.x - shot.from.x) * alpha, y: shot.from.y + (shot.to.y - shot.from.y) * alpha };
        shot.to = p;
      } else {
        const graphic = new Graphics();
        this.fx.addChild(graphic);
        this.shots.set(p.id, { graphic, from: { x: p.x, y: p.y }, to: p });
      }
    }
    this.layoutWalls();
    if (!quiet) for (const ev of v.events) this.onEvent(ev, now, v.events);
    this.first = false;
    this.refreshHover();
  }

  destroy() {
    this.revealGroundFilter?.destroy();
    this.revealAlphas.clear();
    this.resize?.disconnect();
    this.app.destroy(true, { children: true, texture: false });
  }

  // ───────────────────────── scene ─────────────────────────

  private buildGround() {
    const { texture, originX, originY } = terrainTexture(this.width, this.height);
    const g = new Sprite(texture);
    g.position.set(-originX, -originY);
    this.ground.addChild(g);
    // Terrain walls take the art of their style.
    const style = this.ruleset.map.wallStyle ?? "rock";
    const terrainWall = style === "wall";
    const { art } = this.sprites(style);
    for (const w of this.ruleset.map.walls ?? []) {
      const { sx, sy } = iso(w.x, w.y);
      const r = new Sprite(art.texture);
      r.anchor.set(art.anchorX, art.anchorY);
      r.scale.set(art.scale * (terrainWall ? 1 : 0.85 + ((w.x * 7 + w.y * 13) % 5) * 0.06));
      r.tint = RAMPS.neutral.key;
      r.position.set(sx, sy + (terrainWall ? 0 : 3));
      r.zIndex = (w.x + w.y) * 10 + 4;
      this.objects.addChild(r);
      this.staticDepth.push({ sprite: r, depth: this.depthSprite(art), x: w.x, y: w.y });
    }
  }

  /** An occluder's silhouette in the depth pass. */
  private depthSprite(art: SpriteArt): Sprite {
    const s = new Sprite(art.silhouette);
    this.depthLayer.addChild(s);
    return s;
  }

  /** Mirrors an occluder into the depth pass, tinted with its depth code, its owner's colour and its kind. */
  private syncDepth(src: Sprite, depth: Sprite, colour?: number, kind?: KindSpec) {
    depth.position.copyFrom(src.position);
    depth.scale.copyFrom(src.scale);
    depth.anchor.copyFrom(src.anchor);
    depth.rotation = src.rotation;
    depth.zIndex = src.zIndex;
    depth.tint = occluderTint(src.zIndex, colour, kind);
    depth.visible = src.visible && src.alpha > 0.5;
  }

  /**
   * Walls run along x or y depending on their neighbours: the rendered piece
   * runs along y; mirrored it runs along x; corners and lone walls are posts.
   */
  private layoutWalls() {
    const at = new Map<string, Drawn>();
    for (const d of this.drawn.values()) if (d.view.kind === "wall" || d.view.kind === "door") at.set(`${d.to.x},${d.to.y},${d.view.owner}`, d);
    for (const d of at.values()) {
      const axes = barrierAxes(d.to.x, d.to.y, (x, y) => at.has(`${x},${y},${d.view.owner}`));
      const { alongX, alongY } = axes;
      const kind = barrierPiece(d.view, axes, (sign) => at.get(`${d.to.x + (alongX ? sign : 0)},${d.to.y + (alongY ? sign : 0)},${d.view.owner}`)?.view.kind === "door");
      const { art } = this.sprites(kind);
      d.barrierArt = kind;
      d.sprite.texture = art.texture;
      d.sprite.anchor.set(art.anchorX, art.anchorY);
      d.sprite.scale.set(alongX && !alongY ? -art.scale : art.scale, art.scale);
      if (d.depth) d.depth.texture = art.silhouette;
    }
  }

  /** Canvas at CSS size (the dither dot is one CSS pixel); zoom fits the map on first layout, and on each with `fitOnResize`. */
  private fit() {
    const recenter = this.fitOnResize || !this.fitted;
    this.fitted = true;
    const w = Math.max(64, this.host.clientWidth);
    const h = Math.max(64, this.host.clientHeight);
    this.app.renderer.resize(w, h);
    this.root.filterArea = this.app.screen;
    // Pixi interprets filterArea in the container's local coordinates. This
    // layer lives inside the panned/zoomed world: a screen rectangle here clips
    // everything left of the world's origin. Let Pixi project the unit bounds.
    this.xrayLayer.filterArea = undefined;
    // Keep the depth source alive across resizes: the filters retain references
    // to it while Pixi rebuilds their render instructions for the new viewport.
    if (this.depthRT) this.depthRT.resize(w, h);
    else this.depthRT = RenderTexture.create({ width: w, height: h, scaleMode: "nearest" });
    if (!this.xrayFilter) {
      this.xrayFilter = createXrayFilter(this.depthRT);
      this.xrayLayer.filters = [this.xrayFilter];
      this.outlineFilter = createOutlineFilter(this.depthRT);
      this.outlineLayer.filters = [this.outlineFilter];
    } else {
      this.xrayFilter.resources.uDepth = this.depthRT.source;
      this.xrayFilter.resources.xrayUniforms.uniforms.uScreen = new Float32Array([w, h]);
      this.outlineFilter.resources.uDepth = this.depthRT.source;
      this.outlineFilter.resources.xrayUniforms.uniforms.uScreen = new Float32Array([w, h]);
    }
    if (this.focusBox !== undefined) {
      // A new size reframes the current shot at once.
      const view = this.viewFor(this.focusBox);
      if (this.follow) this.follow = { ...this.follow, view, vx: 0, vy: 0, vz: 0 };
      this.applyView(view);
      return;
    }
    if (!recenter) return;
    const mapW = (this.width + this.height) * (TILE_W / 2) + 40;
    const mapH = (this.width + this.height) * (TILE_H / 2) + 110;
    // Decorative previews fit the whole map even on narrow phone screens.
    const minZoom = this.interactive ? 0.35 : 0;
    this.zoomLevel = Math.min(2, Math.max(minZoom, Math.min(w / mapW, h / mapH)));
    this.world.scale.set(this.zoomLevel);
    const c = iso((this.width - 1) / 2, (this.height - 1) / 2);
    this.world.position.set(Math.round(w / 2 - c.sx * this.zoomLevel), Math.round(h / 2 + 18 - c.sy * this.zoomLevel));
  }

  private addEntity(e: EntityView) {
    const color = this.colorOf(e.owner);
    const spec = this.ruleset.kinds[e.kind];
    // Start facing the middle of the map.
    const c = iso((this.width - 1) / 2, (this.height - 1) / 2);
    const p = iso(e.x, e.y);
    const dir = screenDir(c.sx - p.sx, c.sy - p.sy);
    const { art } = this.sprites(e.kind, dir);
    const sprite = new Sprite(art.texture);
    sprite.anchor.set(art.anchorX, art.anchorY);
    sprite.scale.set(art.scale);
    sprite.tint = this.ownerTint(e.owner);
    // A spawn/reveal can attack in this same frame, before the animation ticker
    // runs. Arrow endpoints must already be on the map, never at Pixi's (0, 0).
    sprite.position.set(p.sx, p.sy + (spec?.building ? 0 : 3));
    let xray: Sprite | null = null;
    let outline: Sprite | null = null;
    const depth = this.depthSprite(art);
    if (!spec?.building) {
      xray = new Sprite(art.xray[color]);
      this.xrayLayer.addChild(xray);
      if (art.outline) {
        outline = new Sprite(art.outline[color]);
        this.outlineLayer.addChild(outline);
      }
    }
    const r = !spec?.building ? 6 : currentKind(e.kind) === "castle" ? 22 : 12;
    const shadow = new Graphics().ellipse(0, 0, r, r / 2.6).fill({ color: 0x000000, alpha: 0.4 });
    this.shadows.addChild(shadow);
    this.objects.addChild(sprite);
    const bar = new Graphics();
    this.fx.addChild(bar);
    this.drawn.set(e.id, {
      view: e, sprite, shadow, bar, color, from: { x: e.x, y: e.y }, to: { x: e.x, y: e.y },
      dir, xray, outline, depth, flashUntil: 0, lungeUntil: 0, lunge: { x: 0, y: 0 },
    });
  }

  // ───────────────────────── per frame ─────────────────────────

  private alpha(now: number) {
    return Math.min(1, Math.max(0, (now - this.frameAt) / this.tickMs));
  }

  private position(d: Drawn, alpha: number, gameMs: number) {
    const k = d.step ? Math.min(1, Math.max(0, (gameMs - d.step.at) / d.step.ms)) : alpha;
    return { x: d.from.x + (d.to.x - d.from.x) * k, y: d.from.y + (d.to.y - d.from.y) * k };
  }

  private animate() {
    this.moveCamera();
    this.restoreRevealAlphas();
    const now = this.presentationNow();
    const a = this.alpha(now);
    const animationMs = this.animationMs(now);
    for (const d of this.drawn.values()) {
      const { x, y } = this.position(d, a, animationMs);
      const { sx, sy } = iso(x, y);
      const moving = (d.from.x !== d.to.x || d.from.y !== d.to.y) && a < 1;
      const building = this.ruleset.kinds[d.view.kind]?.building;
      let ox = 0;
      let oy = 0;
      if (moving && !animatedUnit(d.view.kind)) oy = -Math.abs(Math.sin(a * Math.PI * 2)) * 1.2;
      if (now < d.lungeUntil) {
        const k = Math.sin(((d.lungeUntil - now) / 140) * Math.PI);
        ox = d.lunge.x * k * 2.5;
        oy += d.lunge.y * k * 1.5;
      }
      d.sprite.position.set(sx + ox, sy + oy + (building ? 0 : 3));
      d.sprite.zIndex = Math.round((x + y) * 10) + 5;
      d.sprite.tint = this.fogDim(now < d.flashUntil ? RAMPS.neutral.key : this.ownerTint(d.view.owner), d.to.x, d.to.y);
      if (!building) {
        if (d.shot && animationMs >= d.shot.at + (strikeMs(d.view.kind) ?? 0)) d.shot = undefined;
        // Decide locomotion from confirmed simulation ticks, not the end of
        // one tick's interpolation. This also avoids an idle flash just before
        // the next movement snapshot arrives at the cadence boundary.
        const walked = this.gameMs < (d.walkUntil ?? 0) ? (d.walkDistance ?? 0) + gridSteps({ x, y }, d.from) : undefined;
        const look = unitLook(d.view, d.dir, animationMs, { walked, strike: d.shot });
        d.dir = look.heading;
        // Footfalls and pick strikes follow the animation.
        if (look.footfalls !== undefined && d.footfalls !== undefined && look.footfalls > d.footfalls) this.play("footstep", x, y, 0.2);
        d.footfalls = look.footfalls;
        if (look.pickDown !== undefined && d.pickDown !== undefined && look.pickDown !== d.pickDown) this.play("pick", x, y, 0.4);
        d.pickDown = look.pickDown;
        const { art, flip } = this.sprites(d.view.kind, d.shot?.dir ?? d.dir, look.animation);
        d.sprite.texture = art.texture;
        d.sprite.anchor.set(art.anchorX, art.anchorY);
        d.sprite.scale.set(flip ? -art.scale : art.scale, art.scale);
        if (d.depth) d.depth.texture = art.silhouette;
        if (d.xray) {
          d.xray.texture = art.xray[d.color];
          d.xray.anchor.copyFrom(d.sprite.anchor);
          d.xray.scale.copyFrom(d.sprite.scale);
          d.xray.position.copyFrom(d.sprite.position);
          d.xray.tint = depthTint(d.sprite.zIndex);
          // Hidden units must survive the mask composite behind visible units.
          d.xray.zIndex = -d.sprite.zIndex;
        }
        if (d.outline && art.outline) {
          d.outline.texture = art.outline[d.color];
          d.outline.anchor.copyFrom(d.sprite.anchor);
          d.outline.scale.copyFrom(d.sprite.scale);
          d.outline.position.copyFrom(d.sprite.position);
          d.outline.tint = depthTint(d.sprite.zIndex);
          d.outline.zIndex = d.sprite.zIndex;
        }
      }
      const standing = building ? buildingLook(d.view, animationMs) : undefined;
      if (standing) {
        const { art } = this.sprites(d.view.kind, 1, standing.animation);
        d.sprite.texture = art.texture;
        d.sprite.anchor.set(art.anchorX, art.anchorY);
        d.sprite.scale.set(art.scale);
        if (d.depth) d.depth.texture = art.silhouette;
        const visible = !this.visibility || this.visibility[d.to.y]?.[d.to.x] === '2';
        if (standing.fire && visible) this.drawCastleFire(d, standing.fire);
        else this.clearCastleFire(d);
      }
      // Colour separates overlapping units; only the building tag enables x-ray.
      if (d.depth) this.syncDepth(d.sprite, d.depth, d.view.owner === NEUTRAL_OWNER ? undefined : d.color, this.ruleset.kinds[d.view.kind]);
      d.shadow.position.set(sx, sy + (building ? 2 : 3));
      this.drawBar(d, sx);
    }
    for (const dep of this.deposits.values()) this.syncDepth(dep.sprite, dep.depth);
    for (const o of this.staticDepth) this.syncDepth(o.sprite, o.depth);
    for (const shot of this.shots.values()) {
      const { from, to, graphic } = shot;
      graphic.clear();
      const x = from.x + (to.x - from.x) * a, y = from.y + (to.y - from.y) * a;
      const head = iso(x, y), tail = iso(x - to.vx * 0.035, y - to.vy * 0.035);
      // A archer can shoot before its interpolated step finishes. Start the
      // visible arrow at that sprite and join the real trajectory in one tick.
      if (shot.launchOffset) {
        const k = Math.max(0, 1 - (animationMs - shot.launchOffset.at) / this.gameTickMs);
        head.sx += shot.launchOffset.x * k; head.sy += shot.launchOffset.y * k;
        tail.sx += shot.launchOffset.x * k; tail.sy += shot.launchOffset.y * k;
      }
      graphic.moveTo(tail.sx, tail.sy - 6).lineTo(head.sx, head.sy - 6).stroke({ width: 1, color: 0xaaaaaa });
      graphic.rect(head.sx - 0.5, head.sy - 6.5, 1, 1).fill(0xffffff);
    }
    this.drawSelection(a, animationMs);
    this.effects = this.effects.filter((e) => e.update(now));
    // Apply after effects create their fire/sparks and update their own alpha.
    this.applyReveal();
    // Depth pass for the x-ray: occluders only, in the world's current view.
    this.depthWorld.position.copyFrom(this.world.position);
    this.depthWorld.scale.copyFrom(this.world.scale);
    this.app.renderer.render({ container: this.depthWorld, target: this.depthRT, clear: true, clearColor: [0, 0, 0, 0] });
  }

  /** A colour as seen on tile (x, y): unchanged in sight, darkened like the fog on explored ground. */
  private fogDim(color: number, x: number, y: number): number {
    return !this.visibility || this.visibility[y]?.[x] === "2" ? color : dim(color, 0.2);
  }

  /** Rings on the ground under the selected and hovered entity or deposit, following their drawn position. */
  private drawSelection(alpha: number, animationMs: number) {
    this.selectMark.clear();
    const ring = (id: string | null, selected: boolean) => {
      if (!id) return;
      const d = this.drawn.get(id);
      const deposit = d ? undefined : this.deposits.get(id);
      if (!d && !deposit) return;
      const { x, y } = d ? this.position(d, alpha, animationMs) : deposit!.view;
      const { sx, sy } = iso(x, y);
      const big = d ? this.ruleset.kinds[d.view.kind]?.building : false;
      const w = (big ? 0.62 : 0.4) * TILE_W, h = (big ? 0.62 : 0.4) * TILE_H;
      const color = !selected ? 0xffffff : d ? this.ownerTint(d.view.owner) : 0xffff55;
      this.selectMark.ellipse(sx, sy + 2, w, h).stroke({ width: 1, color, alpha: selected ? 0.95 : 0.6 });
      if (selected) this.selectMark.ellipse(sx, sy + 2, w + 2, h + 1).stroke({ width: 1, color: 0x000000, alpha: 0.5 });
    };
    if (this.hoverId !== this.selectedId) ring(this.hoverId, false);
    ring(this.selectedId, true);
  }

  private drawBar(d: Drawn, sx: number) {
    const { hp, maxHp } = d.view;
    d.bar.clear();
    if (hp >= maxHp) return;
    const w = this.ruleset.kinds[d.view.kind]?.building ? 22 : 12;
    const top = Math.round(d.sprite.y - d.sprite.height - 4);
    const left = Math.round(sx - w / 2);
    d.bar.rect(left - 0.5, top - 0.5, w + 1, 2.5).fill(0x000000);
    d.bar.rect(left, top, (w * hp) / maxHp, 1.5).fill(hp / maxHp > 0.35 ? this.ownerTint(d.view.owner) : RAMPS.neutral.key);
  }

  // ───────────────────────── events → effects & sound ─────────────────────────

  private onEvent(ev: GameEvent, now: number, events: GameEvent[] = []) {
    if (ev.type === "attack") {
      const from = this.drawn.get(ev.from);
      const to = ev.to ? this.drawn.get(ev.to) : undefined;
      if (!from) return;
      // A real shot carries its launch vector even if its target has just died
      // or left the visible frame. Movement heading never defines this facing.
      const projectile = ev.projectile ? this.shots.get(ev.projectile)?.to : undefined;
      const death = events.find((e): e is Extract<GameEvent, { type: "death" }> => e.type === "death" && e.id === ev.to);
      // A shootAt shot has a point instead of a target.
      const targetPosition = to?.to ?? death ?? ev.at;
      if (!targetPosition && !projectile) return;
      const spec = this.ruleset.kinds[from.view.kind];
      const a = iso(from.to.x, from.to.y);
      const b = projectile ? iso(from.to.x + projectile.vx, from.to.y + projectile.vy) : iso(targetPosition!.x, targetPosition!.y);
      const dx = Math.sign(b.sx - a.sx);
      const attackDir = b.sx !== a.sx || b.sy !== a.sy ? screenDir(b.sx - a.sx, b.sy - a.sy) : from.dir;
      if ((spec?.range ?? 1) > 1) {
        from.dir = attackDir;
        // A shot drawn from a clip leaves the shooter's sprite.
        if (strikeMs(from.view.kind) !== undefined) {
          const position = this.position(from, this.alpha(now), this.animationMs(now));
          const visible = iso(position.x, position.y);
          const shot = ev.projectile && this.shots.get(ev.projectile);
          if (shot) shot.launchOffset = { x: visible.sx - a.sx, y: visible.sy - a.sy, at: this.gameMs };
          // Settle at the authoritative tile promptly, without delaying release.
          from.walkDistance = (from.walkDistance ?? 0) + gridSteps(position, from.from);
          from.from = position;
          from.step = { at: this.gameMs, ms: this.gameTickMs };
          from.sprite.position.set(visible.sx, visible.sy + 3);
          from.walkUntil = undefined;
          from.shot = { at: this.gameMs, dir: from.dir };
        }
        if (!ev.projectile && to) this.effects.push(this.arrow(from, to));
        this.play(spec?.building ? "tower" : "arrow", from.to.x, from.to.y, 0.35);
      } else if (targetPosition) {
        const animatedAttack = strikeMs(from.view.kind) !== undefined;
        if (animatedAttack) {
          // The engine may hit one tick after a step. Preserve that step's
          // cadence and walking heading instead of rushing its remainder in
          // one tick; only the strike faces the target during recovery.
          if (this.gameMs >= (from.walkUntil ?? 0)) from.dir = attackDir;
          from.shot = { at: this.gameMs, dir: attackDir };
        } else from.dir = attackDir;
        from.lungeUntil = animatedAttack ? 0 : now + 140;
        from.lunge = { x: dx, y: Math.sign(b.sy - a.sy) };
        if (to) to.flashUntil = now + 90;
        this.effects.push(this.dust(targetPosition.x, targetPosition.y, RAMPS.neutral.key, 3, 5));
        this.play("sword", targetPosition.x, targetPosition.y, 0.5);
      }
    } else if (ev.type === "projectile_end") {
      if (ev.reason !== "miss") {
        this.effects.push(this.dust(ev.x, ev.y, RAMPS.neutral.key, 3, 5));
        this.play("hit", ev.x, ev.y, 0.5);
        const target = ev.target && this.drawn.get(ev.target);
        if (target) target.flashUntil = now + 90;
      }
    } else if (ev.type === "death") {
      const vital = this.ruleset.kinds[ev.kind]?.vital;
      const building = this.ruleset.kinds[ev.kind]?.building;
      this.play(vital ? "horn" : building ? "collapse" : "death", ev.x, ev.y, vital ? 0.8 : building ? 0.7 : 0.4);
      if (vital) this.effects.push(this.floatText(currentKind(ev.kind) === "king" ? "KING DOWN" : `${ev.kind.toUpperCase()} DESTROYED`, ev.x, ev.y, RAMPS.neutral.key, 3200, 12));
    } else if (ev.type === "spawn") {
      const building = this.ruleset.kinds[ev.kind]?.building;
      this.effects.push(this.dust(ev.x, ev.y, 0xaaaaaa, building ? 14 : 6));
      this.play(building ? "build" : "spawn", ev.x, ev.y, 0.5);
    } else if (ev.type === "chat") {
      const king = [...this.drawn.values()].find((d) => d.view.owner === ev.owner && currentKind(d.view.kind) === "king");
      if (king) {
        this.effects.push(this.bubble(`${ev.channel === "private" ? `[private → ${ev.to}] ` : ev.channel === "team" ? "[team] " : ""}${ev.text}`, king));
        this.play("chat", king.to.x, king.to.y, 0.6);
      }
    } else if (ev.type === "match_end") {
      this.play("fanfare", this.width / 2, this.height / 2, 0.6);
    }
  }

  /** Pans with the screen position; quieter the farther off-screen, where footsteps and picks go silent. */
  private play(name: SoundName, x: number, y: number, volume: number) {
    const { sx, sy } = iso(x, y);
    const px = this.world.x + sx * this.zoomLevel;
    const py = this.world.y + sy * this.zoomLevel;
    const w = this.app.renderer.width;
    const h = this.app.renderer.height;
    const pan = Math.max(-1, Math.min(1, (px / w) * 2 - 1));
    const off = Math.max(0, Math.abs(px - w / 2) - w / 2, Math.abs(py - h / 2) - h / 2);
    if (off > 0 && ON_SCREEN_ONLY.has(name)) return;
    this.sound(name, pan, volume * Math.max(0.15, 1 - off / 400));
  }

  /** A fallen unit stays on the field and fades out, like AoE corpses. */
  private corpse(d: Drawn): Effect {
    const { way, art: fallen, at } = fall(d.view, this.ruleset.kinds[d.view.kind], d.barrierArt);
    const collapsing = way === "collapse";
    const animated = collapsing || way === "death";
    const start = this.presentationNow();
    const facing = d.shot?.dir ?? d.dir;
    const barrierFlip = d.sprite.scale.x < 0;
    let previous = start, elapsed = 0;
    d.sprite.tint = collapsing ? this.ownerTint(d.view.owner) : dim(this.ownerTint(d.view.owner), 0.45);
    if (way === "rubble") this.effects.push(this.dust(d.to.x, d.to.y, 0xaaaaaa, 24, 14));
    else if (way === "corpse") {
      d.sprite.anchor.set(0.5, 0.5);
      d.sprite.rotation = (Math.PI / 2) * Math.sign(d.sprite.scale.x);
      d.sprite.y -= 3;
    }
    d.sprite.zIndex -= 3;
    if (collapsing) {
      const layer = new Container(); layer.sortableChildren = true; layer.zIndex = d.sprite.zIndex;
      layer.addChild(d.sprite);
      if (d.flame) layer.addChild(d.flame);
      if (d.sparks) layer.addChild(d.sparks);
      this.objects.addChild(layer); d.collapseLayer = layer;
    }
    const destroy = () => {
      this.clearCastleFire(d);
      if (d.collapseLayer) {
        d.collapseLayer.destroy({ children: true });
        d.collapseLayer = undefined;
      } else d.sprite.destroy();
      d.shadow.destroy();
    };
    return {
      destroy,
      update: (now) => {
        // Follow replay speed, including changes during the fall. Keep advancing
        // after the final snapshot so a lethal King hit can finish its animation.
        elapsed += Math.max(0, now - previous) * (animated ? this.gameTickMs / this.tickMs : 1);
        previous = now;
        const look = at(elapsed);
        if (look.animation) {
          const { art, flip } = this.sprites(fallen, facing, look.animation);
          d.sprite.texture = art.texture;
          d.sprite.anchor.set(art.anchorX, art.anchorY);
          const mirrored = collapsing && d.barrierArt ? barrierFlip : flip;
          d.sprite.scale.set(mirrored ? -art.scale : art.scale, art.scale);
        }
        if (look.fire) this.drawCastleFire(d, look.fire);
        else this.clearCastleFire(d);
        d.sprite.alpha = look.alpha;
        d.shadow.alpha = look.shadow;
        if (d.sprite.alpha > 0) return true;
        destroy();
        return false;
      },
    };
  }

  private clearCastleFire(d: Drawn) {
    d.flame?.destroy(); d.sparks?.destroy();
    d.flame = undefined; d.sparks = undefined;
  }

  /** Fire and sparks use the dedicated key inside the actual game dither pass. */
  private drawCastleFire(d: Drawn, fire: FireLook) {
    const { art } = this.sprites(d.view.kind, 1, fire.animation);
    const layer = d.collapseLayer ?? this.objects;
    if (!d.flame) { d.flame = new Sprite(art.texture); layer.addChild(d.flame); }
    d.flame.texture = art.texture;
    d.flame.anchor.set(art.anchorX, art.anchorY);
    d.flame.scale.set(art.scale);
    d.flame.position.copyFrom(d.sprite.position);
    d.flame.tint = dim(RAMPS.fire.key, fire.intensity);
    d.flame.zIndex = d.sprite.zIndex + 1;
    if (!d.sparks) { d.sparks = new Graphics(); layer.addChild(d.sparks); }
    d.sparks.position.copyFrom(d.sprite.position);
    d.sparks.zIndex = d.sprite.zIndex + 2;
    d.sparks.clear();
    for (const p of fire.particles) {
      d.sparks.rect(p.x, p.y, p.size, p.size).fill(dim(RAMPS.fire.key, p.heat * fire.intensity));
    }
  }

  private dust(x: number, y: number, color: number, n: number, spread = 8): Effect {
    const { sx, sy } = iso(x, y);
    const g = new Graphics();
    this.fx.addChild(g);
    const parts = Array.from({ length: n }, (_, i) => {
      const ang = (i / n) * Math.PI * 2 + Math.random();
      const sp = (0.2 + Math.random()) * (spread / 10);
      return { x: sx, y: sy - 3, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp * 0.5 - 0.4, life: 24 + Math.random() * 16 };
    });
    return {
      update: () => {
        g.clear();
        let alive = false;
        for (const p of parts) {
          if (p.life <= 0) continue;
          p.life--;
          p.vy += 0.03;
          p.x += p.vx;
          p.y += p.vy;
          g.rect(p.x, p.y, 1, 1).fill({ color, alpha: Math.min(1, p.life / 16) });
          alive = true;
        }
        if (!alive) g.destroy();
        return alive;
      },
    };
  }

  /** An arrow on a shallow arc from shooter to target. */
  private arrow(from: Drawn, to: Drawn): Effect {
    const g = new Graphics();
    this.fx.addChild(g);
    const a = { x: from.sprite.x, y: from.sprite.y - from.sprite.height * 0.7 };
    const b = { x: to.sprite.x, y: to.sprite.y - 6 };
    const start = this.presentationNow();
    const ms = 220;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    return {
      update: (now) => {
        const k = (now - start) / ms;
        g.clear();
        if (k >= 1) {
          g.destroy();
          return false;
        }
        const pos = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * dist * 0.18 });
        const p = pos(k);
        const q = pos(Math.max(0, k - 0.06));
        g.moveTo(q.x, q.y).lineTo(p.x, p.y).stroke({ width: 1, color: 0xaaaaaa });
        g.rect(p.x - 0.5, p.y - 0.5, 1, 1).fill(0xffffff);
        return true;
      },
    };
  }

  private floatText(text: string, x: number, y: number, color: number, ms = 1000, size = 8): Effect {
    const { sx, sy } = iso(x, y);
    const t = new Text({ text, style: { fontFamily: size > 9 ? "Times New Roman, Times, serif" : "Arial, Helvetica, sans-serif", fontSize: size, fill: color, stroke: { color: 0x000000, width: 2 } }, resolution: 2 });
    t.anchor.set(0.5, 1);
    t.position.set(sx, sy - 18);
    this.fx.addChild(t);
    const start = this.presentationNow();
    return {
      update: (now) => {
        const k = (now - start) / ms;
        t.y = sy - 18 - k * 12;
        t.alpha = 1 - Math.max(0, k - 0.7) / 0.3;
        if (k < 1) return true;
        t.destroy();
        return false;
      },
    };
  }

  /** A speech scroll that follows the king for a few seconds. */
  private bubble(text: string, d: Drawn): Effect {
    const short = text.length > 80 ? text.slice(0, 77) + "…" : text;
    const box = new Container();
    const t = new Text({ text: short, style: { fontFamily: "Arial, Helvetica, sans-serif", fontSize: 8, fill: 0x000000, wordWrap: true, wordWrapWidth: 110 }, resolution: 2 });
    t.position.set(4, 2);
    const w = Math.ceil(t.width) + 8;
    const h = Math.ceil(t.height) + 4;
    const g = new Graphics();
    g.rect(0, 0, w, h).fill(0xdddddd).stroke({ width: 1, color: PLAYER_RAMPS[d.color].key });
    g.poly([w / 2 - 3, h, w / 2 + 3, h, w / 2, h + 4]).fill(0xdddddd);
    box.addChild(g, t);
    this.fx.addChild(box);
    const start = this.presentationNow();
    return {
      update: (now) => {
        const k = (now - start) / 6000;
        if (k >= 1 || d.sprite.destroyed) {
          box.destroy({ children: true });
          return false;
        }
        box.position.set(Math.round(d.sprite.x - w / 2), Math.round(d.sprite.y - d.sprite.height - h - 6));
        box.alpha = k > 0.85 ? (1 - k) / 0.15 : 1;
        return true;
      },
    };
  }

  // ───────────────────────── input ─────────────────────────

  private bindInput() {
    const cv = this.app.canvas;
    let drag: { x: number; y: number; wx: number; wy: number } | null = null;
    cv.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, wx: this.world.x, wy: this.world.y };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener("pointerup", (e) => {
      // A click (not a drag) selects the visible entity on that tile, or clears the selection.
      if (drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) {
        const picked = this.pointer && this.pickAt(this.pointer.x, this.pointer.y);
        this.selectedId = picked ? picked.view.id : null;
        this.selectCb(this.selectedId);
      }
      drag = null;
    });
    cv.addEventListener("pointerleave", () => {
      this.hovered = null;
      this.pointer = null;
      this.hoverId = null;
      this.refreshHover();
    });
    cv.addEventListener("pointermove", (e) => {
      const rect = cv.getBoundingClientRect();
      const k = rect.width / this.app.renderer.width;
      if (drag) this.world.position.set(Math.round(drag.wx + (e.clientX - drag.x) / k), Math.round(drag.wy + (e.clientY - drag.y) / k));
      const px = ((e.clientX - rect.left) / k - this.world.x) / this.zoomLevel;
      const py = ((e.clientY - rect.top) / k - this.world.y) / this.zoomLevel;
      const gx = Math.round((px / (TILE_W / 2) + py / (TILE_H / 2)) / 2);
      const gy = Math.round((py / (TILE_H / 2) - px / (TILE_W / 2)) / 2);
      this.hovered = gx >= 0 && gy >= 0 && gx < this.width && gy < this.height ? { x: gx, y: gy } : null;
      this.pointer = { x: (e.clientX - rect.left) / k, y: (e.clientY - rect.top) / k };
      this.refreshHover();
    });
    cv.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
  }

  /**
   * The entity or deposit drawn under a canvas point (renderer pixels): among the sprites
   * whose box holds it, the one drawn in front (highest depth), then the smallest. Only
   * what is drawn (and so visible from the current view) can be picked.
   */
  private pickAt(px: number, py: number): { kind: "entity"; view: EntityView } | { kind: "deposit"; view: DepositView } | null {
    let best: { kind: "entity"; view: EntityView } | { kind: "deposit"; view: DepositView } | null = null;
    let front = -Infinity, area = Infinity;
    const consider = (sprite: Sprite, item: NonNullable<typeof best>) => {
      if (!sprite.visible || !sprite.parent) return;
      const b = sprite.getBounds();
      if (px < b.x || px > b.x + b.width || py < b.y || py > b.y + b.height || !this.opaqueAt(sprite, px, py)) return;
      const a = b.width * b.height;
      if (sprite.zIndex < front || (sprite.zIndex === front && a >= area)) return;
      front = sprite.zIndex; area = a;
      best = item;
    };
    for (const d of this.drawn.values()) consider(d.sprite, { kind: "entity", view: d.view });
    for (const d of this.deposits.values()) consider(d.sprite, { kind: "deposit", view: d.view });
    return best;
  }

  /** Whether the sprite's own pixel under a canvas point is opaque (not its transparent margin). */
  private opaqueAt(sprite: Sprite, px: number, py: number): boolean {
    const tex = sprite.texture;
    const res = (tex.source as { resource?: unknown }).resource as (CanvasImageSource & { width?: number; height?: number }) | undefined;
    if (!res || typeof res.width !== "number" || typeof res.height !== "number") return true;
    let ctx = this.alphaSources.get(res);
    if (ctx === undefined) {
      try {
        const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(res.width, res.height) : Object.assign(document.createElement("canvas"), { width: res.width, height: res.height });
        ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        ctx?.drawImage(res, 0, 0);
      } catch { ctx = null; }
      this.alphaSources.set(res, ctx);
    }
    if (!ctx) return true;
    const local = sprite.toLocal({ x: px, y: py });
    const u = Math.floor(local.x + sprite.anchor.x * tex.orig.width - (tex.trim?.x ?? 0));
    const v = Math.floor(local.y + sprite.anchor.y * tex.orig.height - (tex.trim?.y ?? 0));
    if (u < 0 || v < 0 || u >= tex.frame.width || v >= tex.frame.height) return false;
    return ctx.getImageData(tex.frame.x + u, tex.frame.y + v, 1, 1).data[3] > 40;
  }

  private hoverShown = true;
  private refreshHover() {
    this.hoverMark.clear();
    // The sprite under the pointer first (bodies stand above their tile), else the tile itself.
    const picked = this.pointer ? this.pickAt(this.pointer.x, this.pointer.y) : null;
    this.hoverId = picked ? picked.view.id : null;
    const h = picked ? { x: picked.kind === "entity" ? this.drawn.get(picked.view.id)!.to.x : picked.view.x, y: picked.kind === "entity" ? this.drawn.get(picked.view.id)!.to.y : picked.view.y } : this.hovered;
    if (!h || (!picked && this.visibility && this.visibility[h.y]?.[h.x] !== "2")) {
      // Every frame refreshes the hover; telling the page "nothing" again would re-render it per frame.
      if (this.hoverShown) this.hoverCb(null);
      this.hoverShown = false;
      return;
    }
    this.hoverShown = true;
    const { sx, sy } = iso(h.x, h.y);
    // A picked sprite gets a ring under its drawn position (see drawSelection); a bare tile gets a diamond.
    if (!picked) this.hoverMark.poly([sx, sy - TILE_H / 2, sx + TILE_W / 2, sy, sx, sy + TILE_H / 2, sx - TILE_W / 2, sy]).stroke({ width: 1, color: 0xffffff, alpha: 0.7 });
    const entity = picked?.kind === "entity" ? picked.view : picked ? undefined : [...this.drawn.values()].find((d) => d.to.x === h.x && d.to.y === h.y)?.view;
    const deposit = picked?.kind === "deposit" ? picked.view : picked ? undefined : [...this.deposits.values()].find((d) => d.view.x === h.x && d.view.y === h.y)?.view;
    const rock = (this.ruleset.map.walls ?? []).some((w) => w.x === h.x && w.y === h.y);
    this.hoverCb({ x: h.x, y: h.y, entity, deposit,
      rock: rock && this.ruleset.map.wallStyle !== "wall", terrainWall: rock && this.ruleset.map.wallStyle === "wall" });
  }

  // ───────────────────────── helpers ─────────────────────────

  private colorOf(owner: string): number {
    return (this.colors[owner] ?? 0) % PLAYER_RAMPS.length;
  }

  private ownerTint(owner: string): number {
    return owner === NEUTRAL_OWNER ? RAMPS.neutral.key : PLAYER_RAMPS[this.colorOf(owner)].key;
  }

}
