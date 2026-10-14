// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Ruleset, SpectatorView } from "@aoa/shared";
import { GameCanvas } from "../src/components/GameCanvas";
import { GameRenderer } from "../src/render/renderer";

vi.mock("../src/render/renderer", () => ({ GameRenderer: { create: vi.fn() } }));

function fakeRenderer() {
  let destroyed = false;
  const checkAlive = () => {
    if (destroyed) throw new Error("Used a destroyed renderer");
  };
  return {
    destroy: vi.fn(() => { destroyed = true; }),
    setFrame: vi.fn(checkAlive),
    setPaused: vi.fn(checkAlive),
    onHover: vi.fn(checkAlive),
    onSelect: vi.fn(checkAlive),
    select: vi.fn(checkAlive),
    onSound: vi.fn(checkAlive),
    zoom: vi.fn(checkAlive),
  };
}

let root: Root;
let host: HTMLDivElement;
let pending: Array<(r: GameRenderer) => void>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  pending = [];
  vi.mocked(GameRenderer.create).mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const ruleset = {} as Ruleset;
const frame = { tick: 1 } as SpectatorView;
const render = (rules: Ruleset, view: SpectatorView | null = frame, visible = true) => act(async () => {
  root.render(createElement(GameCanvas, { ruleset: rules, colors: { p1: 0 }, frame: view, tickMs: 100, visible }));
});
const ready = (index: number, r: ReturnType<typeof fakeRenderer>) => act(async () => {
  pending[index](r as unknown as GameRenderer);
});

it.each([false, true])("prepares the entire frame before displaying it (intro finished=%s)", async visible => {
  await render(ruleset, null, visible);
  const r = fakeRenderer();
  await ready(0, r);
  expect(r.setFrame).not.toHaveBeenCalled();
  expect(getComputedStyle(host.querySelector(".canvas-host")!).visibility).toBe("hidden");
  await render(ruleset, frame, visible);
  expect(r.setFrame).toHaveBeenCalledWith(frame, 100, false);
  expect(getComputedStyle(host.querySelector(".canvas-host")!).visibility).toBe(visible ? "visible" : "hidden");
  await render(ruleset, frame, true);
  expect(getComputedStyle(host.querySelector(".canvas-host")!).visibility).toBe("visible");
  expect(r.setFrame).toHaveBeenCalledOnce();
});

it("does not report readiness from a canvas replaced before its first paint", async () => {
  const callbacks = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => callbacks.delete(key));
  const paint = () => { const batch = [...callbacks.values()]; callbacks.clear(); batch.forEach(callback => callback(0)); };
  const onReady = vi.fn();
  const mount = (rules: Ruleset, visible = true) => act(async () => {
    root.render(createElement(GameCanvas, { ruleset: rules, colors: {}, frame, tickMs: 100, onReady, visible }));
  });
  await mount(ruleset);
  await ready(0, fakeRenderer());
  paint();
  const replacement = { ...ruleset };
  await mount(replacement, false);
  paint();
  expect(onReady).not.toHaveBeenCalled();
  await ready(1, fakeRenderer());
  paint();
  paint();
  expect(onReady).not.toHaveBeenCalled();
  await mount(replacement);
  paint();
  paint();
  expect(onReady).toHaveBeenCalledOnce();
});

it("does not feed frames or zoom a destroyed renderer while reconnecting", async () => {
  await render(ruleset);
  const old = fakeRenderer();
  await ready(0, old);
  expect(old.setFrame).toHaveBeenCalledWith(frame, 100, false);

  // A reconnect sends a fresh ruleset object and a frame with units that died meanwhile.
  const reconnectedRules = { ...ruleset };
  await render(reconnectedRules, { tick: 2 } as SpectatorView);
  expect(old.destroy).toHaveBeenCalledOnce();
  await act(async () => host.querySelector("button")!.click());
  const latest = { tick: 3 } as SpectatorView;
  await render(reconnectedRules, latest);
  expect(old.setFrame).toHaveBeenCalledTimes(1);
  expect(old.zoom).not.toHaveBeenCalled();

  const replacement = fakeRenderer();
  await ready(1, replacement);
  expect(replacement.setFrame).toHaveBeenCalledWith(latest, 100, false);
  await act(async () => host.querySelector("button")!.click());
  expect(replacement.zoom).toHaveBeenCalledWith(1.25);
});

it("disposes an initialization that finishes after a newer renderer is ready", async () => {
  await render(ruleset);
  await render({ ...ruleset });
  const current = fakeRenderer();
  await ready(1, current);
  const stale = fakeRenderer();
  await ready(0, stale);
  expect(stale.destroy).toHaveBeenCalledOnce();
  expect(stale.setFrame).not.toHaveBeenCalled();
  expect(current.destroy).not.toHaveBeenCalled();
});

it("disposes an initialization that finishes after unmount", async () => {
  await render(ruleset);
  await act(async () => root.unmount());
  const stale = fakeRenderer();
  await ready(0, stale);
  expect(stale.destroy).toHaveBeenCalledOnce();
  expect(stale.setFrame).not.toHaveBeenCalled();
});

it("shows an actionable error when assets fail and retries initialization", async () => {
  vi.mocked(GameRenderer.create).mockRejectedValueOnce(new Error("asset unavailable"));
  await render(ruleset, frame, false);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Couldn’t load the battlefield");
  expect(getComputedStyle(host.querySelector(".canvas-host")!).visibility).toBe("visible");
  await act(async () => host.querySelector('[role="alert"] button')!.dispatchEvent(new MouseEvent('click', {bubbles: true})));
  expect(GameRenderer.create).toHaveBeenCalledTimes(2);
  const r = fakeRenderer();
  await ready(0, r);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(r.setFrame).toHaveBeenCalledWith(frame, 100, false);
  expect(getComputedStyle(host.querySelector(".canvas-host")!).visibility).toBe("hidden");
  await render(ruleset, frame, true);
  expect(getComputedStyle(host.querySelector(".canvas-host")!).visibility).toBe("visible");
});
