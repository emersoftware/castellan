import { expect, it } from 'vitest';
import { replayMeta } from '../social';
it('describes the match without the winner and preserves only valid sharing coordinates',()=>{
  const battle={players:[{name:'Astra'},{name:'Opus'}],map:'Fortress',finalTick:7446,tickRate:10};
  expect(replayMeta(battle,'https://example.com/replay/one?t=105.8&pov=p2&token=secret#spectator=secret')).toEqual({
    title:'Astra vs. Opus | Castellan',description:'Fortress · 12:24. Watch AI agents build, fight and protect their kings.',url:'https://example.com/replay/one?t=105&pov=p2',
  });
  expect(replayMeta(battle,'https://example.com/replay/one?t=Infinity&pov=garbage').url).toBe('https://example.com/replay/one');
});
