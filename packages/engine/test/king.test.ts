import { expect, it } from 'vitest';
import { rules, MAPS, playerGuide, viewToText, type ReplayFile } from '@aoa/shared';
import { createMatch, runReplay } from '../src/index';

it('uses king in every map, the rules and state', async () => {
  expect(rules.kinds.agent).toBeUndefined();
  expect(rules.kinds.king).toMatchObject({ hp: 400, def: 10, vital: true, moveMs: 500 });
  expect(playerGuide(rules)).toContain('Only the King is vital');
  expect(playerGuide(rules)).not.toMatch(/\bagent\b/i);
  for (const map of Object.values(MAPS)) {
    expect(map.start.some(e => e.kind === 'king')).toBe(true);
    const m = await createMatch({ ruleset: { ...rules, map }, seed: 42, tickRate: 10, players: [{id:'a',name:'A'},{id:'b',name:'B'}] });
    try {
      expect(m.view('a').mine.filter(e => e.kind === 'king')).toHaveLength(1);
      expect(viewToText(m.view('a'))).toContain('king');
    } finally { m.dispose(); }
  }
  expect(rules.map.start.some(e => e.kind === 'king')).toBe(true);
  expect(MAPS['fortress-quad'].start.some(e => e.kind === 'king')).toBe(true);
});

it('ends on king death and deterministically replays the new kind', async () => {
  const ruleset = { ...rules, map: { ...rules.map, width: 8, height: 8, walls: [], deposits: [], sharedDeposits: [],
    start: [{kind:'king',x:3,y:3},{kind:'knight',x:3,y:4}] },
    kinds: { ...rules.kinds, knight: { ...rules.kinds.knight, atk: 500 } }, defaultScripts: {} };
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
