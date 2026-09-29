/**
 * Isometric renderer in the spirit of Age of Empires, drawn through a
 * monochrome-ramp dither: each side, the grass, the gold and the rest each
 * live on their own black-to-light ramp. Feed it one state per game tick with `setFrame`; it
 * interpolates movement, turns events into effects and sounds, and leaves
 * corpses on the field.
 */
import { Application, Container, Graphics, RenderTexture, Sprite, Text, type Filter } from "pixi.js";
import type { DepositView, EntityView, GameEvent, ProjectileView, Ruleset, SpectatorView } from "@aoa/shared";
import { TILE_H, TILE_W, loadSprites, screenDir, terrainTexture, type SpriteArt, type SpriteSet } from "./sprites";
import { createXrayFilter, depthTint, occluderTint } from "./xray";
import { createDitherFilter } from "./dither";
import { RAMPS, PLAYER_RAMPS, dim } from "./palette";
import { depositSprite, initialDepositAmount } from "./deposits";
import { type RangerShot } from "./rangerAnimation";

import { animatedUnit, unitAnimation, recoveryMs, hasUnitAnimation, unitDeathAnimation, unitMiningAnimation } from "./unitAnimation";

export interface HoverInfo {
  x: number;
  y: number;
  rock?: boolean;
  entity?: EntityView;
  deposit?: DepositView;
}

export type SoundName = "sword" | "arrow" | "tower" | "death" | "collapse" | "spawn" | "build" | "coin" | "horn" | "fanfare" | "chat";
/** Plays a named sound effect, panned -1 (left) … 1 (right). */
export type SoundSink = (name: SoundName, pan: number, volume: number) => void;

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
  shot?: RangerShot;
  /** Simulation time of the next possible tile step; unchanged ticks are not idle. */
  walkUntil?: number;
  step?: { at: number; ms: number };
  /** Distance completed before the current interpolated step, in map tiles. */
  walkDistance?: number;
  /** Units: drawn where an occluder hides them. Buildings: their depth silhouette. */
  xray: Sprite | null;
  outline: Sprite | null;
  depth: Sprite | null;
  flashUntil: number;
  lungeUntil: number;
  lunge: { x: number; y: number };
}

interface Effect {
  /** Returns false when finished. */
  update(now: number): boolean;
  /** Remove persistent remains when seeking away from their timeline. */
  destroy?(): void;
}

