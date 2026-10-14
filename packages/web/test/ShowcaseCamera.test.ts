import { expect, it } from "vitest";
import { followUnits, planShowcaseCamera, shotAt, type CameraActivity, type CameraBox } from "../src/showcaseCamera";
import type { SpectatorView } from "@aoa/shared";

const RATE = 10;
/** Two sides trading blows around (x, y) every tick in [from, to). */
const fight = (x: number, y: number, from: number, to: number): CameraActivity[] =>
  Array.from({ length: to - from }, (_, i) => ({ tick: from + i, points: [{ x, y }, { x: x + 2, y: y + 1 }, { x: x - 1, y: y + 2 }] }));
const contains = (box: CameraBox, x: number, y: number) => box.x0 <= x && x <= box.x1 && box.y0 <= y && y <= box.y1;

it("opens on the whole map, then holds a close-up on the coming fight", () => {
  const shots = planShowcaseCamera(fight(30, 10, 60, 150), 0, 400, RATE);
  expect(shots[0]).toEqual({ tick: 0, box: null });
  const close = shots.find(shot => shot.box)!;
  expect(close.tick).toBe(50);
  expect(contains(close.box!, 30, 10) && contains(close.box!, 32, 11) && contains(close.box!, 29, 12)).toBe(true);
  expect(close.box!.x1 - close.box!.x0).toBeGreaterThanOrEqual(12);
  // The fight ends at 150: the camera lingers, then returns to the whole map.
  const after = shots[shots.indexOf(close) + 1];
  expect(after.box).toBeNull();
  expect(after.tick - close.tick).toBeGreaterThanOrEqual(5 * RATE);
});

it("returns to the whole map between fights in different places and never cuts faster than a few seconds", () => {
  const shots = planShowcaseCamera([...fight(8, 8, 60, 160), ...fight(36, 36, 160, 260)], 0, 400, RATE);
  const boxes = shots.map(shot => shot.box && [Math.round((shot.box.x0 + shot.box.x1) / 2), Math.round((shot.box.y0 + shot.box.y1) / 2)]);
  const first = boxes.findIndex(b => b?.[0] === 9), second = boxes.findIndex(b => b?.[0] === 37);
  expect(first).toBeGreaterThan(0);
  expect(second).toBeGreaterThan(first + 1);
  expect(boxes.slice(first + 1, second)).toContain(null);
  for (let i = 1; i < shots.length; i++) expect(shots[i].tick - shots[i - 1].tick).toBeGreaterThanOrEqual(2 * RATE);
});

it("leaves the whole map in view when there is no real fight, and finds the shot for any tick", () => {
  const skirmish: CameraActivity[] = [{ tick: 80, points: [{ x: 4, y: 4 }, { x: 5, y: 4 }] }];
  const shots = planShowcaseCamera(skirmish, 0, 400, RATE);
  expect(shots).toEqual([{ tick: 0, box: null }]);
  const planned = [{ tick: 0, box: null }, { tick: 50, box: { x0: 0, y0: 0, x1: 12, y1: 12 } }];
  expect(shotAt(planned, 49)).toBe(planned[0]);
  expect(shotAt(planned, 50)).toBe(planned[1]);
  expect(shotAt(undefined, 50)).toBeUndefined();
});

it("keeps a close-up's size and centres it on the units in view, ignoring buildings", () => {
  const unit = (kind: string, x: number, y: number) => ({ id: `${kind}${x},${y}`, kind, owner: "p1", x, y, hp: 1, maxHp: 1 });
  const view = (entities: ReturnType<typeof unit>[]) => ({ tick: 0, entities, events: [] }) as unknown as SpectatorView;
  const isBuilding = (kind: string) => kind === "castle";
  const box: CameraBox = { x0: 10, y0: 10, x1: 22, y1: 22 };
  const moved = followUnits(box, view([unit("knight", 18, 18), unit("archer", 20, 20), unit("castle", 11, 11), unit("knight", 40, 40)]), isBuilding);
  expect(moved).toEqual({ x0: 13, y0: 13, x1: 25, y1: 25 });
  expect(followUnits(box, view([unit("castle", 12, 12), unit("knight", 40, 40)]), isBuilding)).toBe(box);
});
