import { expect, it } from "vitest";
import type { EntityView, GameEvent, SpectatorView } from "@castellan/shared";
import { biggestBattle, planScriptReveals, planVideoShots, storyStart, withReveals, type VideoShot } from "../src/videoDirector";

const RATE = 10;
const isArmy = (kind: string) => kind === "knight";
const isBuilding = (kind: string) => kind === "castle";
const unit = (id: string, owner: string, x: number, y: number, kind = "knight") => ({ id, kind, owner, x, y, hp: 1, maxHp: 1 }) as EntityView;
const view = (tick: number, entities: EntityView[], events: GameEvent[] = []) => ({
  tick, entities, events,
  players: [{ id: "p1", team: 0 }, { id: "p2", team: 1 }, { id: "p3", team: 0 }],
}) as unknown as SpectatorView;
/** Knights of `a` and `b` trading blows at (x, y); the ones in `dead` are gone. */
const clash = (tick: number, x: number, y: number, a: [string, number], b: [string, number]) => {
  const units = [
    ...Array.from({ length: a[1] }, (_, i) => unit(`${a[0]}-${i}`, a[0], x + (i % 3), y + Math.floor(i / 3))),
    ...Array.from({ length: b[1] }, (_, i) => unit(`${b[0]}-${i}`, b[0], x + 3 + (i % 3), y + Math.floor(i / 3))),
  ];
  const fighters = units.filter(u => u.owner === a[0]), enemies = units.filter(u => u.owner === b[0]);
  const events = fighters.flatMap(f => enemies.length ? [{ type: "attack", from: f.id, to: enemies[0].id } as GameEvent] : []);
  return view(tick, units, events);
};

it("frames a fight under the fog of its bigger army until that army's enemies are gone, then shows the whole map", () => {
  const frames = [
    ...Array.from({ length: 30 }, (_, t) => view(t, [])),
    ...Array.from({ length: 40 }, (_, i) => clash(30 + i, 10, 10, ["p2", 5], ["p1", 2])),
    // p1's knights fall; p2's walk on without fighting.
    ...Array.from({ length: 60 }, (_, i) => view(70 + i, Array.from({ length: 5 }, (_, k) => unit(`p2-${k}`, "p2", 10 + (k % 3), 10)))),
  ];
  const shots = planVideoShots(frames, RATE, isArmy, isBuilding);
  expect(shots[0]).toEqual({ box: null, pov: null });
  // The camera arrives before the first blow.
  expect(shots[15].pov).toBe("p2");
  expect(shots[50].pov).toBe("p2");
  expect(shots[50].box!.x0).toBeLessThanOrEqual(10);
  expect(shots[50].box!.x1).toBeGreaterThanOrEqual(13);
  expect(shots[71]).toEqual({ box: null, pov: null });
  expect(shots[129]).toEqual({ box: null, pov: null });
});

it("goes to the next fight when one ends, keeping the larger side's view of each", () => {
  const frames = [
    ...Array.from({ length: 40 }, (_, t) => clash(t, 5, 5, ["p1", 4], ["p2", 2])),
    ...Array.from({ length: 40 }, (_, i) => view(40 + i, [
      ...clash(40 + i, 30, 30, ["p2", 6], ["p3", 1]).entities,
    ], clash(40 + i, 30, 30, ["p2", 6], ["p3", 1]).events)),
  ];
  const shots = planVideoShots(frames, RATE, isArmy, isBuilding);
  expect(shots[20].pov).toBe("p1");
  expect(shots[41].pov).toBe("p2");
  expect(shots[41].box!.x0).toBeGreaterThan(20);
});

it("follows a fight's bigger army from the moment it leaves its castle, and starts the story there", () => {
  const castle = unit("c1", "p2", 0, 30, "castle");
  // p2's five knights walk from their castle (0, 30) to (24, 30), a tile every half second, then fight p1 there.
  const walk = Array.from({ length: 120 }, (_, t) => view(t + 10, [castle, ...Array.from({ length: 5 }, (_, k) => unit(`p2-${k}`, "p2", Math.floor(t / 5) + (k % 3), 30 + Math.floor(k / 3)))]));
  const frames = [
    ...Array.from({ length: 10 }, (_, t) => view(t, [castle])),
    ...walk,
    ...Array.from({ length: 30 }, (_, i) => { const c = clash(130 + i, 24, 30, ["p2", 5], ["p1", 2]); return view(130 + i, [castle, ...c.entities], c.events); }),
  ];
  const shots = planVideoShots(frames, RATE, isArmy, isBuilding);
  expect(shots[5]).toEqual({ box: null, pov: null });
  // Halfway there, the camera is on the marching knights, under p2's fog.
  expect(shots[70].pov).toBe("p2");
  expect(shots[70].box!.x0).toBeLessThanOrEqual(12);
  expect(shots[70].box!.x1).toBeGreaterThanOrEqual(14);
  // The march starts where the knights are still beside their castle.
  const start = storyStart(shots)!;
  expect(start).toBeGreaterThanOrEqual(10);
  expect(start).toBeLessThanOrEqual(50);
  expect(storyStart(planVideoShots(Array.from({ length: 20 }, (_, t) => view(t, [castle])), RATE, isArmy, isBuilding))).toBeNull();
});

