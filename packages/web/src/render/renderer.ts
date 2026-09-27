/**
 * Isometric renderer in the spirit of Age of Empires, drawn through a
 * monochrome-ramp dither: each side, the grass, the gold and the rest each
 * live on their own black-to-light ramp. Feed it one state per game tick with `setFrame`; it
 * interpolates movement, turns events into effects and sounds, and leaves
 * corpses on the field.
 */
import { Application, Container, Graphics, RenderTexture, Sprite, Text, type Filter } from "pixi.js";
import type { DepositView, EntityView, GameEvent, Ruleset, SpectatorView } from "@aoa/shared";
import { TILE_H, TILE_W, loadSprites, screenDir, terrainTexture, type SpriteArt, type SpriteSet } from "./sprites";
import { createXrayFilter, depthTint } from "./xray";
import { createDitherFilter } from "./dither";
import { RAMPS, TEAM_RAMPS, dim } from "./palette";

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
  team: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Screen direction 0..7 (S, SE, E, NE, N, NW, W, SW) the unit faces. */
  dir: number;
  /** Units: drawn where an occluder hides them. Buildings: their depth silhouette. */
  xray: Sprite | null;
  depth: Sprite | null;
  flashUntil: number;
  lungeUntil: number;
  lunge: { x: number; y: number };
}

interface Effect {
  /** Returns false when finished. */
  update(now: number): boolean;
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
  /** Units' x-ray outlines, shown only where an occluder is in front (see xray.ts). */
  private xrayLayer = new Container();
  /** Occluders' silhouettes tinted with depth codes, rendered off-screen each frame. */
  private depthWorld = new Container();
  private depthLayer = new Container();
  private depthRT!: RenderTexture;
  private xrayFilter!: Filter;
  /** Static occluders (rocks, mines) and their depth sprites. */
  private staticDepth: { sprite: Sprite; depth: Sprite }[] = [];
  private drawn = new Map<string, Drawn>();
  private deposits = new Map<string, { view: DepositView; sprite: Sprite; shadow: Graphics; depth: Sprite }>();
  private effects: Effect[] = [];
  private frameAt = 0;
  private tickMs = 100;
  private first = true;
  private zoomLevel = 1;
  private hoverCb: (h: HoverInfo | null) => void = () => {};
  private hovered: { x: number; y: number } | null = null;
  private resize?: ResizeObserver;
  private width: number;
  private height: number;
  private sound: SoundSink = () => {};
  /** Wall clock by default; a virtual one while recording video. */
  private now: () => number = () => performance.now();

  private constructor(private host: HTMLElement, private ruleset: Ruleset, private owners: string[]) {
    this.width = ruleset.map.width;
    this.height = ruleset.map.height;
  }

