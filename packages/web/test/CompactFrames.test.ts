import { expect, it } from 'vitest';
import type { EntityView, SpectatorView } from '@castellan/shared';
import { frameCompactor } from '../src/compactFrames';

const unit = (x: number, order?: string): EntityView => ({ id: 'u', kind: 'knight', owner: 'a', x, y: 2, hp: 10, maxHp: 10, stats: { atk: 1, def: 1, range: 1, attackMs: 1000, moveMs: 500 }, ...(order ? { order } : {}) });
const frame = (tick: number, x: number): SpectatorView => ({ tick, entities: [unit(x, 'move 9,2')], deposits: [], visibility: undefined,
  perspectives: { a: { visibility: ['22'], entities: [unit(x, 'move 9,2')], deposits: [], projectiles: [], players: [], events: [] },
    b: { visibility: ['22'], entities: [unit(x)], deposits: [], projectiles: [], players: [], events: [] } } }) as unknown as SpectatorView;

it('keeps frames equal while sharing unchanged views between ticks and perspectives', () => {
  const compact = frameCompactor();
  const [one, two, three] = [frame(1, 4), frame(2, 4), frame(3, 5)].map((f) => compact(structuredClone(f)));
  expect([one, two, three]).toEqual([frame(1, 4), frame(2, 4), frame(3, 5)]);
  const own = one.perspectives!.a.entities[0];
  expect(own).toBe(one.entities[0]); // the owner sees the overview's view
  expect(two.entities[0]).toBe(one.entities[0]); // unchanged between ticks
  expect(two.perspectives!.b.entities[0]).toBe(one.perspectives!.b.entities[0]); // an opponent's view is kept apart
  expect(three.entities[0]).not.toBe(one.entities[0]);
  expect(three.entities[0].stats).toBe(one.entities[0].stats);
  expect(two.perspectives!.a.visibility[0]).toBe(one.perspectives!.a.visibility[0]);
});
