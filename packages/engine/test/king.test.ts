import { expect, it } from 'vitest';
import { v7, v8, MAPS, mapsForRuleset, playerGuide, viewToText, type ReplayFile } from '@aoa/shared';
import { createMatch, runReplay } from '../src/index';

it('uses king in every current map, rules and state while keeping v7 maps intact', async () => {
  expect(v8.kinds.agent).toBeUndefined();
  expect(v8.kinds.king).toMatchObject({ hp: 400, def: 10, vital: true, moveMs: 500 });
  expect(v8.kinds.king.atk).toBeUndefined();
  expect(playerGuide(v8)).toContain('Only the King is vital');
  expect(playerGuide(v8)).not.toMatch(/\bagent\b/i);
  for (const map of Object.values(MAPS)) {
    expect(map.start.some(e => e.kind === 'king')).toBe(true);
    const m = await createMatch({ ruleset: { ...v8, map }, seed: 42, tickRate: 10, players: [{id:'a',name:'A'},{id:'b',name:'B'}] });
    try {
      expect(m.view('a').mine.filter(e => e.kind === 'king')).toHaveLength(1);
      expect(viewToText(m.view('a'))).toContain('king');
    } finally { m.dispose(); }
  }
  expect(v7.map.start.some(e => e.kind === 'agent')).toBe(true);
  expect(mapsForRuleset(v7)['fortress-quad'].start.some(e => e.kind === 'agent')).toBe(true);
});

it('ends on king death and deterministically replays the new kind', async () => {
  const ruleset = { ...v8, fogOfWar: undefined, map: { ...v8.map, width: 8, height: 8, walls: [], deposits: [], sharedDeposits: [],
    start: [{kind:'king',x:3,y:3},{kind:'knight',x:3,y:4}] },
    kinds: { ...v8.kinds, knight: { ...v8.kinds.knight, atk: 500 } }, defaultScripts: {} };
  const players = [{id:'a',name:'A'},{id:'b',name:'B'}];
  const m = await createMatch({ruleset, players, seed: 1, tickRate:10});
  try {
    const unit = m.view('a').mine.find(e => e.kind === 'knight')!.id;
    const target = m.view('b').mine.find(e => e.kind === 'king')!.id;
    const order = {type:'attack' as const, unit, target};
    m.step([{player:'a',order}]);
    expect(m.outcome).toMatchObject({winner:'a',reason:'vital_lost'});
    const replay: ReplayFile = {format:1,id:'king-test',createdAt:new Date(0).toISOString(),ruleset,players,seed:1,tickRate:10,
      orders:[{tick:0,player:'a',order}],hashes: {0:m.hash(),1:m.hash()},finalTick:m.tick,outcome:m.outcome!};
    expect((await runReplay(replay,()=>{})).verified).toBe(true);
  } finally {m.dispose();}
});
