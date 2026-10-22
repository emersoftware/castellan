// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import type { Graphics } from 'pixi.js';
import { rules, type EntityView, type SpectatorView } from '@castellan/shared';
import { strikeMs, unitLook, type Strike } from '../src/render/look';
import { createField, frameAt } from './support/battlefield';
import atlas from '../../../assets/sprites/archer/manifest.json';

const row = [0, 1, 2, 3, 4, 3, 2, 1];
const SHOT_RECOVERY_MS = strikeMs('archer')!;
/** An archer standing (`walked` undefined) or walking. */
const pose = (timeMs: number, walked: number | undefined, strike: Strike) => unitLook({ kind: 'archer', x: 0, y: 0 }, strike.dir, timeMs, { walked, strike }).animation!;
it.each(row.map((_, dir) => dir))('starts direction %i at its release marker and returns to locomotion', (dir) => {
  expect(pose(1000, 0, { at: 1000, dir })).toEqual({ action: 'shoot', frame: atlas.shoot.releaseFrames[row[dir]] });
  expect(pose(1000 + SHOT_RECOVERY_MS - 1, 0, { at: 1000, dir }).frame).toBe(27);
  expect(pose(1000 + SHOT_RECOVERY_MS, 0, { at: 1000, dir }).action).toBe('walk');
  expect(pose(1000 + SHOT_RECOVERY_MS, undefined, { at: 1000, dir }).action).toBe('idle');
});

function setup() {
  // Diagonal steps at straight-step speed: these tests are about walking continuity.
  const h = createField({ ruleset: { ...rules, diagonalMove: 1 }, colors: { a: 0, b: 1 } });
  const archer: EntityView = { id: 'r', kind: 'archer', owner: 'a', x: 4, y: 4, hp: 40, maxHp: 40 };
  const target: EntityView = { ...archer, id: 't', kind: 'worker', owner: 'b', x: 2, y: 6 };
  const frame = (tick: number, entities = [archer, target]) => frameAt(tick, entities);
  const firing: SpectatorView = { ...frame(2), events: [{ tick: 1, type: 'attack', from: 'r', to: 't', dmg: 0, projectile: 'p' }],
    projectiles: [{ id: 'p', owner: 'a', x: 4, y: 4, vx: -6, vy: 6, endX: 2, endY: 6 }] };
  const lastArcher = () => h.sprites.mock.calls.filter(call => call[0] === 'archer').at(-1)!;
  /** Streaks in the effects layer, after one health bar per living entity. */
  const shots = () => h.layers.fx.children.length - h.field.entities.figures.size;
  return { ...h, frame, firing, archer, target, lastArcher, shots };
}

it('locks toward the launched arrow, despite a later opposite movement heading', () => {
  const h = setup();
  h.field.show(h.frame(1), 100);
  h.field.show(h.firing, 100);
  h.animate();
  expect(h.lastArcher().slice(1)).toEqual([6, { action: 'shoot', frame: atlas.shoot.releaseFrames[2] }]);
  expect(h.shots()).toBe(1); // present on the release frame, without a duplicate cosmetic arrow
  h.time(1100);
  h.field.show({ ...h.frame(3, [{ ...h.archer, x: 5, y: 3 }, h.target]), projectiles: h.firing.projectiles }, 100);
  h.animate();
  expect(h.lastArcher()[1]).toBe(6);
  h.time(1300);
  h.field.show(h.frame(5, [{ ...h.archer, x: 6, y: 2 }, h.target]), 100);
  h.animate();
  expect(h.lastArcher().slice(1, 2)).toEqual([2]);
  expect(h.lastArcher()[2]?.action).toBe('walk');
});

it('still animates release when the target disappears from the launch snapshot', () => {
  const h = setup();
  h.field.show(h.frame(1), 100);
  h.field.show({ ...h.firing, entities: [h.archer] }, 100);
  h.animate();
  expect(h.lastArcher()[1]).toBe(6);
  expect(h.lastArcher()[2]?.action).toBe('shoot');
});

it.each([50, 100, 200])('uses simulation time at replay tick duration %i ms, freezes on pause and clears on seek', (tickMs) => {
  const h = setup();
  h.field.show(h.frame(1), tickMs);
  h.field.show(h.firing, tickMs);
  h.time(1000 + tickMs / 2);
  h.animate();
  const halfway = h.lastArcher()[2];
  expect(halfway).toEqual(pose(250, undefined, { at: 200, dir: 6 }));
  h.clock.pause();
  h.time(10000);
  h.animate();
  expect(h.lastArcher()[2]).toEqual(halfway);
  h.clock.resume();
  h.animate();
  expect(h.lastArcher()[2]).toEqual(halfway);
  h.field.seek(h.frame(1), tickMs);
  h.animate();
  expect(h.lastArcher()[2]?.action).toBe('idle');
  expect(h.shots()).toBe(0);
  // The strike did not survive the seek: its release tick shows no shot when reached again.
  h.field.show(h.frame(2), tickMs);
  h.animate();
  expect(h.lastArcher()[2]?.action).toBe('idle');
});

