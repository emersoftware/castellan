/** Local visual-review replay. Uses an isolated map and passive defenders, not live balance edits.
 * pnpm --filter @aoa/server exec tsx src/castle-animation-demo.ts
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createMatch, runReplay, type PlayerOrder } from '@aoa/engine';
import { HOLD_SCRIPT, replayArchive, rules, type ReplayFile, type Ruleset } from '@aoa/shared';
import { saveReplay } from './app';

const root=resolve(fileURLToPath(import.meta.url),'../../../..');
const demo:Ruleset={...structuredClone(rules),version:`${rules.version}-castle-animation-demo`,matchMs:85000,
  defaultScripts:Object.fromEntries(Object.keys(rules.defaultScripts).map(kind=>[kind,HOLD_SCRIPT])),
  map:{name:'castle-animation-demo',description:'Local castle damage, fire and inward-collapse review',width:16,height:16,seats:2,
    walls:[],deposits:[],sharedDeposits:[],start:[{kind:'castle',x:4,y:6},{kind:'king',x:2,y:3},{kind:'knight',x:10,y:9}]}};
const players=[{id:'p1',name:'demo:Castillo azul',side:0},{id:'p2',name:'demo:Castillo rojo',side:1}];
const config={ruleset:demo,players,seed:93,tickRate:10};
const match=await createMatch(config);
const orders:ReplayFile['orders']=[],hashes:Record<number,string>={},milestones:Record<string,Record<string,number>>={};
const initial=match.spectate().entities;
const attackers=initial.filter(e=>e.kind==='knight');
const castles=initial.filter(e=>e.kind==='castle');
try {
  while(!match.outcome) {
    const tick=match.tick;
    const input:PlayerOrder[]=tick===30?attackers.map(a=>({player:a.owner,order:{type:'attack',unit:a.id,target:castles.find(c=>c.owner!==a.owner)!.id}})):[];
    orders.push(...input.map(o=>({tick,...o})));
    const result=match.step(input);
    if(result.results.some(r=>!r.ok))throw new Error(JSON.stringify(result.results));
    if(tick%100===0)hashes[tick]=match.hash();
    const frame=match.spectate();
    for(const c of castles) {
      const e=frame.entities.find(e=>e.id===c.id);
      const marks=milestones[c.id]??(milestones[c.id]={});
      for(const [label,limit] of [['mild',.75],['fire',.5],['intermediate',.25]] as const)
        if(e&&e.hp/e.maxHp<=limit&&marks[label]===undefined)marks[label]=frame.timeMs/1000;
      if(!e&&marks.collapse===undefined)marks.collapse=frame.timeMs/1000;
    }
  }
  if(castles.some(c=>Object.keys(milestones[c.id]??{}).length!==4))throw new Error('Demo did not show all castle phases.');
  hashes[match.tick]=match.hash();
  const replay:ReplayFile={format:1,id:`castle-${randomBytes(4).toString('hex')}`,createdAt:new Date().toISOString(),...config,
    orders,hashes,finalTick:match.tick,outcome:match.outcome!};
  const check=await runReplay(replay,()=>{});
  if(!check.verified)throw new Error(`Replay desync at ${check.desyncAt}`);
  await saveReplay(resolve(process.env.REPLAY_DIR??resolve(root,replayArchive.local)),replay);
  console.log(JSON.stringify({id:replay.id,verified:check.verified,duration:replay.finalTick/10,milestones},null,2));
}finally{match.dispose();}
