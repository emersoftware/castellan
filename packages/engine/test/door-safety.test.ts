import { afterEach, expect, it } from 'vitest';
import { v14, v15, type Ruleset } from '@aoa/shared';
import { createMatch, type Match } from '../src';

const matches: Match[] = [];
afterEach(() => { for(const m of matches.splice(0)) m.dispose(); });
async function setup(base: Ruleset = v15) {
 const ruleset: Ruleset = { ...base, fogOfWar: undefined, buildExclusion: 0, startCapital: 5000,
   defaultScripts: Object.fromEntries(Object.keys(base.kinds).map(k=>[k,'self.hold();'])),
   map: {name:'door-safety',description:'',width:12,height:12,start:[{kind:'king',x:0,y:0}],walls:[],deposits:[],sharedDeposits:[]} };
 const m=await createMatch({ruleset,players:[{id:'a',name:'A'},{id:'b',name:'B'}],seed:1,tickRate:10});matches.push(m);
 const internal=m as unknown as {spawn(kind:string,owner:string,x:number,y:number):{id:string;hp:number};};
 return {m,spawn:internal.spawn.bind(internal),ruleset};
}
const step=(m:Match,n=10)=>Array.from({length:n},()=>m.step([]).events).flat();

it('an arrow aimed at a ranger standing in a door hits the ranger',async()=>{
 const {m,spawn}=await setup();
 const door=spawn('door','a',4,4), ranger=spawn('ranger','a',4,3), attacker=spawn('ranger','b',4,7);
 m.step([{player:'a',order:{type:'move',unit:ranger.id,x:4,y:4}}]);
 expect(m.spectate().entities.find(e=>e.id===door.id)?.open).toBe(true);
 m.step([{player:'b',order:{type:'attack',unit:attacker.id,target:ranger.id}}]);
 expect(step(m)).toContainEqual(expect.objectContaining({type:'projectile_end',target:ranger.id,reason:'hit'}));
});
it('rejects a door where the wall turns a corner',async()=>{
 const {m,spawn}=await setup();
 const worker=spawn('worker','a',3,3);spawn('wall','a',3,4);spawn('wall','a',4,3);
 expect(m.step([{player:'a',order:{type:'build',unit:worker.id,kind:'door',x:4,y:4}}]).results[0].ok).toBe(false);
});

it.each([[3,0],[-3,0],[0,3],[0,-3],[3,3],[-3,-3]])('can kill the ranger inside a door from offset %i,%i without damaging the door',async(dx,dy)=>{
 const {m,spawn}=await setup();const door=spawn('door','a',5,5),ranger=spawn('ranger','a',5,4),attacker=spawn('ranger','b',5+dx,5+dy);
 const doorHP=door.hp;
 m.step([{player:'a',order:{type:'move',unit:ranger.id,x:5,y:5}}]);
 m.step([{player:'b',order:{type:'attack',unit:attacker.id,target:ranger.id}}]);
 step(m,65);
 expect(m.spectate().entities.some(e=>e.id===ranger.id)).toBe(false);
 expect(m.spectate().entities.find(e=>e.id===door.id)?.hp).toBe(doorHP);
});
it('still hits the door when explicitly targeting its ID, even with an occupant',async()=>{
 const {m,spawn}=await setup();const door=spawn('door','a',4,4),ranger=spawn('ranger','a',4,3),attacker=spawn('ranger','b',4,7);
 const hp=ranger.hp,doorHP=door.hp;
 m.step([{player:'a',order:{type:'move',unit:ranger.id,x:4,y:4}}]);
 m.step([{player:'b',order:{type:'attack',unit:attacker.id,target:door.id}}]);
 expect(step(m)).toContainEqual(expect.objectContaining({type:'projectile_end',target:door.id,reason:'hit'}));
 expect(m.spectate().entities.find(e=>e.id===ranger.id)?.hp).toBe(hp);
 expect(m.spectate().entities.find(e=>e.id===door.id)!.hp).toBeLessThan(doorHP);
});
it('lets the occupant dodge; its former door does not catch the missed arrow',async()=>{
 const base={...v15,projectiles:{...v15.projectiles!,speed:2},kinds:{...v15.kinds,ranger:{...v15.kinds.ranger,moveMs:100}}};
 const {m,spawn}=await setup(base);const door=spawn('door','a',4,4),ranger=spawn('ranger','a',4,3),attacker=spawn('ranger','b',4,7);
 const hp=ranger.hp,doorHP=door.hp;
 m.step([{player:'a',order:{type:'move',unit:ranger.id,x:4,y:4}}]);
 m.step([{player:'b',order:{type:'attack',unit:attacker.id,target:ranger.id}}]);
 m.step([{player:'a',order:{type:'move',unit:ranger.id,x:3,y:4}},{player:'b',order:{type:'stop',unit:attacker.id}}]);
 expect(step(m,20)).toContainEqual(expect.objectContaining({type:'projectile_end',reason:'miss'}));
 expect(m.spectate().entities.find(e=>e.id===ranger.id)?.hp).toBe(hp);
 expect(m.spectate().entities.find(e=>e.id===door.id)?.hp).toBe(doorHP);
});
it('allows melee to damage a ranger occupying a hostile door',async()=>{
 const {m,spawn}=await setup();const door=spawn('door','a',4,4),ranger=spawn('ranger','a',4,3),attacker=spawn('knight','b',4,5);
 const hp=ranger.hp,doorHP=door.hp;
 m.step([{player:'a',order:{type:'move',unit:ranger.id,x:4,y:4}}]);
 m.step([{player:'b',order:{type:'attack',unit:attacker.id,target:ranger.id}}]);
 expect(m.spectate().entities.find(e=>e.id===ranger.id)!.hp).toBeLessThan(hp);
 expect(m.spectate().entities.find(e=>e.id===door.id)?.hp).toBe(doorHP);
});
it('retains the v14 interception behavior for old replays',async()=>{
 const {m,spawn}=await setup(v14);const door=spawn('door','a',4,4),ranger=spawn('ranger','a',4,3),attacker=spawn('ranger','b',4,7);
 m.step([{player:'a',order:{type:'move',unit:ranger.id,x:4,y:4}}]);
 m.step([{player:'b',order:{type:'attack',unit:attacker.id,target:ranger.id}}]);
 expect(step(m)).toContainEqual(expect.objectContaining({type:'projectile_end',target:door.id,reason:'hit'}));
});

