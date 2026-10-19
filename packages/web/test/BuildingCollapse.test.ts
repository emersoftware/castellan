// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { Texture, type Sprite, type Container } from 'pixi.js';
import { rules, type EntityView, type SpectatorView } from '@castellan/shared';
import { GameRenderer } from '../src/render/renderer';
import { fall } from '../src/render/look';
import { PLAYER_RAMPS } from '../src/render/palette';
import type { SpriteSet } from '../src/render/sprites';

const cases = [
  { kind: 'castle', art: 'castle' }, { kind: 'nexus', art: 'castle' }, { kind: 'tower', art: 'tower' },
  { kind: 'wall', art: 'wallpost' },
  { kind: 'wall', art: 'wall', neighbor: 'wall' },
  { kind: 'wall', art: 'wall-door-left', neighbor: 'door' },
  { kind: 'door', art: 'door' }, { kind: 'door', art: 'door-open', open: true },
];

function setup(kind: string, open = false, neighbor?: string) {
  let now = 1000;
  const ruleset = kind === 'nexus' ? { ...rules, kinds: { ...rules.kinds, nexus: rules.kinds.castle } } : rules;
  const renderer = Reflect.construct(GameRenderer, [document.createElement('div'), ruleset, { a: 2 }]) as GameRenderer;
  const internal = renderer as unknown as {
    now: () => number; play: () => void; sprites: SpriteSet; animate(): void;
    app: { renderer: { render(): void } }; effects: unknown[];
    drawn: Map<string, { sprite: Sprite; barrierArt?: string; collapseLayer?: Container }>;
  };
  internal.now = () => now;
  internal.play = vi.fn();
  internal.app = { renderer: { render() {} } };
  const sprites = vi.fn<SpriteSet>(() => ({ flip: false, art: {
    texture: Texture.EMPTY, silhouette: Texture.EMPTY, xray: Array(4).fill(Texture.EMPTY),
    scale: 1 / 3, anchorX: .5, anchorY: .75,
  } }));
  internal.sprites = sprites;
  const entity: EntityView = { id: 'u', kind, owner: 'a', x: 4, y: 4, hp: 100, maxHp: 100, open };
  const neighbors: EntityView[] = neighbor ? [{ ...entity, id: 'n', kind: neighbor, x: 5 }] : [];
  const frame = (tick: number, entities: EntityView[]) => ({ tick, timeMs: tick * 100, entities,
    deposits: [], events: [], projectiles: [] }) as unknown as SpectatorView;
  renderer.setFrame(frame(1, [entity, ...neighbors]), 100);
  internal.animate();
  const sprite = internal.drawn.get('u')!.sprite;
  const die = () => renderer.setFrame({ ...frame(2, neighbors), events: [
    { tick: 1, type: 'death', id: 'u', kind, owner: 'a', x: 4, y: 4 },
  ] }, 100);
  const last = () => sprites.mock.calls.filter(c => c[2]?.action === 'death').at(-1)!;
  return { renderer, internal, sprites, sprite, frame, entity, die, last, time: (t: number) => { now = t; } };
}

it.each(cases)('plays $art fully before its final-frame fade in place, preserving axis, color and pause', ({ kind, art, open, neighbor }) => {
  const h = setup(kind, open, neighbor);
  const flip = h.sprite.scale.x < 0;
  const groundY = h.sprite.y;
  h.die(); h.internal.animate();
  expect(h.last()[0]).toBe(art);
  expect(h.last()[2]).toEqual({ action: 'death', frame: 0 });
  expect(h.sprite.scale.x < 0).toBe(flip);
  expect(h.sprite.tint).toBe(PLAYER_RAMPS[2].key);
  const layer=h.sprite.parent!;
  expect(layer.mask).toBeUndefined();
  expect(h.sprite.y).toBe(groundY);
  h.time(2000); h.internal.animate();
  expect(h.last()[2]?.frame).toBe(12);
  expect(h.sprite.alpha).toBe(1);
  expect(h.sprite.y).toBe(groundY);
  expect(layer.mask).toBeUndefined();
  h.renderer.setPaused(true); h.time(9000); h.internal.animate();
  expect(h.last()[2]?.frame).toBe(12);
  expect(h.sprite.y).toBe(groundY);
  h.renderer.setPaused(false); h.time(11000); h.internal.animate();
  expect(h.last()[2]?.frame).toBe(27);
  expect(h.sprite.alpha).toBe(1);
  expect(h.sprite.y).toBe(groundY);expect(layer.mask).toBeUndefined();
  h.time(12000); h.internal.animate();
  expect(h.last()[2]?.frame).toBe(27);
  expect(h.sprite.alpha).toBeGreaterThan(0);expect(h.sprite.alpha).toBeLessThan(1);
  expect(h.sprite.y).toBe(groundY);
  const alpha=h.sprite.alpha;
  expect(layer.mask).toBeUndefined();
  h.renderer.setPaused(true);h.time(16000);h.internal.animate();
  expect(h.sprite.y).toBe(groundY);expect(h.sprite.alpha).toBe(alpha);expect(layer.mask).toBeUndefined();
  h.renderer.setPaused(false);h.time(19000);h.internal.animate();
  expect(h.sprite.destroyed).toBe(true);
  expect(layer.destroyed).toBe(true);
});

it('applies replay speed changes, completes after the final snapshot and cleans up on seek', () => {
  const h = setup('castle'); h.die();
  h.renderer.setFrame(h.frame(2, []), 200); h.internal.animate();
  h.time(2000); h.internal.animate(); expect(h.last()[2]?.frame).toBe(6);
  h.renderer.setFrame(h.frame(2, []), 50);
  h.time(2250); h.internal.animate(); expect(h.last()[2]?.frame).toBe(12);
  h.time(2650); h.internal.animate(); expect(h.last()[2]?.frame).toBe(21);
  expect(h.sprite.destroyed).toBe(false);
  h.renderer.setFrame(h.frame(1, [h.entity]), 100, true);
  expect(h.sprite.destroyed).toBe(true);
  expect(h.internal.effects).toHaveLength(0);
});

it('does not create a collapse when a building disappears into fog', () => {
  const h = setup('tower');
  h.renderer.setFrame({ ...h.frame(2, []), visibility: Array(8).fill('00000000') }, 100);
  expect(h.sprite.destroyed).toBe(true);
  expect(h.internal.effects).toHaveLength(0);
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
