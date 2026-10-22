import { vi } from "vitest";
import { Container, Graphics, Texture, type Sprite } from "pixi.js";
import { rules, type EntityView, type Ruleset, type SpectatorView } from "@castellan/shared";
import { Battlefield, type FieldLayers } from "../../src/render/battlefield";
import { PlaybackClock } from "../../src/render/clock";
import type { SpriteArt, SpriteSet } from "../../src/render/sprites";

/** Art with empty textures: tests observe which art the field asks for, not pixels. */
export const stubArt = (overrides: Partial<SpriteArt> = {}): SpriteArt => ({
  texture: Texture.EMPTY, silhouette: Texture.EMPTY, xray: Array(4).fill(Texture.EMPTY), scale: 1, anchorX: 0.5, anchorY: 1, ...overrides,
});

/** A frame holding only what the field reads; simulation time follows 100 ms ticks. */
export const frameAt = (tick: number, entities: EntityView[] = [], rest: Partial<SpectatorView> = {}): SpectatorView =>
  ({ tick, timeMs: tick * 100, entities, deposits: [], events: [], projectiles: [], ...rest }) as unknown as SpectatorView;

/**
 * A battlefield over plain Pixi containers, on a clock the test moves, without a GPU or
 * loaded atlases. Every sprite-set call is recorded, so a test can read which art was
 * asked for; sounds go to `play`.
 */
export function createField(options: { ruleset?: Ruleset; colors?: Record<string, number>; art?: SpriteArt; sprites?: SpriteSet } = {}) {
  let now = 1000;
  const clock = new PlaybackClock(() => now);
  const layers: FieldLayers = {
    objects: new Container(), shadows: new Container(), fx: new Container(), fog: new Graphics(),
    xray: new Container(), outlines: new Container(), depth: new Container(),
  };
  const art = options.art ?? stubArt();
  const sprites = vi.fn<SpriteSet>(options.sprites ?? (() => ({ flip: false, art })));
  const play = vi.fn();
  const field = new Battlefield(layers, sprites, options.ruleset ?? rules, options.colors ?? {}, clock, play);
  return {
    field, clock, layers, sprites, play,
    time: (t: number) => { now = t; },
    animate: () => field.animate(clock.moment()),
    sprite: (id: string) => field.entities.figures.get(id)!.sprite,
    /** The silhouette mirroring a body in the occlusion pass; they share a depth once animated. */
    occluderOf: (sprite: Sprite) => layers.depth.children.find((child) => child.zIndex === sprite.zIndex) as Sprite | undefined,
  };
}
