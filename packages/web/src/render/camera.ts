import type { Container } from "pixi.js";
import type { CameraBox } from "../showcaseCamera";
import { TILE_H, TILE_W } from "./sprites";
import { iso } from "./projection";

/** Hero close-ups stop where the hero art (stored at 1.5×) would be enlarged. */
const CLOSE_UP_ZOOM = 1.5;
/** Seconds the hero camera takes to settle on a moving target: centre, then zoom (slower, so it eases in). */
const FOLLOW_S = 1.4, ZOOM_S = 2.2;
/** Handheld sway: screen pixels of drift and the fraction the zoom breathes. */
const SWAY_PX = 7, BREATH = 0.012;
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

/** Owns the world transform for user navigation, recordings and the landing camera. */
export class WorldCamera {
  private zoomLevel = 1;
  private fitted = false;
  private viewport = { width: 0, height: 0 };
  private focusBox?: CameraBox | null;
  private area?: { x: number; y: number; w: number; h: number };
  private follow?: { view: View; vx: number; vy: number; vz: number; at: number };

  constructor(private world: Container, private width: number, private height: number,
    private now: () => number, private fitOnResize: boolean, private interactive: boolean) {}

  /** Zoom by a factor around a point in renderer pixels, the screen center by default (0.35×–3×). */
  zoom(factor: number, cx = this.viewport.width / 2, cy = this.viewport.height / 2) {
    const next = Math.min(3, Math.max(0.35, this.zoomLevel * factor));
    const wx = (cx - this.world.x) / this.zoomLevel;
    const wy = (cy - this.world.y) / this.zoomLevel;
    this.zoomLevel = next;
    this.world.scale.set(next);
    this.world.position.set(Math.round(cx - wx * next), Math.round(cy - wy * next));
  }

  /** Camera for recordings: tile (x, y) at the screen centre (`dy` pixels lower), `zoom` relative to the whole map fitting the screen (1). */
  frame(x: number, y: number, zoom: number, dy = 0) {
    const w = this.viewport.width, h = this.viewport.height;
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
    if (this.focusBox === undefined || !this.viewport.width) return;
    const view = this.viewFor(this.focusBox);
    if (this.follow) this.follow = { ...this.follow, view, vx: 0, vy: 0, vz: 0 };
    this.applyView(view);
  }

  /** Where views are framed: the focus area, or the whole canvas. */
  private frameRect() {
    return this.area ?? { x: 0, y: 0, w: this.viewport.width, h: this.viewport.height };
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
  update() {
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

  /** Resize without losing a manually panned view; focused shots reframe immediately. */
  resize(w: number, h: number) {
    const recenter = this.fitOnResize || !this.fitted;
    this.fitted = true;
    this.viewport = { width: w, height: h };
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
}
