import type { Container, Sprite } from "pixi.js";
import type { EntityView, DepositView } from "@castellan/shared";

/** Mouse/touch navigation uses canvas pixels; callers own game selection. */
export function bindWorldInput(cv: HTMLCanvasElement, world: Container, viewport: { readonly width: number }, callbacks: {
  zoom(factor: number, x?: number, y?: number): void;
  pointer(point: { x: number; y: number } | null): void;
  select(): void;
}) {
  // The map takes every touch: one finger pans, two pinch to zoom; the page must not zoom or scroll instead.
  cv.style.touchAction = "none";
  let drag: { x: number; y: number; wx: number; wy: number } | null = null;
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { distance: number; x: number; y: number } | null = null;
  const pinchOf = () => {
    const [a, b] = [...touches.values()];
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  cv.addEventListener("pointerdown", (e) => {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cv.setPointerCapture(e.pointerId);
    if (touches.size === 2) { drag = null; pinch = pinchOf(); }
    else if (touches.size === 1) drag = { x: e.clientX, y: e.clientY, wx: world.x, wy: world.y };
  });
  const release = (e: PointerEvent) => {
    if (!touches.delete(e.pointerId)) return;
    pinch = null;
    // The finger left on the glass after a pinch keeps panning from where it is.
    const [rest] = touches.values();
    if (rest) drag = { x: rest.x, y: rest.y, wx: world.x, wy: world.y };
  };
  cv.addEventListener("pointerup", (e) => {
    // A click (not a drag) selects the visible entity on that tile, or clears the selection.
    if (touches.size === 1 && drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) {
      callbacks.select();
    }
    release(e);
    if (!touches.size) drag = null;
  });
  cv.addEventListener("pointercancel", (e) => { release(e); if (!touches.size) drag = null; });
  cv.addEventListener("pointerleave", () => {
    callbacks.pointer(null);
  });
  cv.addEventListener("pointermove", (e) => {
    const rect = cv.getBoundingClientRect();
    const k = rect.width / viewport.width;
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) {
      const now = pinchOf();
      world.position.set(Math.round(world.x + (now.x - pinch.x) / k), Math.round(world.y + (now.y - pinch.y) / k));
      if (pinch.distance > 0) callbacks.zoom(now.distance / pinch.distance, (now.x - rect.left) / k, (now.y - rect.top) / k);
      pinch = now;
      return;
    }
    if (drag) world.position.set(Math.round(drag.wx + (e.clientX - drag.x) / k), Math.round(drag.wy + (e.clientY - drag.y) / k));
    callbacks.pointer({ x: (e.clientX - rect.left) / k, y: (e.clientY - rect.top) / k });
  });
  cv.addEventListener("wheel", (e) => {
    e.preventDefault();
    callbacks.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });
}

/** What a canvas point picked. */
type Picked = { kind: "entity"; view: EntityView } | { kind: "deposit"; view: DepositView };

/** Resolves overlapping sprites by depth and actual opaque pixels. */
export class SpritePicker {
  /** Readable copies of sprite sheets, to hit-test only opaque pixels. */
  private alphaSources = new WeakMap<object, CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null>();
  /**
   * The entity or deposit drawn under a canvas point (renderer pixels): among the sprites
   * whose box holds it, the one drawn in front (highest depth), then the smallest. Only
   * what is drawn (and so visible from the current view) can be picked.
   */
  pick(px: number, py: number, entities: Iterable<{ sprite: Sprite; view: EntityView }>, deposits: Iterable<{ sprite: Sprite; view: DepositView }>): Picked | null {
    let best: Picked | null = null;
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
    for (const d of entities) consider(d.sprite, { kind: "entity", view: d.view });
    for (const d of deposits) consider(d.sprite, { kind: "deposit", view: d.view });
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

}
