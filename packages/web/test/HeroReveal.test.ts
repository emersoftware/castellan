// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { Container, Texture, type Sprite, type Filter } from "pixi.js";
import { rules, type EntityView, type SpectatorView } from "@castellan/shared";
import { GameRenderer } from "../src/render/renderer";
import type { SpriteSet } from "../src/render/sprites";

afterEach(() => vi.unstubAllGlobals());

function scene() {
  let now = 0;
  const renderer = Reflect.construct(GameRenderer, [document.createElement("div"), rules, { p1: 0 }]) as GameRenderer;
  const internals = renderer as unknown as {
    now(): number; sprites: SpriteSet; animate(): void; play(): void;
    root: Container; fx: Container; app: { renderer: { render(): void } };
    drawn: Map<string, { sprite: Sprite }>;
  };
  internals.now = () => now;
  internals.play = () => {};
  internals.app = { renderer: { render() {} } };
  internals.sprites = () => ({ flip: false, art: {
    texture: Texture.EMPTY, silhouette: Texture.EMPTY,
    xray: Array(4).fill(Texture.EMPTY), outline: Array(4).fill(Texture.EMPTY),
    scale: 1, anchorX: .5, anchorY: 1,
  } });
  const entities: EntityView[] = [
    { id: "north", kind: "castle", owner: "p1", x: 3, y: 3, hp: 100, maxHp: 100 },
    { id: "south", kind: "castle", owner: "p1", x: 25, y: 25, hp: 100, maxHp: 100 },
    { id: "worker", kind: "worker", owner: "p1", x: 6, y: 6, hp: 40, maxHp: 40 },
  ];
  const frame = { tick: 0, entities, events: [], deposits: [] } as unknown as SpectatorView;
  renderer.setFrame(frame, 100);
  const advance = (time: number) => { now = time; internals.animate(); };
  return { renderer, internals, frame, advance, sprite: (id: string) => internals.drawn.get(id)!.sprite };
}

it("holds until presented, assembles every position together, and removes all entrance effects", () => {
  const h = scene();
  h.renderer.scene.prepareReveal();
  const dissolve = h.internals.root.filters![0] as Filter & { shown: number };
  h.advance(3000); // A slow load must not consume the animation offscreen.
  expect(dissolve.shown).toBe(0);
  expect(h.sprite("north").alpha).toBe(0);
  expect(h.sprite("worker").alpha).toBe(0);

  h.renderer.scene.reveal();
  h.advance(3175);
  expect(dissolve.shown).toBe(.5);
  expect(h.sprite("north").alpha).toBe(0);
  h.advance(3525);
  expect(h.internals.root.filters).not.toContain(dissolve);
  expect(h.sprite("north").alpha).toBe(.5);
  expect(h.sprite("south").alpha).toBe(.5);
  expect(h.sprite("worker").alpha).toBe(0);
  h.advance(3875);
  expect(h.sprite("north").alpha).toBe(1);
  expect(h.sprite("worker").alpha).toBe(.5);
  expect(h.internals.fx.alpha).toBe(.5);
  h.advance(4050);
  expect(h.sprite("worker").alpha).toBe(1);
  expect(h.internals.fx.alpha).toBe(1);
  expect(h.internals.root.filters).toHaveLength(0);
});

it("reveals the full board immediately when reduced motion is enabled during entrance", () => {
  let reduced = false;
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
  const h = scene();
  h.renderer.scene.prepareReveal(); h.renderer.scene.reveal(); h.advance(100);
  expect(h.sprite("north").alpha).toBe(0);
  reduced = true; h.advance(101);
  expect(h.sprite("north").alpha).toBe(1);
  expect(h.sprite("worker").alpha).toBe(1);
  expect(h.internals.fx.alpha).toBe(1);
  expect(h.internals.root.filters).toHaveLength(0);
});

it("preserves a unit's own death fade when it dies during entrance", () => {
  const h = scene();
  h.renderer.scene.prepareReveal(); h.renderer.scene.reveal(); h.advance(875);
  const worker = h.sprite("worker");
  expect(worker.alpha).toBe(.5);
  h.renderer.setFrame({ ...h.frame, tick: 1, entities: h.frame.entities.filter(e => e.id !== "worker"),
    events: [{ type: "death", tick: 0, id: "worker", kind: "worker", owner: "p1", x: 6, y: 6 }],
  }, 100);
  h.advance(1000);
  expect(worker.alpha).toBeGreaterThan(.9);
  h.advance(1500);
  expect(worker.alpha).toBeLessThan(1);
  expect(worker.alpha).toBeGreaterThan(.8);
});
