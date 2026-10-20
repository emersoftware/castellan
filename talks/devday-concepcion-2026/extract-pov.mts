import {readFileSync,writeFileSync} from 'node:fs';
import {createMatch} from '../../packages/engine/src/index';
const replay = JSON.parse(readFileSync(new URL('../../packages/web/public/showcase/02eb6795.json',import.meta.url),'utf8'));
const match = await createMatch({ruleset:replay.ruleset,seed:replay.seed,tickRate:replay.tickRate,players:replay.players});
const orders = new Map();
for(const order of replay.orders) {const list=orders.get(order.tick)??[];list.push({player:order.player,order:order.order});orders.set(order.tick,list);}
const hashes = [];
try {
  while(match.tick<1743) {
    const tick=match.tick;match.step(orders.get(tick)??[]);
    if(replay.hashes[tick]!==undefined) {
      if(replay.hashes[tick]!==match.hash()) throw new Error(`Replay diverged at ${tick}`);
      hashes.push(tick);
    }
  }
  const frame=match.spectate(undefined,{includePerspectives:true,includePrivateChat:true});
  writeFileSync(new URL('./assets/pov-frame.json',import.meta.url),JSON.stringify({id:replay.id,tick:match.tick,verifiedHashes:hashes,frame}));
  console.log(JSON.stringify({tick:frame.tick,entities:frame.entities.length,p1:frame.perspectives.p1.entities.length,p2:frame.perspectives.p2.entities.length,verifiedHashes:hashes}));
}finally{match.dispose();}
