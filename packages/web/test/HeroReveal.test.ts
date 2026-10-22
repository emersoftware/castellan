// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { Container, Graphics, Texture, type Filter } from "pixi.js";
import type { EntityView } from "@castellan/shared";
import { ScenePresentation } from "../src/render/presentation";
import { createField, frameAt, stubArt } from "./support/battlefield";

afterEach(() => vi.unstubAllGlobals());

/** The field under the renderer's presentation: each frame restores the entrance, animates, then applies it. */
function scene() {
  const h = createField({ colors: { p1: 0 }, art: stubArt({ outline: Array(4).fill(Texture.EMPTY) }) });
  h.time(0);
  const root = new Container(), ground = new Container(), hoverMark = new Graphics(), selectMark = new Graphics();
  const { objects, shadows, outlines, xray, fx, fog } = h.layers;
  const presentation = new ScenePresentation(root, {
    ground, fog,
    units: [objects, shadows, outlines, xray, fx, hoverMark, selectMark],
    overlays: [fx, outlines, xray, hoverMark, selectMark],
  }, () => h.field.entities.revealParts(), () => h.clock.now());
  const entities: EntityView[] = [
    { id: "north", kind: "castle", owner: "p1", x: 3, y: 3, hp: 100, maxHp: 100 },
    { id: "south", kind: "castle", owner: "p1", x: 25, y: 25, hp: 100, maxHp: 100 },
    { id: "worker", kind: "worker", owner: "p1", x: 6, y: 6, hp: 40, maxHp: 40 },
  ];
  const frame = frameAt(0, entities);
  h.field.show(frame, 100);
  const advance = (time: number) => { h.time(time); presentation.restore(); h.animate(); presentation.apply(); };
  return { ...h, presentation, root, frame, advance };
}

it("holds until presented, assembles every position together, and removes all entrance effects", () => {
  const h = scene();
  h.presentation.prepareReveal();
  const dissolve = h.root.filters![0] as Filter & { shown: number };
  h.advance(3000); // A slow load must not consume the animation offscreen.
  expect(dissolve.shown).toBe(0);
  expect(h.sprite("north").alpha).toBe(0);
  expect(h.sprite("worker").alpha).toBe(0);

  h.presentation.reveal();
  h.advance(3175);
  expect(dissolve.shown).toBe(.5);
  expect(h.sprite("north").alpha).toBe(0);
  h.advance(3525);
  expect(h.root.filters).not.toContain(dissolve);
  expect(h.sprite("north").alpha).toBe(.5);
  expect(h.sprite("south").alpha).toBe(.5);
  expect(h.sprite("worker").alpha).toBe(0);
  h.advance(3875);
  expect(h.sprite("north").alpha).toBe(1);
  expect(h.sprite("worker").alpha).toBe(.5);
  expect(h.layers.fx.alpha).toBe(.5);
  h.advance(4050);
  expect(h.sprite("worker").alpha).toBe(1);
  expect(h.layers.fx.alpha).toBe(1);
  expect(h.root.filters).toHaveLength(0);
});

it("reveals the full board immediately when reduced motion is enabled during entrance", () => {
  let reduced = false;
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
  const h = scene();
  h.presentation.prepareReveal(); h.presentation.reveal(); h.advance(100);
  expect(h.sprite("north").alpha).toBe(0);
  reduced = true; h.advance(101);
  expect(h.sprite("north").alpha).toBe(1);
  expect(h.sprite("worker").alpha).toBe(1);
  expect(h.layers.fx.alpha).toBe(1);
  expect(h.root.filters).toHaveLength(0);
});

it("preserves a unit's own death fade when it dies during entrance", () => {
  const h = scene();
  h.presentation.prepareReveal(); h.presentation.reveal(); h.advance(875);
  const worker = h.sprite("worker");
  expect(worker.alpha).toBe(.5);
  h.field.show(frameAt(1, h.frame.entities.filter(e => e.id !== "worker"), {
    events: [{ type: "death", tick: 0, id: "worker", kind: "worker", owner: "p1", x: 6, y: 6 }],
  }), 100);
  h.advance(1000);
  expect(worker.alpha).toBeGreaterThan(.9);
  h.advance(1500);
  expect(worker.alpha).toBeLessThan(1);
  expect(worker.alpha).toBeGreaterThan(.8);
});