it.each([50, 100, 200])('keeps walking through stationary snapshots between tile steps at %i ms replay ticks', (tickMs) => {
  const h = setup();
  h.field.show(h.frame(1), tickMs);
  const moved = { ...h.archer, x: 5, y: 3 };
  const frames = new Set<number>();
  for (let tick = 2; tick <= 9; tick++) {
    // Base archer cadence is 380 ms, rounded to four 100 ms game ticks.
    const current = tick < 6 ? moved : { ...moved, x: 6, y: 2 };
    h.time(1000 + (tick - 2) * tickMs);
    h.field.show(h.frame(tick, [current, h.target]), tickMs);
    for (const fraction of [0, 0.5, 1]) {
      h.time(1000 + (tick - 2 + fraction) * tickMs);
      h.animate();
      expect(h.lastArcher()[2]?.action).toBe('walk');
      frames.add(h.lastArcher()[2]!.frame);
      if (tick === 4 && fraction === 0) {
        // Halfway through a four-tick step, not already at the next tile.
        expect(h.sprite('r').x).toBeCloseTo(16);
        expect(h.sprite('r').y).toBeCloseTo(67);
      }
    }
  }
  expect(frames.size).toBeGreaterThan(6);
  // No further tile step: stop, rather than keeping walk alive from an old heading.
  h.field.show(h.frame(10, [{ ...moved, x: 6, y: 2 }, h.target]), tickMs);
  h.animate();
  expect(h.lastArcher()[2]?.action).toBe('idle');
});

it('uses upgraded cadence and resets walking when seeking', () => {
  const h = setup();
  h.field.show(h.frame(1), 100);
  const moved = { ...h.archer, x: 5, stats: { atk: 12, def: 2, range: 4, attackMs: 1000, moveMs: 300 } };
  for (let tick = 2; tick <= 4; tick++) {
    h.time(1000 + (tick - 2) * 100);
    h.field.show(h.frame(tick, [moved, h.target]), 100);
    h.animate();
    expect(h.lastArcher()[2]?.action).toBe('walk');
  }
  h.clock.pause();
  const pose = h.lastArcher()[2];
  h.time(10000);
  h.animate();
  expect(h.lastArcher()[2]).toEqual(pose);
  h.clock.resume();
  h.field.show(h.frame(5, [moved, h.target]), 100);
  h.animate();
  expect(h.lastArcher()[2]?.action).toBe('idle');
  h.field.show(h.frame(6, [{ ...moved, x: 6 }, h.target]), 100);
  h.animate();
  expect(h.lastArcher()[2]?.action).toBe('walk');
  h.field.seek(h.frame(2, [moved, h.target]), 100);
  h.animate();
  expect(h.lastArcher()[2]?.action).toBe('idle');
});

it('cancels the remaining walking window when shooting and stays idle after recovery', () => {
  const h = setup();
  h.field.show(h.frame(1, [{ ...h.archer, x: 3 }, h.target]), 100);
  h.field.show(h.frame(2, [{ ...h.archer, stats: { atk: 12, def: 2, range: 4, attackMs: 1000, moveMs: 600 } }, h.target]), 100);
  h.time(1100);
  h.field.show({ ...h.firing, tick: 3, timeMs: 300 }, 100);
  h.animate();
  expect(h.lastArcher()[2]?.action).toBe('shoot');
  // A slow archer would otherwise resume walking as soon as the recovery finishes.
  h.time(1400);
  h.field.show(h.frame(6), 100);
  h.animate();
  expect(h.lastArcher()[2]?.action).toBe('idle');
});

it('preserves step position and animation phase when changing speed mid-tick', () => {
  const h = setup();
  h.field.show(h.frame(1), 100);
  const moved = { ...h.archer, x: 5, y: 3 };
  h.field.show(h.frame(2, [moved, h.target]), 100);
  h.time(1100);
  const frame = h.frame(3, [moved, h.target]);
  h.field.show(frame, 100);
  h.time(1150);
  h.animate();
  const sprite = h.sprite('r');
  const before = { x: sprite.x, y: sprite.y, frame: h.lastArcher()[2] };
  // The replay resends the current snapshot at the new speed.
  h.field.show(frame, 50);
  h.animate();
  expect({ x: sprite.x, y: sprite.y, frame: h.lastArcher()[2] }).toEqual(before);
  h.clock.pause();
  h.time(10000);
  h.animate();
  expect({ x: sprite.x, y: sprite.y, frame: h.lastArcher()[2] }).toEqual(before);
  h.clock.resume();
  h.animate();
  expect({ x: sprite.x, y: sprite.y, frame: h.lastArcher()[2] }).toEqual(before);
});

it('launches immediately from a travelling archer and settles within one tick', () => {
  const h = setup();
  h.field.show(h.frame(1, [{ ...h.archer, x: 3 }, h.target]), 100);
  h.field.show(h.frame(2), 100);
  h.time(1100);
  h.field.show({ ...h.firing, tick: 3, timeMs: 300 }, 100);
  const sprite = h.sprite('r');
  // The shot's streak joins the effects layer after the entities' health bars.
  const streak = h.layers.fx.children.at(-1) as Graphics;
  const lineTo = vi.spyOn(streak, 'lineTo');
  h.animate();
  expect(h.lastArcher().slice(1)).toEqual([6, { action: 'shoot', frame: atlas.shoot.releaseFrames[2] }]);
  expect(sprite.x).toBeCloseTo(-12); // 25% through the step, still behind the authoritative tile
  expect(lineTo).toHaveBeenLastCalledWith(sprite.x, sprite.y - 9);
  h.time(1200);
  h.animate();
  expect(sprite.x).toBeCloseTo(0);
  expect(sprite.y).toBeCloseTo(67);
  expect(lineTo).toHaveBeenLastCalledWith(0, 58);
});

it('does not flash idle at the interpolation boundary while awaiting the next snapshot', () => {
  const h = setup();
  h.field.show(h.frame(1), 100);
  for (let tick = 2; tick <= 5; tick++) {
    h.time(1000 + (tick - 2) * 100);
    h.field.show(h.frame(tick, [{ ...h.archer, x: 5 }, h.target]), 100);
  }
  h.time(1600);
  h.animate();
  expect(h.lastArcher()[2]?.action).toBe('walk');
  h.field.show(h.frame(6, [{ ...h.archer, x: 5 }, h.target]), 100);
  h.animate();
  expect(h.lastArcher()[2]?.action).toBe('idle');
});
