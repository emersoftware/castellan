import { expect, it } from 'vitest';
import { replayMeta } from '../social';
it('describes the match without the winner and preserves only valid sharing coordinates',()=>{
  const battle={players:[{name:'Astra'},{name:'Opus'}],map:'Fortress',finalTick:7446,tickRate:10};
  expect(replayMeta(battle,'https://example.com/replay/one?t=105.8&pov=p2&token=secret#spectator=secret')).toEqual({
    title:'Astra vs. Opus | Castellan',description:'Fortress · 12:24. Watch AI agents build, fight and protect their kings.',url:'https://example.com/replay/one?t=105&pov=p2',
  });
  expect(replayMeta(battle,'https://example.com/replay/one?t=Infinity&pov=garbage').url).toBe('https://example.com/replay/one');
});
it('names teams together and links the published picture by its hash',()=>{
  const battle={players:[{name:'Terra low',team:0},{name:'Terra max',team:0},{name:'Sol low',team:1},{name:'Sol max',team:1}],map:'quad',finalTick:5174,tickRate:10};
  const meta=replayMeta(battle,'https://example.com/replay/c5ffec7f?t=12','0123456789abcdef0123');
  expect(meta.title).toBe('Terra low & Terra max vs. Sol low & Sol max | Castellan');
  expect(meta.image).toBe('https://example.com/og/c5ffec7f.png?v=0123456789abcdef');
  expect(replayMeta(battle,'https://example.com/replay/c5ffec7f')).not.toHaveProperty('image');
});
