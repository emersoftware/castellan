// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { rules, type EntityView } from '@castellan/shared';
import { fall } from '../src/render/look';
import { PLAYER_RAMPS } from '../src/render/palette';
import { createField, frameAt, stubArt } from './support/battlefield';

const cases = [
  { kind: 'castle', art: 'castle' }, { kind: 'nexus', art: 'castle' }, { kind: 'tower', art: 'tower' },
  { kind: 'wall', art: 'wallpost' },
  { kind: 'wall', art: 'wall', neighbor: 'wall' },
  { kind: 'wall', art: 'wall-door-left', neighbor: 'door' },
  { kind: 'door', art: 'door' }, { kind: 'door', art: 'door-open', open: true },
];

function setup(kind: string, open = false, neighbor?: string) {
  const ruleset = kind === 'nexus' ? { ...rules, kinds: { ...rules.kinds, nexus: rules.kinds.castle } } : rules;
  const h = createField({ ruleset, colors: { a: 2 }, art: stubArt({ scale: 1 / 3, anchorX: .5, anchorY: .75 }) });
  const rocks = h.layers.objects.children.length;
  const entity: EntityView = { id: 'u', kind, owner: 'a', x: 4, y: 4, hp: 100, maxHp: 100, open };
  const neighbors: EntityView[] = neighbor ? [{ ...entity, id: 'n', kind: neighbor, x: 5 }] : [];
  h.field.show(frameAt(1, [entity, ...neighbors]), 100);
  h.animate();
  const sprite = h.sprite('u');
  const die = () => h.field.show({ ...frameAt(2, neighbors), events: [
    { tick: 1, type: 'death', id: 'u', kind, owner: 'a', x: 4, y: 4 },
  ] }, 100);
  const last = () => h.sprites.mock.calls.filter(c => c[2]?.action === 'death').at(-1)!;
  /** Bodies and collapses on the field, beyond the terrain's rocks. */
  const standing = () => h.layers.objects.children.length - rocks;
  return { ...h, sprite, entity, die, last, standing };
}

it.each(cases)('plays $art fully before its final-frame fade in place, preserving axis, color and pause', ({ kind, art, open, neighbor }) => {
  const h = setup(kind, open, neighbor);
  const flip = h.sprite.scale.x < 0;
  const groundY = h.sprite.y;
  h.die(); h.animate();
  expect(h.last()[0]).toBe(art);
  expect(h.last()[2]).toEqual({ action: 'death', frame: 0 });
  expect(h.sprite.scale.x < 0).toBe(flip);
  expect(h.sprite.tint).toBe(PLAYER_RAMPS[2].key);
  const layer=h.sprite.parent!;
  expect(layer.mask).toBeUndefined();
  expect(h.sprite.y).toBe(groundY);
  h.time(2000); h.animate();
  expect(h.last()[2]?.frame).toBe(12);
  expect(h.sprite.alpha).toBe(1);
  expect(h.sprite.y).toBe(groundY);
  expect(layer.mask).toBeUndefined();
  h.clock.pause(); h.time(9000); h.animate();
  expect(h.last()[2]?.frame).toBe(12);
  expect(h.sprite.y).toBe(groundY);
  h.clock.resume(); h.time(11000); h.animate();
  expect(h.last()[2]?.frame).toBe(27);
  expect(h.sprite.alpha).toBe(1);
  expect(h.sprite.y).toBe(groundY);expect(layer.mask).toBeUndefined();
  h.time(12000); h.animate();
  expect(h.last()[2]?.frame).toBe(27);
  expect(h.sprite.alpha).toBeGreaterThan(0);expect(h.sprite.alpha).toBeLessThan(1);
  expect(h.sprite.y).toBe(groundY);
  const alpha=h.sprite.alpha;
  expect(layer.mask).toBeUndefined();
  h.clock.pause();h.time(16000);h.animate();
  expect(h.sprite.y).toBe(groundY);expect(h.sprite.alpha).toBe(alpha);expect(layer.mask).toBeUndefined();
  h.clock.resume();h.time(19000);h.animate();
  expect(h.sprite.destroyed).toBe(true);
  expect(layer.destroyed).toBe(true);
});

it('applies replay speed changes, completes after the final snapshot and cleans up on seek', () => {
  const h = setup('castle'); h.die();
  h.field.show(frameAt(2, []), 200); h.animate();
  h.time(2000); h.animate(); expect(h.last()[2]?.frame).toBe(6);
  h.field.show(frameAt(2, []), 50);
  h.time(2250); h.animate(); expect(h.last()[2]?.frame).toBe(12);
  h.time(2650); h.animate(); expect(h.last()[2]?.frame).toBe(21);
  expect(h.sprite.destroyed).toBe(false);
  h.field.seek(frameAt(1, [h.entity]), 100);
  expect(h.sprite.destroyed).toBe(true);
  expect(h.standing()).toBe(1); // only the castle standing again
});

it('does not create a collapse when a building disappears into fog', () => {
  const h = setup('tower');
  h.field.show({ ...frameAt(2, []), visibility: Array(8).fill('00000000') }, 100);
  expect(h.sprite.destroyed).toBe(true);
  expect(h.standing()).toBe(0);
});

it('holds the final frame before fading in place', () => {
  const castle = fall({ kind: 'castle', hp: 100, maxHp: 100 }, rules.kinds.castle);
  expect(castle.at(1000)).toMatchObject({alpha:1});
  expect(castle.at(3000)).toMatchObject({ animation: { action: 'death', frame: 27 }, alpha: 1 });
  const fading=castle.at(4000) as { animation: { frame: number }; alpha: number };
  expect(fading.animation.frame).toBe(27);expect(fading.alpha).toBeLessThan(1);expect(fading).not.toHaveProperty('sink');
  expect(castle.at(7000).alpha).toBe(0);
  expect(fall({ kind: 'worker', hp: 0, maxHp: 1 }, { ...rules.kinds.worker, building: true }).way).toBe('rubble');
});
