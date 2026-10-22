/**
 * Isometric renderer in the spirit of Age of Empires, drawn through a
 * monochrome-ramp dither: each side, the grass, the mineral and the rest each
 * live on their own black-to-light ramp. Feed it one state per game tick with `setFrame`; it
 * interpolates movement, turns events into effects and sounds, and leaves
 * corpses on the field.
 */
import { Application, Container, Graphics, Sprite } from "pixi.js";
import type { DepositView, EntityView, Ruleset, SoundName, SpectatorView } from "@castellan/shared";
import { TILE_H, TILE_W, loadSprites, terrainTexture } from "./sprites";
import { createDitherFilter } from "./dither";
import { WorldCamera } from "./camera";
import { SpritePicker, bindWorldInput } from "./input";
import { iso } from "./projection";
import { ScenePresentation } from "./presentation";
import { PlaybackClock, type Moment } from "./clock";
import { OcclusionPass } from "./occlusion";
import { Battlefield } from "./battlefield";

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

export class GameRenderer {
  private app!: Application;
  private root = new Container();
  private world = new Container();
  private ground = new Container();
  private shadows = new Container();
  private objects = new Container();
  private fx = new Container();
  private hoverMark = new Graphics();
  private selectMark = new Graphics();
  private fog = new Graphics();
  /** Only units get x-ray outlines, behind buildings of their own colour. */
  private xrayLayer = new Container();
  private outlineLayer = new Container();
  private occlusion = new OcclusionPass(this.xrayLayer, this.outlineLayer);
  /** Everything a frame changes; created once the sprites are loaded. */
  private field!: Battlefield;
  private clock = new PlaybackClock(() => this.now());
  private hoverCb: (h: HoverInfo | null) => void = () => {};
  private selectCb: (id: string | null) => void = () => {};
  /** The entity the viewer clicked; kept across frames until another click or `select(null)`. */
  private selectedId: string | null = null;
  private hovered: { x: number; y: number } | null = null;
  /** Pointer position in renderer pixels, to pick the sprite under it. */
  private pointer: { x: number; y: number } | null = null;
  /** The entity or deposit under the pointer, outlined on the ground like the selection. */
  private hoverId: string | null = null;
  private picker = new SpritePicker();
  private resize?: ResizeObserver;
  private presentation: ScenePresentation;
  private viewCamera: WorldCamera;
  /** Where the board looks: zoom, recording frames, followed tile boxes and the area hero framing keeps clear. */
  readonly camera: Pick<WorldCamera, "zoom" | "frame" | "focus" | "setFocusArea">;
  /** How the board appears: dissolves for recordings and the hero's staged entrance. */
  readonly scene: Pick<ScenePresentation, "dissolve" | "prepareReveal" | "reveal">;
  private width: number;
  private height: number;
  private sound: SoundSink = () => {};
  /** Wall clock by default; a virtual one while recording video. */
  private now: () => number = () => performance.now();