it("opens each script upload on a unit of its kind, one after another, skipping replaced ones", () => {
  const frames = Array.from({ length: 200 }, (_, t) => view(t, [unit("w1", "p1", 0, 0, "worker"), ...(t >= 50 ? [unit("k1", "p2", 4, 4)] : [])]));
  const reveals = planScriptReveals([
    { tick: 10, player: "p1", kind: "worker", code: "a" },
    // No knight yet: it opens when the first one exists, after the worker's.
    { tick: 12, player: "p2", kind: "knight", code: "b" },
    { tick: 100, player: "p1", kind: "worker", code: "c" },
    { tick: 101, player: "p1", kind: "worker", code: "d" },
  ], frames, frames.map(() => ({ box: null, pov: null })), 40, 300);
  expect(reveals).toEqual([
    { tick: 10, until: 50, unit: "w1" },
    { tick: 50, until: 90, unit: "k1" },
    { tick: 101, until: 141, unit: "w1" },
  ]);
});

it("opens a script only on a unit the screen shows, and takes the camera to it when no battle is on", () => {
  // A battle shot around (20, 20) under p2's fog for the first 100 ticks; then the whole map.
  const battle: VideoShot = { box: { x0: 14, y0: 14, x1: 26, y1: 26 }, pov: "p2" };
  const shots: VideoShot[] = Array.from({ length: 200 }, (_, t) => (t < 100 ? battle : { box: null, pov: null }));
  // p1's knight walks into the shot at tick 60; p2 sees it only from tick 70.
  const frames = Array.from({ length: 200 }, (_, t) => {
    const knight = unit("k1", "p1", t < 60 ? 2 : 20, 20);
    const f = view(t, [knight]);
    f.perspectives = { p2: { visibility: [], entities: t < 70 ? [] : [knight], projectiles: [], deposits: [], players: f.players, events: [] } };
    return f;
  });
  const reveals = planScriptReveals([{ tick: 10, player: "p1", kind: "knight", code: "a" }, { tick: 150, player: "p1", kind: "knight", code: "b" }], frames, shots, 40, 300);
  expect(reveals).toEqual([{ tick: 70, until: 110, unit: "k1" }, { tick: 150, until: 190, unit: "k1" }]);
  // Outside battles, the camera frames the unit whose script is open.
  const framed = withReveals(shots, reveals, frames);
  expect(framed[50]).toBe(battle);
  // After the battle the panel stays open with the camera on the knight, then the whole map returns.
  expect(framed[105].box!.x0).toBeLessThanOrEqual(20);
  expect(framed[120]).toEqual({ box: null, pov: null });
  expect(framed[160].pov).toBeNull();
  expect(framed[160].box!.x0).toBeLessThanOrEqual(20);
  expect(framed[160].box!.x1).toBeGreaterThanOrEqual(20);
});

it("picks the match's biggest battle for its picture", () => {
  const frames = [
    ...Array.from({ length: 30 }, (_, t) => clash(t, 5, 5, ["p1", 2], ["p2", 2])),
    ...Array.from({ length: 30 }, (_, i) => clash(30 + i, 30, 30, ["p1", 6], ["p2", 5])),
    ...Array.from({ length: 30 }, (_, i) => view(60 + i, [])),
  ];
  const battle = biggestBattle(frames, RATE)!;
  expect(battle.tick).toBeGreaterThanOrEqual(30);
  expect(battle.tick).toBeLessThan(60);
  expect(battle.box.x0).toBeLessThanOrEqual(30);
  expect(battle.box.x1).toBeGreaterThanOrEqual(35);
  expect(biggestBattle(frames.slice(60), RATE)).toBeNull();
});
