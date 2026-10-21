// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { Container } from "pixi.js";
import { WorldCamera } from "../src/render/camera";

afterEach(() => vi.unstubAllGlobals());

it("anchors zoom at the pointer and keeps manual framing on resize", () => {
  const world = new Container();
  const camera = new WorldCamera(world, 24, 24, () => 0, false, true);
  camera.resize(800, 600);
  const point = world.toLocal({ x: 230, y: 170 });
  camera.zoom(1.3, 230, 170);
  const anchored = world.toGlobal(point);
  expect(Math.abs(anchored.x - 230)).toBeLessThanOrEqual(.5);
  expect(Math.abs(anchored.y - 170)).toBeLessThanOrEqual(.5);
  world.position.set(123, 234); // A user drag.
  const scale = world.scale.x;
  camera.resize(400, 300);
  expect([world.x, world.y, world.scale.x]).toEqual([123, 234, scale]);
  camera.zoom(100);
  expect(world.scale.x).toBe(3);
  camera.zoom(.001);
  expect(world.scale.x).toBe(.35);
  world.destroy();
});

it("fits decorative maps on narrow screens and follows the supplied recording clock", () => {
  const world = new Container();
  let now = 0;
  const camera = new WorldCamera(world, 64, 64, () => now, true, false);
  camera.resize(200, 300);
  expect(world.scale.x).toBeLessThan(.35);
  camera.resize(1000, 700);
  const pose = () => [world.x, world.y, world.scale.x];
  camera.focus({ x0: 10, y0: 10, x1: 20, y1: 20 });
  camera.update();
  const first = pose();
  camera.focus({ x0: 30, y0: 30, x1: 40, y1: 40 });
  expect(pose()).toEqual(first); // Following starts on a draw, not a snapshot.
  now = 100;
  camera.update();
  expect(pose()).not.toEqual(first);
  const moved = pose();
  camera.update();
  expect(pose()).toEqual(moved); // No wall-clock movement between recorded frames.
  world.destroy();
});

it("centres reduced-motion shots within the focus area without sway", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const world = new Container();
  let now = 0;
  const camera = new WorldCamera(world, 24, 24, () => now, false, true);
  camera.resize(1000, 700);
  camera.focus({ x0: 5, y0: 5, x1: 15, y1: 15 });
  const full = [world.x, world.y];
  camera.setFocusArea({ x: 100, y: 50, w: 1000, h: 700 });
  expect([world.x, world.y]).toEqual([full[0] + 100, full[1] + 50]);
  const pose = [world.x, world.y, world.scale.x];
  now = 3000;
  camera.update();
  expect([world.x, world.y, world.scale.x]).toEqual(pose);
  world.destroy();
});
