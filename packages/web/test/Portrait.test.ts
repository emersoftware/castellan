// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Portrait } from "../src/components/Portrait";
import tower from "../public/game-assets/sprites/tower/manifest.json";
import castle from "../public/game-assets/sprites/castle/manifest.json";
import knight from "../public/game-assets/sprites/knight/manifest.json";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each([
  { kind: "tower" as const, manifest: tower, row: 0 },
  { kind: "castle" as const, manifest: castle, row: 0 },
  { kind: "knight" as const, manifest: knight, row: 1 },
])("draws $kind from its published south-east atlas view", async ({ kind, manifest, row }) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const observers: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { observers.push(callback); }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => manifest }));
  const meta = manifest.idle;
  vi.stubGlobal("Image", class {
    width = meta.frameWidth * meta.frameCount;
    height = meta.frameHeight * meta.rows.length;
    onload?: () => void;
    set src(_src: string) { this.onload?.(); }
  });
  const drawImage = vi.fn();
  const context = { drawImage, clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(Portrait, { kind, idle: true })));
  await act(async () => observers.forEach(callback => callback([{ isIntersecting: true }])));
  const crop = drawImage.mock.calls.find(call => call.length === 9);
  expect(crop).toBeDefined();
  expect(crop!.slice(1, 5)).toEqual([0, row * meta.frameHeight, meta.frameWidth, meta.frameHeight]);
  expect(crop![2] + crop![4]).toBeLessThanOrEqual(meta.frameHeight * meta.rows.length);
});

it("waits until the portrait approaches the viewport before downloading its atlas", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const observers: Array<{ callback: (entries: Array<{ isIntersecting: boolean }>) => void; disconnect: ReturnType<typeof vi.fn> }> = [];
  vi.stubGlobal("IntersectionObserver", class {
    disconnect = vi.fn();
    constructor(public callback: (entries: Array<{ isIntersecting: boolean }>) => void) { observers.push(this); }
    observe() {}
  });
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetch);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(Portrait, { kind: "knight", idle: true })));
  expect(fetch).not.toHaveBeenCalled();
  observers[0].callback([{ isIntersecting: false }]);
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => observers[0].callback([{ isIntersecting: true }]));
  expect(fetch).toHaveBeenCalledExactlyOnceWith("/game-assets/sprites/knight/manifest.json");
  expect(observers[0].disconnect).toHaveBeenCalledOnce();
  observers[0].callback([{ isIntersecting: true }]);
  expect(fetch).toHaveBeenCalledOnce();
});
