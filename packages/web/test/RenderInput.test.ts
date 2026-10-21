// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { Container, Sprite, Texture } from "pixi.js";
import type { EntityView } from "@castellan/shared";
import { bindWorldInput, SpritePicker } from "../src/render/input";

it("picks the frontmost visible sprite, preferring the smaller one at equal depth", () => {
  const world = new Container();
  const entity = (id: string, depth: number, size: number) => {
    const sprite = new Sprite(Texture.EMPTY);
    sprite.width = sprite.height = size;
    sprite.zIndex = depth;
    world.addChild(sprite);
    const view: EntityView = { id, kind: "knight", owner: "p1", x: 0, y: 0, hp: 100, maxHp: 100 };
    return { sprite, view };
  };
  const back = entity("back", 1, 10), front = entity("front", 2, 20), small = entity("small", 2, 10);
  const picker = new SpritePicker();
  const pick = () => picker.pick(5, 5, [back, front, small], [])?.view.id;
  expect(pick()).toBe("small");
  small.sprite.visible = false;
  expect(pick()).toBe("front");
  world.removeChild(front.sprite);
  expect(pick()).toBe("back");
  expect(picker.pick(30, 30, [back], [])).toBeNull();
  front.sprite.destroy();
  world.destroy({ children: true });
});

it("distinguishes clicks from drags and continues panning after a pinch", () => {
  const canvas = document.createElement("canvas");
  canvas.setPointerCapture = vi.fn();
  canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200, toJSON() {} });
  const world = new Container();
  const callbacks = { zoom: vi.fn(), pointer: vi.fn(), select: vi.fn() };
  bindWorldInput(canvas, world, { width: 200 }, callbacks);
  const pointer = (type: string, id: number, x: number, y: number) => {
    const event = new MouseEvent(type, { clientX: x, clientY: y });
    Object.defineProperty(event, "pointerId", { value: id });
    canvas.dispatchEvent(event);
  };
  pointer("pointermove", 1, 40, 20);
  expect(callbacks.pointer).toHaveBeenLastCalledWith({ x: 20, y: 10 });
  pointer("pointerdown", 1, 40, 20);
  pointer("pointerup", 1, 40, 20);
  expect(callbacks.select).toHaveBeenCalledOnce();
  pointer("pointerdown", 1, 40, 20);
  pointer("pointermove", 1, 60, 40);
  expect([world.x, world.y]).toEqual([10, 10]);
  pointer("pointerdown", 2, 100, 40);
  pointer("pointermove", 2, 140, 40);
  expect(callbacks.zoom).toHaveBeenLastCalledWith(2, 50, 20);
  expect([world.x, world.y]).toEqual([20, 10]);
  pointer("pointercancel", 2, 140, 40);
  pointer("pointermove", 1, 80, 60);
  expect([world.x, world.y]).toEqual([30, 20]);
  pointer("pointerup", 1, 80, 60);
  expect(callbacks.select).toHaveBeenCalledOnce();
  pointer("pointerleave", 1, 80, 60);
  expect(callbacks.pointer).toHaveBeenLastCalledWith(null);
  world.destroy();
});