  static async create(host: HTMLElement, ruleset: Ruleset, players: string[]): Promise<GameRenderer> {
    const r = new GameRenderer(host, ruleset, players);
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
    this.depthWorld.addChild(this.depthLayer);
    this.world.addChild(this.ground, this.shadows, this.hoverMark, this.objects, this.xrayLayer, this.fx);
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
    const now = this.now();
    const alpha = this.alpha(now);
    const quiet = jump || this.first;
    this.tickMs = tickMs;
    this.frameAt = now;
    const seen = new Set<string>();

    for (const e of v.entities) {
      seen.add(e.id);
      const d = this.drawn.get(e.id);
      if (!d) {
        this.addEntity(e);
        continue;
      }
      d.from = jump ? { x: e.x, y: e.y } : { x: d.from.x + (d.to.x - d.from.x) * alpha, y: d.from.y + (d.to.y - d.from.y) * alpha };
      d.to = { x: e.x, y: e.y };
      const mx = e.x - d.from.x;
      const my = e.y - d.from.y;
      if (Math.abs(mx) + Math.abs(my) > 0.01) d.dir = screenDir(mx - my, (mx + my) / 2);
      d.view = e;
    }
    for (const [id, d] of this.drawn) {
      if (seen.has(id)) continue;
      this.drawn.delete(id);
      d.bar.destroy();
      d.xray?.destroy();
      d.depth?.destroy();
      if (quiet) {
        d.sprite.destroy();
        d.shadow.destroy();
      } else this.effects.push(this.corpse(d));
    }

    const depSeen = new Set<string>();
    for (const dv of v.deposits) {
      depSeen.add(dv.id);
      let d = this.deposits.get(dv.id);
      if (!d) {
        const { sx, sy } = iso(dv.x, dv.y);
        const { art } = this.sprites("deposit");
        const sprite = new Sprite(art.texture);
        sprite.anchor.set(art.anchorX, art.anchorY);
        sprite.tint = RAMPS.gold.key;
        sprite.position.set(sx, sy + 2);
        sprite.zIndex = (dv.x + dv.y) * 10 + 1;
        const shadow = new Graphics().ellipse(sx, sy + 3, 12, 4).fill({ color: 0x000000, alpha: 0.35 });
        this.shadows.addChild(shadow);
        this.objects.addChild(sprite);
        d = { view: dv, sprite, shadow, depth: this.depthSprite(art) };
        this.deposits.set(dv.id, d);
      }
      // A mine shrinks as it is emptied.
      d.sprite.scale.set(this.sprites("deposit").art.scale * (0.55 + 0.45 * Math.min(1, dv.amount / this.initialAmount(dv))));
      d.view = dv;
    }
    for (const [id, d] of this.deposits) {
      if (depSeen.has(id)) continue;
      if (!quiet) this.effects.push(this.dust(d.view.x, d.view.y, RAMPS.gold.key, 10));
      d.sprite.destroy();
      d.shadow.destroy();
      d.depth.destroy();
      this.deposits.delete(id);
    }

    this.layoutWalls();
    if (!quiet) for (const ev of v.events) this.onEvent(ev, now);
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
      this.staticDepth.push({ sprite: r, depth: this.depthSprite(art) });
    }
  }

  /** An occluder's silhouette in the depth pass. */
  private depthSprite(art: SpriteArt): Sprite {
    const s = new Sprite(art.silhouette);
    this.depthLayer.addChild(s);
    return s;
  }

  /** Mirrors an occluder into the depth pass, tinted with its depth code. */
  private syncDepth(src: Sprite, depth: Sprite) {
    depth.position.copyFrom(src.position);
    depth.scale.copyFrom(src.scale);
    depth.anchor.copyFrom(src.anchor);
    depth.rotation = src.rotation;
    depth.zIndex = src.zIndex;
    depth.tint = depthTint(src.zIndex);
    depth.visible = src.visible && src.alpha > 0.5;
  }

  /**
   * Walls run along x or y depending on their neighbours: the rendered piece
   * runs along y; mirrored it runs along x; corners and lone walls are posts.
   */
  private layoutWalls() {
    const at = new Map<string, Drawn>();
    for (const d of this.drawn.values()) if (d.view.kind === "wall") at.set(`${d.to.x},${d.to.y},${d.view.owner}`, d);
    const has = (d: Drawn, dx: number, dy: number) => at.has(`${d.to.x + dx},${d.to.y + dy},${d.view.owner}`);
    for (const d of at.values()) {
      const alongX = has(d, 1, 0) || has(d, -1, 0);
      const alongY = has(d, 0, 1) || has(d, 0, -1);
      const { art } = this.sprites(alongX !== alongY ? "wall" : "wallpost");
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
    this.xrayLayer.filterArea = this.app.screen;
    this.depthRT?.destroy(true);
    this.depthRT = RenderTexture.create({ width: w, height: h, scaleMode: "nearest" });
    if (!this.xrayFilter) {
      this.xrayFilter = createXrayFilter(this.depthRT);
      this.xrayLayer.filters = [this.xrayFilter];
    } else {
      this.xrayFilter.resources.uDepth = this.depthRT.source;
      this.xrayFilter.resources.xrayUniforms.uniforms.uScreen = new Float32Array([w, h]);
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
    const team = this.team(e.owner);
    const spec = this.ruleset.kinds[e.kind];
    // Start facing the middle of the map.
    const c = iso((this.width - 1) / 2, (this.height - 1) / 2);
    const p = iso(e.x, e.y);
    const dir = screenDir(c.sx - p.sx, c.sy - p.sy);
    const { art } = this.sprites(e.kind, dir);
    const sprite = new Sprite(art.texture);
    sprite.anchor.set(art.anchorX, art.anchorY);
    sprite.scale.set(art.scale);
    sprite.tint = TEAM_RAMPS[team].key;
    let xray: Sprite | null = null;
    let depth: Sprite | null = null;
    if (spec?.building) depth = this.depthSprite(art);
    else {
      xray = new Sprite(art.xray[team]);
      this.xrayLayer.addChild(xray);
    }
    const r = spec?.building ? (e.kind === "nexus" ? 22 : 12) : 6;
    const shadow = new Graphics().ellipse(0, 0, r, r / 2.6).fill({ color: 0x000000, alpha: 0.4 });
    this.shadows.addChild(shadow);
    this.objects.addChild(sprite);
    const bar = new Graphics();
    this.fx.addChild(bar);
    this.drawn.set(e.id, {
      view: e, sprite, shadow, bar, team, from: { x: e.x, y: e.y }, to: { x: e.x, y: e.y },
      dir, xray, depth, flashUntil: 0, lungeUntil: 0, lunge: { x: 0, y: 0 },
    });
  }

  // ───────────────────────── per frame ─────────────────────────

  private alpha(now: number) {
    return Math.min(1, Math.max(0, (now - this.frameAt) / this.tickMs));
  }

  private animate() {
    const now = this.now();
    const a = this.alpha(now);
    const t = now / 1000;
    for (const d of this.drawn.values()) {
      const x = d.from.x + (d.to.x - d.from.x) * a;
      const y = d.from.y + (d.to.y - d.from.y) * a;
      const { sx, sy } = iso(x, y);
      const moving = (d.from.x !== d.to.x || d.from.y !== d.to.y) && a < 1;
      const building = this.ruleset.kinds[d.view.kind]?.building;
      let ox = 0;
      let oy = 0;
      if (moving) oy = -Math.abs(Math.sin(a * Math.PI * 2)) * 1.2;
      if (now < d.lungeUntil) {
        const k = Math.sin(((d.lungeUntil - now) / 140) * Math.PI);
        ox = d.lunge.x * k * 2.5;
        oy += d.lunge.y * k * 1.5;
      }
      d.sprite.position.set(sx + ox, sy + oy + (building ? 0 : 3));
      d.sprite.zIndex = Math.round((x + y) * 10) + 5;
      d.sprite.tint = now < d.flashUntil ? RAMPS.neutral.key : TEAM_RAMPS[d.team].key;
      if (d.view.kind === "agent") d.sprite.position.y += Math.sin(t * 1.5) * 0.4;
      if (!building) {
        const { art, flip } = this.sprites(d.view.kind, d.dir);
        d.sprite.texture = art.texture;
        d.sprite.anchor.set(art.anchorX, art.anchorY);
        d.sprite.scale.set(flip ? -art.scale : art.scale, art.scale);
        if (d.xray) {
          d.xray.texture = art.xray[d.team];
          d.xray.anchor.copyFrom(d.sprite.anchor);
          d.xray.scale.copyFrom(d.sprite.scale);
          d.xray.position.copyFrom(d.sprite.position);
          d.xray.tint = depthTint(d.sprite.zIndex);
        }
      } else if (d.depth) this.syncDepth(d.sprite, d.depth);
      d.shadow.position.set(sx, sy + (building ? 2 : 3));
      this.drawBar(d, sx);
    }
    for (const dep of this.deposits.values()) this.syncDepth(dep.sprite, dep.depth);
    for (const o of this.staticDepth) this.syncDepth(o.sprite, o.depth);
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
    d.bar.rect(left, top, (w * hp) / maxHp, 1.5).fill(hp / maxHp > 0.35 ? TEAM_RAMPS[d.team].key : RAMPS.neutral.key);
  }

  // ───────────────────────── events → effects & sound ─────────────────────────

  private onEvent(ev: GameEvent, now: number) {
    if (ev.type === "attack") {
      const from = this.drawn.get(ev.from);
      const to = this.drawn.get(ev.to);
      if (!from || !to) return;
      const spec = this.ruleset.kinds[from.view.kind];
      const a = iso(from.to.x, from.to.y);
      const b = iso(to.to.x, to.to.y);
      const dx = Math.sign(b.sx - a.sx);
      if (b.sx !== a.sx || b.sy !== a.sy) from.dir = screenDir(b.sx - a.sx, b.sy - a.sy);
      if ((spec?.range ?? 1) > 1) {
        this.effects.push(this.arrow(from, to));
        this.play(spec?.building ? "tower" : "arrow", from.to.x, from.to.y, 0.6);
      } else {
        from.lungeUntil = now + 140;
        from.lunge = { x: dx, y: Math.sign(b.sy - a.sy) };
        to.flashUntil = now + 90;
        this.effects.push(this.dust(to.to.x, to.to.y, RAMPS.neutral.key, 3, 5));
        this.play("sword", to.to.x, to.to.y, 0.5);
      }
    } else if (ev.type === "death") {
      const vital = this.ruleset.kinds[ev.kind]?.vital;
      const building = this.ruleset.kinds[ev.kind]?.building;
      this.play(vital ? "horn" : building ? "collapse" : "death", ev.x, ev.y, vital ? 1 : 0.7);
      if (vital) this.effects.push(this.floatText(ev.kind === "agent" ? "AGENT DOWN" : "NEXUS DESTROYED", ev.x, ev.y, RAMPS.neutral.key, 3200, 12));
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
      const agent = [...this.drawn.values()].find((d) => d.view.owner === ev.owner && d.view.kind === "agent");
      if (agent) {
        this.effects.push(this.bubble(ev.text, agent));
        this.play("chat", agent.to.x, agent.to.y, 0.6);
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
    const start = this.now();
    d.sprite.tint = dim(TEAM_RAMPS[d.team].key, 0.45);
    if (building) this.effects.push(this.dust(d.to.x, d.to.y, 0xaaaaaa, 24, 14));
    else {
      d.sprite.anchor.set(0.5, 0.5);
      d.sprite.rotation = (Math.PI / 2) * Math.sign(d.sprite.scale.x);
      d.sprite.y -= 3;
    }
    d.sprite.zIndex -= 3;
    return {
      update: (now) => {
        const k = (now - start) / (building ? 1500 : 6000);
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
    const start = this.now();
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
    const start = this.now();
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

  /** A speech scroll that follows the agent for a few seconds. */
  private bubble(text: string, d: Drawn): Effect {
    const short = text.length > 80 ? text.slice(0, 77) + "…" : text;
    const box = new Container();
    const t = new Text({ text: short, style: { fontFamily: "Arial, Helvetica, sans-serif", fontSize: 8, fill: 0x000000, wordWrap: true, wordWrapWidth: 110 }, resolution: 2 });
    t.position.set(4, 2);
    const w = Math.ceil(t.width) + 8;
    const h = Math.ceil(t.height) + 4;
    const g = new Graphics();
    g.rect(0, 0, w, h).fill(0xdddddd).stroke({ width: 1, color: TEAM_RAMPS[d.team].key });
    g.poly([w / 2 - 3, h, w / 2 + 3, h, w / 2, h + 4]).fill(0xdddddd);
    box.addChild(g, t);
    this.fx.addChild(box);
    const start = this.now();
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
    if (!h) return this.hoverCb(null);
    const { sx, sy } = iso(h.x, h.y);
    this.hoverMark.poly([sx, sy - TILE_H / 2, sx + TILE_W / 2, sy, sx, sy + TILE_H / 2, sx - TILE_W / 2, sy]).stroke({ width: 1, color: 0xffffff, alpha: 0.7 });
    const entity = [...this.drawn.values()].find((d) => d.to.x === h.x && d.to.y === h.y)?.view;
    const deposit = [...this.deposits.values()].find((d) => d.view.x === h.x && d.view.y === h.y)?.view;
    const rock = (this.ruleset.map.walls ?? []).some((w) => w.x === h.x && w.y === h.y);
    this.hoverCb({ x: h.x, y: h.y, entity, deposit, rock });
  }

  // ───────────────────────── helpers ─────────────────────────

  private team(owner: string): number {
    const i = this.owners.indexOf(owner);
    return i < 0 ? 0 : i % TEAM_RAMPS.length;
  }

  private initialAmount(d: DepositView): number {
    const shared = this.ruleset.map.sharedDeposits.find((s) => s.x === d.x && s.y === d.y);
    return shared?.amount ?? this.ruleset.map.deposits[0]?.amount ?? 500;
  }
}
