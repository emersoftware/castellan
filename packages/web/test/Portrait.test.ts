// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Portrait } from "../src/components/Portrait";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  vi.unstubAllGlobals();
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
