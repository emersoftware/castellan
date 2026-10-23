// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { Application, Rectangle, RenderTexture, Texture, type Container, type Filter } from "pixi.js";
import { rules } from "@castellan/shared";
import { GameRenderer } from "../src/render/renderer";
import { loadSprites, terrainTexture, HERO_SPRITE_BASE, type SpriteSet } from "../src/render/sprites";
import { stubArt } from "./support/battlefield";

// jsdom has neither WebGL nor a 2D canvas: no atlas loading and no terrain painting.
vi.mock("../src/render/sprites", async importOriginal => ({
  ...await importOriginal<typeof import("../src/render/sprites")>(), loadSprites: vi.fn(), terrainTexture: vi.fn(),
}));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.mocked(loadSprites).mockReset(); vi.mocked(terrainTexture).mockReset(); });

it("starts WebGL during image loading and disposes it if the image load fails first", async () => {
  let rejectImages!: (error: Error) => void;
  let initialized!: () => void;
  vi.mocked(loadSprites).mockReturnValue(new Promise<SpriteSet>((_, reject) => { rejectImages = reject; }));
  const init = vi.spyOn(Application.prototype, "init").mockImplementation(function () {
    return new Promise<void>(resolve => { initialized = () => { this.renderer = {} as Application["renderer"]; resolve(); }; });
  });
  const destroy = vi.spyOn(Application.prototype, "destroy").mockImplementation(() => {});
  const host = document.createElement("div");
  const result = GameRenderer.create(host, rules, {}, { spriteBase: HERO_SPRITE_BASE });
  const rejected = expect(result).rejects.toThrow("atlas unavailable");

  expect(loadSprites).toHaveBeenCalledWith(HERO_SPRITE_BASE);
  expect(init).toHaveBeenCalledOnce();
  expect(host.querySelector("canvas")).toBeNull();
  rejectImages(new Error("atlas unavailable"));
  await Promise.resolve();
  expect(destroy).not.toHaveBeenCalled();
  initialized();
  await rejected;
  expect(destroy).toHaveBeenCalledWith(true, { children: true, texture: false });
  expect(host.querySelector("canvas")).toBeNull();
});

it("releases its depth pass, filters and terrain on destroy, but keeps the sprite art other renderers share", async () => {
  const art = stubArt({ texture: new Texture(), silhouette: new Texture() });
  vi.mocked(loadSprites).mockResolvedValue(() => ({ flip: false, art }));
  const terrain = new Texture();
  vi.mocked(terrainTexture).mockReturnValue({ texture: terrain, originX: 0, originY: 0 });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  let app!: Application;
  vi.spyOn(Application.prototype, "init").mockImplementation(async function () {
    app = this;
    Object.assign(this, { ticker: { add() {} }, start() {},
      renderer: { canvas: document.createElement("canvas"), screen: new Rectangle(0, 0, 64, 64), resize() {} } });
  });
  const destroy = vi.spyOn(Application.prototype, "destroy").mockImplementation(() => {});
  const created = vi.spyOn(RenderTexture, "create");
  const renderer = await GameRenderer.create(document.createElement("div"), rules, {}, { interactive: false });
  renderer.scene.dissolve(0.5);
  const depth = (created.mock.results[0].value as RenderTexture).source;
  const ground = terrain.source;
  // The view's dither, the x-ray and outline passes reading the depth texture, and the dissolves.
  const filtersIn = (c: Container): Filter[] => [...(c.filters ?? []), ...c.children.flatMap(filtersIn)];
  const filters = filtersIn(app.stage);
  const released = new Set<Filter>();
  for (const filter of filters) filter.on("destroy", () => released.add(filter));
  expect(filters.length).toBeGreaterThan(3);

  renderer.destroy();
  expect(destroy).toHaveBeenCalledWith(true, { children: true, texture: false });
  expect(depth.destroyed).toBe(true);
  expect(released).toEqual(new Set(filters));
  expect(ground.destroyed).toBe(true);
  expect(art.texture.destroyed).toBe(false);
  expect(art.silhouette.destroyed).toBe(false);
});
