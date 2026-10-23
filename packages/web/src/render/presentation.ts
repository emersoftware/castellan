import { Container, type Filter } from "pixi.js";
import { createDissolveFilter } from "./dissolve";
import { corpseFade } from "./corpseFade";

/** Each full layer assembles through the game dither: terrain, structures, then units. */
const REVEAL_LAYER_MS = 350;

/** Owns presentation fades without changing the alpha owned by object animations. */
export class ScenePresentation {
  /** Staged entrance: when it started (Infinity while waiting for the text). */
  private revealAt?: number;
  private revealGroundFilter?: ReturnType<typeof createDissolveFilter>;
  /** Restore the real presentation alpha before advancing effects on the next frame. */
  private revealAlphas = new Map<Container, number>();

  constructor(private root: Container, private layers: {
    ground: Container; fog: Container; units: Container[]; overlays: Container[];
  }, private parts: () => Iterable<{ building: boolean; parts: (Container | null | undefined)[] }>, private now: () => number) {}

  /**
   * Recordings: show units (and their shadows, marks and effects) or the whole world through a Bayer screen
   * door, 0 hidden … 1 shown, so shots dissolve between games the way the game dithers. A player's fog can go
   * with its units (`fog`).
   */
  dissolve(units: number, world = 1, fog = world) {
    const set = (c: Container, shown: number) => {
      if (shown >= 1) { if (c.filters?.length) c.filters = c.filters.filter((f) => !Object.hasOwn(f, "shown")); return; }
      const f = (c.filters?.find((x) => Object.hasOwn(x, "shown")) as (Filter & { shown: number }) | undefined) ?? createDissolveFilter();
      f.shown = shown;
      if (!c.filters?.includes(f)) c.filters = [...(c.filters ?? []), f];
    };
    for (const c of this.layers.units) set(c, Math.min(units, world));
    set(this.layers.ground, world);
    set(this.layers.fog, Math.min(fog, world));
  }

  private reducedMotion() {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** Prepare every layer while the preceding text is entering. */
  prepareReveal() {
    if (this.reducedMotion()) return;
    this.revealAt = Number.POSITIVE_INFINITY;
    this.revealGroundFilter = createDissolveFilter();
    this.root.filters = [...(this.root.filters ?? []), this.revealGroundFilter];
    this.apply();
  }

  /** Reassemble the board through dither, reversing the game's corpse fade. */
  reveal() {
    if (this.revealAt === undefined) return;
    this.revealAt = this.now();
    this.apply();
  }

  restore() {
    for (const [part, alpha] of this.revealAlphas) if (!part.destroyed) part.alpha = alpha;
    this.revealAlphas.clear();
  }

  apply() {
    if (this.revealAt === undefined) return;
    this.restore();
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
    for (const d of this.parts()) {
      const delay = REVEAL_LAYER_MS * (d.building ? 1 : 2);
      const amount = 1 - corpseFade(elapsed, delay, REVEAL_LAYER_MS).alpha;
      // Fade in key-colour space, before the existing palette dither: the same
      // pixels as a corpse disappearing, played backwards. No per-unit filters.
      for (const part of d.parts) show(part, amount);
    }
    const units = 1 - corpseFade(elapsed, REVEAL_LAYER_MS * 2, REVEAL_LAYER_MS).alpha;
    for (const part of this.layers.overlays) show(part, units);
  }

  destroy() {
    this.revealGroundFilter?.destroy();
    for (const c of [...this.layers.units, this.layers.ground, this.layers.fog]) {
      for (const f of c.filters ?? []) if (Object.prototype.hasOwnProperty.call(f, "shown")) f.destroy();
    }
    this.revealAlphas.clear();
  }
}