it.each([[1,1],[1,-1],[-1,1],[-1,-1]])('rejects each corner orientation (%i,%i) without charging',async(dx,dy)=>{
 const {m,spawn}=await setup();const worker=spawn('worker','a',2,2);
 spawn('wall','a',5+dx,5);spawn('wall','a',5,5+dy);
 const capital=m.view('a').players.find(p=>p.id==='a')!.capital;
 expect(m.step([{player:'a',order:{type:'build',unit:worker.id,kind:'door',x:5,y:5}}]).results[0]).toMatchObject({ok:false,reason:expect.stringContaining('corners')});
 expect(m.view('a').players.find(p=>p.id==='a')!.capital).toBe(capital);
});
it.each([{neighbors:[[1,0],[-1,0],[0,1]]},{neighbors:[[1,0],[-1,0],[0,1],[0,-1]]}])('rejects junctions with connections $neighbors',async({neighbors})=>{
 const {m,spawn}=await setup();const worker=spawn('worker','a',2,2);
 for(const [dx,dy] of neighbors)spawn('wall','a',5+dx,5+dy);
 expect(m.step([{player:'a',order:{type:'build',unit:worker.id,kind:'door',x:5,y:5}}]).results[0].ok).toBe(false);
});
it.each(['x','y'])('builds a door along the %s wall axis',async(axis)=>{
 const {m,spawn}=await setup();const worker=spawn('worker','a',4,4);
 for(const sign of [-1,1])spawn('wall','a',5+(axis==='x'?sign:0),5+(axis==='y'?sign:0));
 expect(m.step([{player:'a',order:{type:'build',unit:worker.id,kind:'door',x:5,y:5}}]).results[0].ok).toBe(true);
 expect(m.spectate().entities).toContainEqual(expect.objectContaining({kind:'door',x:5,y:5}));
});
it.each(['wall','door'])('rejects adding a %s that turns an existing door into a corner',async(kind)=>{
 const {m,spawn}=await setup();const worker=spawn('worker','a',4,3);
 spawn('door','a',5,5);spawn('wall','a',4,5);
 expect(m.step([{player:'a',order:{type:'build',unit:worker.id,kind,x:5,y:4}}]).results[0].ok).toBe(false);
});
it('includes reserved construction when checking a later perpendicular wall',async()=>{
 const base={...v15,kinds:{...v15.kinds,door:{...v15.kinds.door,buildMs:500}}};
 const {m,spawn}=await setup(base);const a=spawn('worker','a',4,4),b=spawn('worker','a',6,3);spawn('wall','a',4,5);
 expect(m.step([{player:'a',order:{type:'build',unit:a.id,kind:'door',x:5,y:5}}]).events).toContainEqual(expect.objectContaining({type:'construction_started',kind:'door'}));
 expect(m.step([{player:'a',order:{type:'build',unit:b.id,kind:'wall',x:5,y:4}}]).results[0].ok).toBe(false);
 step(m);expect(m.spectate().entities).toContainEqual(expect.objectContaining({kind:'door',x:5,y:5}));
});
it('rechecks an accepted build when its worker arrives after the layout changed',async()=>{
 const {m,spawn}=await setup();const a=spawn('worker','a',1,1),b=spawn('worker','a',7,4);spawn('wall','a',5,6);
 const result=m.step([{player:'a',order:{type:'build',unit:a.id,kind:'door',x:6,y:6}},{player:'a',order:{type:'build',unit:b.id,kind:'wall',x:6,y:5}}]);
 expect(result.results.every(r=>r.ok)).toBe(true);
 expect(step(m,60)).toContainEqual(expect.objectContaining({type:'order_end',id:a.id,reason:expect.stringContaining('corners')}));
 expect(m.spectate().entities.some(e=>e.kind==='door')).toBe(false);
 expect(m.view('a').players.find(p=>p.id==='a')!.capital).toBe(5000-v15.kinds.wall.cost);
});