  private constructor(private host: HTMLElement, private ruleset: Ruleset, private colors: Record<string, number>, fitOnResize = false, private interactive = true, private spriteBase?: string) {
    this.width = ruleset.map.width;
    this.height = ruleset.map.height;
    this.presentation = new ScenePresentation(this.root, {
      ground: this.ground, fog: this.fog,
      units: [this.objects, this.shadows, this.outlineLayer, this.xrayLayer, this.fx, this.hoverMark, this.selectMark],
      overlays: [this.fx, this.outlineLayer, this.xrayLayer, this.hoverMark, this.selectMark],
    }, () => this.field.entities.revealParts(), () => this.now());
    this.viewCamera = new WorldCamera(this.world, this.width, this.height, () => this.now(), fitOnResize, interactive);
    this.camera = this.viewCamera;
    this.scene = this.presentation;
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
    const cv = this.app.canvas;
    Object.assign(cv.style, { width: "100%", height: "100%", imageRendering: "pixelated", display: "block" });
    this.host.appendChild(cv);

    this.objects.sortableChildren = true;
    this.xrayLayer.sortableChildren = true;
    this.outlineLayer.sortableChildren = true;
    // Fog darkens the ground only; objects on fogged tiles are dimmed whole (see FogOfWar), so a
    // tall building is never half-dark where it overlaps tiles of different visibility.
    this.world.addChild(this.ground, this.shadows, this.fog, this.hoverMark, this.selectMark, this.objects, this.outlineLayer, this.xrayLayer, this.fx);
    this.root.addChild(this.world);
    this.root.filters = [createDitherFilter()];
    this.app.stage.addChild(this.root);

    this.buildGround();
    this.field = new Battlefield({
      objects: this.objects, shadows: this.shadows, fx: this.fx, fog: this.fog,
      xray: this.xrayLayer, outlines: this.outlineLayer, depth: this.occlusion.layer,
    }, sprites.value, this.ruleset, this.colors, this.clock, (name, x, y, volume) => this.play(name, x, y, volume));
    this.fit();
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(this.host);
    if (this.interactive) bindWorldInput(cv, this.world, this.app.renderer, {
      zoom: (factor, x, y) => this.viewCamera.zoom(factor, x, y),
      pointer: point => {
        this.pointer = point;
        this.hovered = null;
        if (point) {
          const px = (point.x - this.world.x) / this.world.scale.x;
          const py = (point.y - this.world.y) / this.world.scale.y;
          const x = Math.round((px / (TILE_W / 2) + py / (TILE_H / 2)) / 2);
          const y = Math.round((py / (TILE_H / 2) - px / (TILE_W / 2)) / 2);
          if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.hovered = { x, y };
        }
        this.refreshHover();
      },
      select: () => {
        const picked = this.pointer && this.pick(this.pointer);
        this.selectedId = picked ? picked.view.id : null;
        this.selectCb(this.selectedId);
      },
    });
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
    if (paused) this.clock.pause();
    else this.clock.resume();
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

  /** The next game state, animated from the last one. `tickMs` is how long until the state after it (for interpolation). */
  setFrame(v: SpectatorView, tickMs: number) {
    this.field.show(v, tickMs);
    this.refreshHover();
  }

  /** A state elsewhere in the game (seeking a replay): shown at once, without animations, effects or sounds. */
  seek(v: SpectatorView, tickMs: number) {
    this.field.seek(v, tickMs);
    this.refreshHover();
  }

  destroy() {
    this.presentation.destroy();
    this.resize?.disconnect();
    this.app.destroy(true, { children: true, texture: false });
  }

  // ───────────────────────── scene ─────────────────────────

  private buildGround() {
    const { texture, originX, originY } = terrainTexture(this.width, this.height);
    const g = new Sprite(texture);
    g.position.set(-originX, -originY);
    this.ground.addChild(g);
  }

  /** Canvas at CSS size (the dither dot is one CSS pixel); zoom fits the map on first layout, and on each with `fitOnResize`. */
  private fit() {
    const w = Math.max(64, this.host.clientWidth);
    const h = Math.max(64, this.host.clientHeight);
    this.app.renderer.resize(w, h);
    this.root.filterArea = this.app.screen;
    // Pixi interprets filterArea in the container's local coordinates. This
    // layer lives inside the panned/zoomed world: a screen rectangle here clips
    // everything left of the world's origin. Let Pixi project the unit bounds.
    this.xrayLayer.filterArea = undefined;
    this.occlusion.resize(w, h);
    this.viewCamera.resize(w, h);
  }

  // ───────────────────────── per frame ─────────────────────────

  private animate() {
    this.viewCamera.update();
    this.presentation.restore();
    const moment = this.clock.moment();
    this.field.animate(moment);
    this.drawSelection(moment);
    // Apply after effects create their fire/sparks and update their own alpha.
    this.presentation.apply();
    // Depth pass for the x-ray: occluders only, in the world's current view.
    this.occlusion.render(this.app.renderer, this.world);
  }

  /** Rings on the ground under the selected and hovered entity or deposit, following their drawn position. */
  private drawSelection(moment: Moment) {
    this.selectMark.clear();
    const ring = (id: string | null, selected: boolean) => {
      if (!id) return;
      const figure = this.field.entities.figures.get(id);
      const deposit = figure ? undefined : this.field.deposits.figures.get(id);
      if (!figure && !deposit) return;
      const { x, y } = figure ? this.field.entities.position(id, moment)! : deposit!.view;
      const { sx, sy } = iso(x, y);
      const big = figure ? this.ruleset.kinds[figure.view.kind]?.building : false;
      const w = (big ? 0.62 : 0.4) * TILE_W, h = (big ? 0.62 : 0.4) * TILE_H;
      const color = !selected ? 0xffffff : figure ? figure.tint : 0xffff55;
      this.selectMark.ellipse(sx, sy + 2, w, h).stroke({ width: 1, color, alpha: selected ? 0.95 : 0.6 });
      if (selected) this.selectMark.ellipse(sx, sy + 2, w + 2, h + 1).stroke({ width: 1, color: 0x000000, alpha: 0.5 });
    };
    if (this.hoverId !== this.selectedId) ring(this.hoverId, false);
    ring(this.selectedId, true);
  }

  /** Pans with the screen position; quieter the farther off-screen, where footsteps and picks go silent. */
  private play(name: SoundName, x: number, y: number, volume: number) {
    const { sx, sy } = iso(x, y);
    const px = this.world.x + sx * this.world.scale.x;
    const py = this.world.y + sy * this.world.scale.x;
    const w = this.app.renderer.width;
    const h = this.app.renderer.height;
    const pan = Math.max(-1, Math.min(1, (px / w) * 2 - 1));
    const off = Math.max(0, Math.abs(px - w / 2) - w / 2, Math.abs(py - h / 2) - h / 2);
    if (off > 0 && ON_SCREEN_ONLY.has(name)) return;
    this.sound(name, pan, volume * Math.max(0.15, 1 - off / 400));
  }

  // ───────────────────────── input ─────────────────────────

  /** The entity or deposit drawn under a canvas point. */
  private pick(point: { x: number; y: number }) {
    return this.picker.pick(point.x, point.y, this.field.entities.figures.values(), this.field.deposits.figures.values());
  }

  private hoverShown = true;
  private refreshHover() {
    this.hoverMark.clear();
    // The sprite under the pointer first (bodies stand above their tile), else the tile itself.
    const picked = this.pointer ? this.pick(this.pointer) : null;
    this.hoverId = picked ? picked.view.id : null;
    const figure = picked?.kind === "entity" ? this.field.entities.figures.get(picked.view.id) : undefined;
    const h = figure ? figure.tile : picked ? { x: picked.view.x, y: picked.view.y } : this.hovered;
    if (!h || (!picked && !this.field.fog.sees(h))) {
      // Every frame refreshes the hover; telling the page "nothing" again would re-render it per frame.
      if (this.hoverShown) this.hoverCb(null);
      this.hoverShown = false;
      return;
    }
    this.hoverShown = true;
    const { sx, sy } = iso(h.x, h.y);
    // A picked sprite gets a ring under its drawn position (see drawSelection); a bare tile gets a diamond.
    if (!picked) this.hoverMark.poly([sx, sy - TILE_H / 2, sx + TILE_W / 2, sy, sx, sy + TILE_H / 2, sx - TILE_W / 2, sy]).stroke({ width: 1, color: 0xffffff, alpha: 0.7 });
    const entity = picked?.kind === "entity" ? picked.view : picked ? undefined : [...this.field.entities.figures.values()].find((f) => f.tile.x === h.x && f.tile.y === h.y)?.view;
    const deposit = picked?.kind === "deposit" ? picked.view : picked ? undefined : [...this.field.deposits.figures.values()].find((d) => d.view.x === h.x && d.view.y === h.y)?.view;
    const rock = (this.ruleset.map.walls ?? []).some((w) => w.x === h.x && w.y === h.y);
    this.hoverCb({ x: h.x, y: h.y, entity, deposit,
      rock: rock && this.ruleset.map.wallStyle !== "wall", terrainWall: rock && this.ruleset.map.wallStyle === "wall" });
  }
}
