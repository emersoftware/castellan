import { afterEach, expect, it } from 'vitest';
import { rules, playerGuide, type Ruleset } from '@castellan/shared';
import { createMatch, runReplay, type Match } from '../src';
const live: Match[] = [];
afterEach(() => live.splice(0).forEach(m => m.dispose()));
const players = [{ id:'a', name:'A' }, { id:'b', name:'B' }];
async function setup(patch: Partial<Ruleset> = {}) {
  const ruleset: Ruleset = { ...rules, matchMs:60000,
    map:{...rules.map, width:12,height:12,walls:[],sharedDeposits:[],
      deposits:[{x:3,y:2,amount:200}],start:[{kind:'king',x:0,y:0},{kind:'castle',x:1,y:1},{kind:'worker',x:2,y:2}]},
    defaultScripts:{...rules.defaultScripts,castle:'self.hold();'},...patch };
  const m = await createMatch({ruleset,players,seed:42,tickRate:10}); live.push(m);return m;
}
const entity = (m:Match,owner:string,kind:string) => m.view(owner).mine.find(e=>e.kind===kind)!;
const step = (m:Match,n:number) => Array.from({length:n},()=>m.step([])).flatMap(s=>s.events);
it('mines, unloads and resumes with the default worker script and no permanent order',async()=>{
 const m=await setup();const worker=entity(m,'a','worker');
 expect(worker.order).toBeUndefined();
 const events=step(m,50);
 expect(events.some(e=>e.type==='unload')).toBe(true);
 expect(m.view('a').players.find(p=>p.id==='a')!.mineral).toBeGreaterThan(rules.startMineral);
 expect(entity(m,'a','worker').doing).toContain('gather');
 expect(entity(m,'a','worker').gathering).toEqual({x:3,y:2});
});
it('lets scripts unload early and manual orders override them until stopped',async()=>{
 const m=await setup();const w=entity(m,'a','worker');
 m.step([{player:'a',order:{type:'script',kind:'worker',code:'if (self.carrying >= 2) self.unload(); else self.gather(self.nearestDeposit());'}}]);
 step(m,12);expect(m.view('a').players.find(p=>p.id==='a')!.mineral).toBeGreaterThan(rules.startMineral);
 m.step([{player:'a',order:{type:'script',kind:'worker',code:'self.hold();'}},{player:'a',order:{type:'gather',unit:w.id}}]);
 expect(entity(m,'a','worker').doing).toContain('gather');
 m.step([{player:'a',order:{type:'stop',unit:w.id}}]);
 expect(entity(m,'a','worker').doing).toBe('hold');
 expect(entity(m,'a','worker').gathering).toBeUndefined();
});
it('keeps mining under attack by default, but can react on the next tick using a script',async()=>{
 const m=await setup({map:{...rules.map,width:7,height:7,walls:[],sharedDeposits:[],deposits:[{x:2,y:3,amount:100}],start:[{kind:'king',x:0,y:0},{kind:'worker',x:2,y:2}]}});
 const w=entity(m,'a','worker'), enemy=entity(m,'b','worker');
 step(m,5);
 m.step([{player:'b',order:{type:'attack',unit:enemy.id,target:w.id}}]);
 for(let i=0;i<30 && entity(m,'a','worker').hp===w.hp;i++)m.step([]);
 expect(entity(m,'a','worker').hp).toBeLessThan(w.hp);
 expect(entity(m,'a','worker').doing).toContain('gather');
 const before=entity(m,'a','worker');
 m.step([{player:'a',order:{type:'script',kind:'worker',code:'const enemy=self.lastAttacker(); if(enemy) self.flee(enemy); else self.gather();'}}]);
 expect(entity(m,'a','worker').doing).not.toContain('gather');
 step(m,5);expect(entity(m,'a','worker')).not.toMatchObject({x:before.x,y:before.y});
});
it('gives the King weak melee, retaliates in range, and never pursues by default',async()=>{
 const m=await setup({map:{...rules.map,width:6,height:6,walls:[],deposits:[],sharedDeposits:[],start:[{kind:'king',x:2,y:2}]}});
 const a=entity(m,'a','king'),b=entity(m,'b','king');
 expect(a.stats).toMatchObject({atk:3,range:1,attackMs:3000});
 expect(m.step([]).events.filter(e=>e.type==='attack')).toHaveLength(0);
 m.step([{player:'b',order:{type:'attack',unit:b.id,target:a.id}}]);
 expect(m.step([]).events).toContainEqual(expect.objectContaining({type:'attack',from:a.id,to:b.id,dmg:1}));
 m.step([{player:'b',order:{type:'move',unit:b.id,x:5,y:5}}]);
 step(m,40);expect(entity(m,'a','king')).toMatchObject({x:a.x,y:a.y});
});

