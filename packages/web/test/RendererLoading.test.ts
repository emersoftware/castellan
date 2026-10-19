// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { Application } from "pixi.js";
import { rules } from "@castellan/shared";
import { GameRenderer } from "../src/render/renderer";
import { loadSprites, HERO_SPRITE_BASE, type SpriteSet } from "../src/render/sprites";

vi.mock("../src/render/sprites", async importOriginal => ({
  ...await importOriginal<typeof import("../src/render/sprites")>(), loadSprites: vi.fn(),
}));
afterEach(() => { vi.restoreAllMocks(); vi.mocked(loadSprites).mockReset(); });

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