const iso = (x: number, y: number) => ({ sx: (x - y) * (TILE_W / 2), sy: (x + y) * (TILE_H / 2) });

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
  private hoverCb: (h: HoverInfo | null) => void = () => {};
  private hovered: { x: number; y: number } | null = null;
  private resize?: ResizeObserver;
  private width: number;
  private height: number;
  private sound: SoundSink = () => {};
  /** Wall clock by default; a virtual one while recording video. */
  private now: () => number = () => performance.now();

  private constructor(private host: HTMLElement, private ruleset: Ruleset, private colors: Record<string, number>) {
    this.width = ruleset.map.width;
    this.height = ruleset.map.height;
  }

  /** `colors`: each player's colour index (0..3). */
  static async create(host: HTMLElement, ruleset: Ruleset, colors: Record<string, number>): Promise<GameRenderer> {
    const r = new GameRenderer(host, ruleset, colors);
    await r.init();
    return r;
  }

  private async init() {
    this.app = new Application();
    await this.app.init({ preference: "webgl", antialias: false, resolution: 1, background: "#000000", width: 320, height: 200 });
    const cv = this.app.canvas;
    Object.assign(cv.style, { width: "100%", height: "100%", imageRendering: "pixelated", display: "block" });
    this.host.appendChild(cv);
    this.sprites = await loadSprites();

    this.objects.sortableChildren = true;
    this.depthLayer.sortableChildren = true;
    this.xrayLayer.sortableChildren = true;
    this.outlineLayer.sortableChildren = true;
    this.depthWorld.addChild(this.depthLayer);
    this.world.addChild(this.ground, this.shadows, this.hoverMark, this.objects, this.outlineLayer, this.xrayLayer, this.fx, this.fog);
    this.root.addChild(this.world);
    this.root.filters = [createDitherFilter()];
    this.app.stage.addChild(this.root);

    this.buildGround();
    this.fit();
    this.resize = new ResizeObserver(() => this.fit(false));
    this.resize.observe(this.host);
    this.bindInput();
    this.app.ticker.add(() => this.animate());
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
    for (const rock of this.staticDepth) rock.sprite.visible = !v.visibility || v.visibility[rock.y]?.[rock.x] !== "0";
    if (v.visibility) for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      const visibility = v.visibility[y]?.[x];
      if (visibility === "2") continue;
      const { sx, sy } = iso(x, y);
      this.fog.poly([sx, sy - TILE_H / 2, sx + TILE_W / 2, sy, sx, sy + TILE_H / 2, sx - TILE_W / 2, sy]).fill({ color: 0x000000, alpha: visibility === "1" ? 0.8 : 1 });
    }
    const seen = new Set<string>();

    for (const e of v.entities) {
      seen.add(e.id);
      const d = this.drawn.get(e.id);
      if (!d) {
        this.addEntity(e);
        continue;
      }
      if (animatedUnit(e.kind)) {
        if (jump) {
          d.walkUntil = undefined;
          d.step = undefined;
          d.walkDistance = 0;
          d.from = d.to = { x: e.x, y: e.y };
        }
        else if (e.x !== d.to.x || e.y !== d.to.y) {
          const moveMs = e.stats?.moveMs ?? this.ruleset.kinds[e.kind]?.moveMs ?? this.gameTickMs;
          // Same quantization as the engine: a 380 ms step at 10 Hz takes
          // four ticks. Only an actual tile change renews this window.
          const cadence = Math.max(1, Math.round(moveMs / this.gameTickMs)) * this.gameTickMs;
          const dx = e.x - d.to.x, dy = e.y - d.to.y;
          const position = this.position(d, alpha, previousGameMs);
          d.walkDistance = (d.walkDistance ?? 0) + Math.hypot(position.x - d.from.x, position.y - d.from.y);
          d.from = position;
          d.to = { x: e.x, y: e.y };
          d.step = { at: this.gameMs, ms: cadence };
          d.walkUntil = this.gameMs + cadence;
          d.dir = screenDir(dx - dy, (dx + dy) / 2);
        }
      } else {
        if (!sameTick || jump) d.from = jump ? { x: e.x, y: e.y } : this.position(d, alpha, previousGameMs);
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
    this.resize?.disconnect();
    this.app.destroy(true, { children: true, texture: false });
  }

  // ───────────────────────── scene ─────────────────────────

  private buildGround() {
    const { texture, originX, originY } = terrainTexture(this.width, this.height);
    const g = new Sprite(texture);
    g.position.set(-originX, -originY);
    this.ground.addChild(g);
    const { art } = this.sprites("rock");
    for (const w of this.ruleset.map.walls ?? []) {
      const { sx, sy } = iso(w.x, w.y);
      const r = new Sprite(art.texture);
      r.anchor.set(art.anchorX, art.anchorY);
      r.scale.set(art.scale * (0.85 + ((w.x * 7 + w.y * 13) % 5) * 0.06));
      r.tint = RAMPS.neutral.key;
      r.position.set(sx, sy + 3);
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

  /** Mirrors an occluder into the depth pass, tinted with its depth code. */
  private syncDepth(src: Sprite, depth: Sprite, colour?: number, building = false) {
    depth.position.copyFrom(src.position);
    depth.scale.copyFrom(src.scale);
    depth.anchor.copyFrom(src.anchor);
    depth.rotation = src.rotation;
    depth.zIndex = src.zIndex;
    depth.tint = occluderTint(src.zIndex, colour, building);
    depth.visible = src.visible && src.alpha > 0.5;
  }

  /**
   * Walls run along x or y depending on their neighbours: the rendered piece
   * runs along y; mirrored it runs along x; corners and lone walls are posts.
   */
  private layoutWalls() {
    const at = new Map<string, Drawn>();
    for (const d of this.drawn.values()) if (d.view.kind === "wall" || d.view.kind === "door") at.set(`${d.to.x},${d.to.y},${d.view.owner}`, d);
    const has = (d: Drawn, dx: number, dy: number) => at.has(`${d.to.x + dx},${d.to.y + dy},${d.view.owner}`);
    for (const d of at.values()) {
      const alongX = has(d, 1, 0) || has(d, -1, 0);
      const alongY = has(d, 0, 1) || has(d, 0, -1);
      const { art } = this.sprites(d.view.kind === "door" ? (d.view.open ? "door-open" : "door") : alongX !== alongY ? "wall" : "wallpost");
      d.sprite.texture = art.texture;
      d.sprite.anchor.set(art.anchorX, art.anchorY);
      d.sprite.scale.set(alongX && !alongY ? -art.scale : art.scale, art.scale);
      if (d.depth) d.depth.texture = art.silhouette;
    }
  }

  /** Canvas at CSS size (the dither dot is one CSS pixel); zoom fits the map on first layout. */
  private fit(recenter = true) {
    const w = Math.max(64, this.host.clientWidth);
    const h = Math.max(64, this.host.clientHeight);
    this.app.renderer.resize(w, h);
    this.root.filterArea = this.app.screen;
    // Pixi interprets filterArea in the container's local coordinates. This
    // layer lives inside the panned/zoomed world: a screen rectangle here clips
    // everything left of the world's origin. Let Pixi project the unit bounds.
    this.xrayLayer.filterArea = undefined;
    this.depthRT?.destroy(true);
    this.depthRT = RenderTexture.create({ width: w, height: h, scaleMode: "nearest" });
    if (!this.xrayFilter) {
      this.xrayFilter = createXrayFilter(this.depthRT);
      this.xrayLayer.filters = [this.xrayFilter];
      this.outlineFilter = createXrayFilter(this.depthRT, true);
      this.outlineLayer.filters = [this.outlineFilter];
    } else {
      this.xrayFilter.resources.uDepth = this.depthRT.source;
      this.xrayFilter.resources.xrayUniforms.uniforms.uScreen = new Float32Array([w, h]);
      this.outlineFilter.resources.uDepth = this.depthRT.source;
      this.outlineFilter.resources.xrayUniforms.uniforms.uScreen = new Float32Array([w, h]);
    }
    if (!recenter) return;
    const mapW = (this.width + this.height) * (TILE_W / 2) + 40;
    const mapH = (this.width + this.height) * (TILE_H / 2) + 110;
    this.zoomLevel = Math.min(2, Math.max(0.35, Math.min(w / mapW, h / mapH)));
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
    sprite.tint = PLAYER_RAMPS[color].key;
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
    const r = spec?.building ? ((e.kind === "castle" || e.kind === "nexus") ? 22 : 12) : 6;
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
      d.sprite.tint = now < d.flashUntil ? RAMPS.neutral.key : PLAYER_RAMPS[d.color].key;
      if (!building) {
        if (d.shot && animationMs >= d.shot.at + recoveryMs(d.view.kind)) d.shot = undefined;
        // Decide locomotion from confirmed simulation ticks, not the end of
        // one tick's interpolation. This also avoids an idle flash just before
        // the next movement snapshot arrives at the cadence boundary.
        const walking = this.gameMs < (d.walkUntil ?? 0);
        const distance = (d.walkDistance ?? 0) + Math.hypot(x - d.from.x, y - d.from.y);
        const mining = !walking && !d.shot ? d.view.gathering : undefined;
        const animation = (mining && unitMiningAnimation(d.view.kind, animationMs)) || unitAnimation(d.view.kind, animationMs, walking, d.shot, distance);
        if (mining) {
          const dx = mining.x - d.view.x, dy = mining.y - d.view.y;
          d.dir = screenDir(dx - dy, (dx + dy) / 2);
        }
        const { art, flip } = this.sprites(d.view.kind, d.shot?.dir ?? d.dir, animation);
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
      // Colour separates overlapping units; only the building tag enables x-ray.
      if (d.depth) this.syncDepth(d.sprite, d.depth, d.color, !!building);
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
      // A ranger can shoot before its interpolated step finishes. Start the
      // visible arrow at that sprite and join the real trajectory in one tick.
      if (shot.launchOffset) {
        const k = Math.max(0, 1 - (animationMs - shot.launchOffset.at) / this.gameTickMs);
        head.sx += shot.launchOffset.x * k; head.sy += shot.launchOffset.y * k;
        tail.sx += shot.launchOffset.x * k; tail.sy += shot.launchOffset.y * k;
      }
      graphic.moveTo(tail.sx, tail.sy - 6).lineTo(head.sx, head.sy - 6).stroke({ width: 1, color: 0xaaaaaa });
      graphic.rect(head.sx - 0.5, head.sy - 6.5, 1, 1).fill(0xffffff);
    }
    this.effects = this.effects.filter((e) => e.update(now));
    // Depth pass for the x-ray: occluders only, in the world's current view.
    this.depthWorld.position.copyFrom(this.world.position);
    this.depthWorld.scale.copyFrom(this.world.scale);
    this.app.renderer.render({ container: this.depthWorld, target: this.depthRT, clear: true, clearColor: [0, 0, 0, 0] });
  }

  private drawBar(d: Drawn, sx: number) {
    const { hp, maxHp } = d.view;
    d.bar.clear();
    if (hp >= maxHp) return;
    const w = this.ruleset.kinds[d.view.kind]?.building ? 22 : 12;
    const top = Math.round(d.sprite.y - d.sprite.height - 4);
    const left = Math.round(sx - w / 2);
    d.bar.rect(left - 0.5, top - 0.5, w + 1, 2.5).fill(0x000000);
    d.bar.rect(left, top, (w * hp) / maxHp, 1.5).fill(hp / maxHp > 0.35 ? PLAYER_RAMPS[d.color].key : RAMPS.neutral.key);
  }

  // ───────────────────────── events → effects & sound ─────────────────────────

  private onEvent(ev: GameEvent, now: number, events: GameEvent[] = []) {
    if (ev.type === "attack") {
      const from = this.drawn.get(ev.from);
      const to = this.drawn.get(ev.to);
      if (!from) return;
      // A real shot carries its launch vector even if its target has just died
      // or left the visible frame. Movement heading never defines this facing.
      const projectile = ev.projectile ? this.shots.get(ev.projectile)?.to : undefined;
      const death = events.find((e): e is Extract<GameEvent, { type: "death" }> => e.type === "death" && e.id === ev.to);
      const targetPosition = to?.to ?? death;
      if (!targetPosition && !projectile) return;
      const spec = this.ruleset.kinds[from.view.kind];
      const a = iso(from.to.x, from.to.y);
      const b = projectile ? iso(from.to.x + projectile.vx, from.to.y + projectile.vy) : iso(targetPosition!.x, targetPosition!.y);
      const dx = Math.sign(b.sx - a.sx);
      if (b.sx !== a.sx || b.sy !== a.sy) from.dir = screenDir(b.sx - a.sx, b.sy - a.sy);
      if ((spec?.range ?? 1) > 1) {
        if (from.view.kind === "ranger") {
          const position = this.position(from, this.alpha(now), this.animationMs(now));
          const visible = iso(position.x, position.y);
          const shot = ev.projectile && this.shots.get(ev.projectile);
          if (shot) shot.launchOffset = { x: visible.sx - a.sx, y: visible.sy - a.sy, at: this.gameMs };
          // Settle at the authoritative tile promptly, without delaying release.
          from.walkDistance = (from.walkDistance ?? 0) + Math.hypot(position.x - from.from.x, position.y - from.from.y);
          from.from = position;
          from.step = { at: this.gameMs, ms: this.gameTickMs };
          from.sprite.position.set(visible.sx, visible.sy + 3);
          from.walkUntil = undefined;
          from.shot = { at: this.gameMs, dir: from.dir };
        }
        if (!ev.projectile && to) this.effects.push(this.arrow(from, to));
        this.play(spec?.building ? "tower" : "arrow", from.to.x, from.to.y, 0.6);
      } else if (targetPosition) {
        if (hasUnitAnimation(from.view.kind, "attack")) {
          const position = this.position(from, this.alpha(now), this.animationMs(now));
          from.walkDistance = (from.walkDistance ?? 0) + Math.hypot(position.x - from.from.x, position.y - from.from.y);
          from.from = position;
          from.step = { at: this.gameMs, ms: this.gameTickMs };
          from.walkUntil = undefined;
          from.shot = { at: this.gameMs, dir: from.dir };
        }
        from.lungeUntil = hasUnitAnimation(from.view.kind, "attack") ? 0 : now + 140;
        from.lunge = { x: dx, y: Math.sign(b.sy - a.sy) };
        if (to) to.flashUntil = now + 90;
        this.effects.push(this.dust(targetPosition.x, targetPosition.y, RAMPS.neutral.key, 3, 5));
        this.play("sword", targetPosition.x, targetPosition.y, 0.5);
      }
    } else if (ev.type === "projectile_end") {
      if (ev.reason !== "miss") {
        this.effects.push(this.dust(ev.x, ev.y, RAMPS.neutral.key, 3, 5));
        const target = ev.target && this.drawn.get(ev.target);
        if (target) target.flashUntil = now + 90;
      }
    } else if (ev.type === "death") {
      const vital = this.ruleset.kinds[ev.kind]?.vital;
      const building = this.ruleset.kinds[ev.kind]?.building;
      this.play(vital ? "horn" : building ? "collapse" : "death", ev.x, ev.y, vital ? 1 : 0.7);
      if (vital) this.effects.push(this.floatText(["king", "agent"].includes(ev.kind) ? "KING DOWN" : `${ev.kind.toUpperCase()} DESTROYED`, ev.x, ev.y, RAMPS.neutral.key, 3200, 12));
    } else if (ev.type === "spawn") {
      const building = this.ruleset.kinds[ev.kind]?.building;
      this.effects.push(this.dust(ev.x, ev.y, 0xaaaaaa, building ? 14 : 6));
      this.play(building ? "build" : "spawn", ev.x, ev.y, 0.5);
    } else if (ev.type === "unload") {
      const d = this.drawn.get(ev.id);
      if (d) {
        this.effects.push(this.floatText(`+${ev.amount}`, d.to.x, d.to.y, RAMPS.gold.key));
        this.play("coin", d.to.x, d.to.y, 0.35);
      }
    } else if (ev.type === "chat") {
      const king = [...this.drawn.values()].find((d) => d.view.owner === ev.owner && ["king", "agent"].includes(d.view.kind));
      if (king) {
        this.effects.push(this.bubble(`${ev.channel === "private" ? `[private → ${ev.to}] ` : ev.channel === "team" ? "[team] " : ""}${ev.text}`, king));
        this.play("chat", king.to.x, king.to.y, 0.6);
      }
    } else if (ev.type === "match_end") {
      this.play("fanfare", this.width / 2, this.height / 2, 1);
    }
  }

  /** Pans with the screen position; quieter the farther off-screen. */
  private play(name: SoundName, x: number, y: number, volume: number) {
    const { sx, sy } = iso(x, y);
    const px = this.world.x + sx * this.zoomLevel;
    const py = this.world.y + sy * this.zoomLevel;
    const w = this.app.renderer.width;
    const h = this.app.renderer.height;
    const pan = Math.max(-1, Math.min(1, (px / w) * 2 - 1));
    const off = Math.max(0, Math.abs(px - w / 2) - w / 2, Math.abs(py - h / 2) - h / 2);
    this.sound(name, pan, volume * Math.max(0.15, 1 - off / 400));
  }

  /** A fallen unit stays on the field and fades out, like AoE corpses. */
  private corpse(d: Drawn): Effect {
    const building = this.ruleset.kinds[d.view.kind]?.building;
    const start = this.presentationNow();
    const animated = !building && hasUnitAnimation(d.view.kind, 'death');
    const facing = d.shot?.dir ?? d.dir;
    let previous = start, elapsed = 0;
    d.sprite.tint = dim(PLAYER_RAMPS[d.color].key, 0.45);
    if (building) this.effects.push(this.dust(d.to.x, d.to.y, 0xaaaaaa, 24, 14));
    else if (!animated) {
      d.sprite.anchor.set(0.5, 0.5);
      d.sprite.rotation = (Math.PI / 2) * Math.sign(d.sprite.scale.x);
      d.sprite.y -= 3;
    }
    d.sprite.zIndex -= 3;
    return {
      destroy: () => { d.sprite.destroy(); d.shadow.destroy(); },
      update: (now) => {
        // Follow replay speed, including changes during the fall. Keep advancing
        // after the final snapshot so a lethal King hit can finish its animation.
        elapsed += Math.max(0, now - previous) * (animated ? this.gameTickMs / this.tickMs : 1);
        previous = now;
        if (animated) {
          const { art, flip } = this.sprites(d.view.kind, facing, unitDeathAnimation(d.view.kind, elapsed));
          d.sprite.texture = art.texture;
          d.sprite.anchor.set(art.anchorX, art.anchorY);
          d.sprite.scale.set(flip ? -art.scale : art.scale, art.scale);
        }
        const k = elapsed / (building ? 1500 : 6000);
        d.sprite.alpha = Math.max(0, 1 - k);
        d.shadow.alpha = Math.max(0, 1 - k * 2);
        if (k < 1) return true;
        d.sprite.destroy();
        d.shadow.destroy();
        return false;
      },
    };
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
    cv.addEventListener("pointerup", () => (drag = null));
    cv.addEventListener("pointerleave", () => {
      this.hovered = null;
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
      this.refreshHover();
    });
    cv.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
  }

  private refreshHover() {
    const h = this.hovered;
    this.hoverMark.clear();
    if (!h || (this.visibility && this.visibility[h.y]?.[h.x] !== "2")) return this.hoverCb(null);
    const { sx, sy } = iso(h.x, h.y);
    this.hoverMark.poly([sx, sy - TILE_H / 2, sx + TILE_W / 2, sy, sx, sy + TILE_H / 2, sx - TILE_W / 2, sy]).stroke({ width: 1, color: 0xffffff, alpha: 0.7 });
    const entity = [...this.drawn.values()].find((d) => d.to.x === h.x && d.to.y === h.y)?.view;
    const deposit = [...this.deposits.values()].find((d) => d.view.x === h.x && d.view.y === h.y)?.view;
    const rock = (this.ruleset.map.walls ?? []).some((w) => w.x === h.x && w.y === h.y);
    this.hoverCb({ x: h.x, y: h.y, entity, deposit, rock });
  }

  // ───────────────────────── helpers ─────────────────────────

  private colorOf(owner: string): number {
    return (this.colors[owner] ?? 0) % PLAYER_RAMPS.length;
  }

}