it('records projectile damage at impact and replays reactive scripts deterministically',async()=>{
 const m=await setup({matchMs:5000,map:{...rules.map,width:9,height:9,walls:[],deposits:[],sharedDeposits:[],start:[{kind:'king',x:0,y:0},{kind:'archer',x:2,y:4}]},defaultScripts:{...rules.defaultScripts,archer:'self.log(String(self.lastAttackedTick)); self.hold();'}});
 const a=entity(m,'a','archer'),b=entity(m,'b','archer');
 const order={type:'attack' as const,unit:a.id,target:b.id};
 const hashes:Record<number,string>={};
 const first=m.step([{player:'a',order}]);hashes[0]=m.hash();
 expect(first.events).not.toContainEqual(expect.objectContaining({type:'projectile_end'}));
 expect(m.spectate().projectiles![0]).not.toHaveProperty('source');
 let impactTick:number|undefined;
 let observedImpact=false;
 while(!m.outcome){
  const tick=m.tick;const result=m.step([]);hashes[tick]=m.hash();
  const observed=result.events.find(e=>e.type==='log'&&e.unit===b.id);
  if(impactTick===undefined) expect(observed).toMatchObject({message:'null'});
  else if(tick===impactTick+1) {expect(observed).toMatchObject({message:String(impactTick)});observedImpact=true;}
  if(result.events.some(e=>e.type==='projectile_end'&&e.target===b.id)&&impactTick===undefined)impactTick=tick;
 }
 expect(impactTick).toBeGreaterThan(0);
 expect(observedImpact).toBe(true);
 const replay={format:1 as const,id:'reactive',createdAt:new Date(0).toISOString(),ruleset:m.ruleset,players,seed:42,tickRate:10,orders:[{tick:0,player:'a',order}],hashes,finalTick:m.tick,outcome:m.outcome!};
 expect((await runReplay(replay,()=>{})).verified).toBe(true);
});

it('reveals only known resources to scripts and rejects a guessed hidden deposit',async()=>{
 const m=await setup({map:{...rules.map,width:20,height:20,walls:[],sharedDeposits:[],deposits:[{x:3,y:2,amount:100}],start:[{kind:'king',x:0,y:0},{kind:'worker',x:2,y:2}]}});
 const hidden=m.spectate().deposits.find(d=>d.x>10)!;
 const visible=m.view('a').deposits;
 const output=m.step([{player:'a',order:{type:'script',kind:'worker',code:`self.log(JSON.stringify(self.deposits())); self.gather(${JSON.stringify(hidden.id)});`}}]);
 const log=output.events.find(e=>e.type==='log'&&e.owner==='a');
 expect(log?.type==='log'&&JSON.parse(log.message)).toEqual(visible);
 expect(entity(m,'a','worker').doing).toBe('hold');
});
it('returns completed builders and newly trained workers to their current script',async()=>{
 const m=await setup();const worker=entity(m,'a','worker');const castle=entity(m,'a','castle');
 const result=m.step([{player:'a',order:{type:'script',kind:'worker',code:'self.hold();'}},{player:'a',order:{type:'build',unit:worker.id,kind:'wall',x:2,y:3}},{player:'a',order:{type:'train',building:castle.id,kind:'worker'}}]);
 expect(result.results.every(r=>r.ok)).toBe(true);
 step(m,52);
 const workers=m.view('a').mine.filter(e=>e.kind==='worker');
 expect(workers).toHaveLength(2);
 for(const w of workers){expect(w.order).toBeUndefined();expect(w.doing).toBe('hold');}
});
