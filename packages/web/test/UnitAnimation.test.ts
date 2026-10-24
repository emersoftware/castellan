// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { rules, type EntityView } from '@castellan/shared';
import { fall, strikeMs, unitLook, type Strike } from '../src/render/look';
import { TILE_H, TILE_W } from '../src/render/sprites';
import { createField, frameAt } from './support/battlefield';
import workerAtlas from '../../../assets/sprites/worker/manifest.json';
import kingAtlas from '../../../assets/sprites/king/manifest.json';
import atlas from '../../../assets/sprites/knight/manifest.json';
import * as look from '../src/render/look';
/** A unit standing (`walked` undefined) or walking. */
const unitAnimation = (kind: string, timeMs: number, walked?: number, strike?: Strike) => unitLook({ kind, x: 0, y: 0 }, strike?.dir ?? 2, timeMs, { walked, strike }).animation;
const MELEE_RECOVERY_MS = strikeMs('knight')!;
it.each([0,1,2,3,4,5,6,7])('starts knight direction %i at contact and returns to locomotion',dir=>{
  const row=[0,1,2,3,4,3,2,1][dir];
  expect(unitAnimation('knight',1000,0,{at:1000,dir})).toEqual({action:'attack',frame:atlas.attack.impactFrames[row]});
  expect(unitAnimation('knight',1399,undefined,{at:1000,dir})?.frame).toBe(27);
  expect(unitAnimation('knight',1000+MELEE_RECOVERY_MS,0,{at:1000,dir})?.action).toBe('walk');
  expect(unitAnimation('king',1000)?.action).toBe('idle');
});

function setup(kind:string,ruleset:typeof rules={...rules,diagonalMove:1}){
  const h=createField({ruleset,colors:{a:0,b:1}}); // default: diagonal at straight speed
  const unit:EntityView={id:'u',kind,owner:'a',x:4,y:4,hp:100,maxHp:100};
  const target:EntityView={...unit,id:'t',kind:kind==='worker'?'knight':'worker',owner:'b',x:3,y:5};
  const frame=(tick:number,entities=[unit,target])=>frameAt(tick,entities);
  const lastOf=(drawn:string)=>h.sprites.mock.calls.filter(c=>c[0]===drawn).at(-1)!;
  return {...h,unit,target,frame,lastOf,last:()=>lastOf(kind)};
}
it.each(['knight','king','wizard','worker'])('keeps %s walking between tile updates and freezes on pause',kind=>{
  const h=setup(kind);h.field.show(h.frame(1),100);
  const moved={...h.unit,x:5,stats:{atk:0,def:10,range:0,attackMs:1000,moveMs:500}};
  for(let tick=2;tick<=6;tick++){
    h.time(1000+(tick-2)*100);h.field.show(h.frame(tick,[moved,h.target]),100);h.animate();
    expect(h.last()[2]?.action).toBe('walk');
  }
  h.clock.pause();const before=h.last()[2];h.time(9000);h.animate();expect(h.last()[2]).toEqual(before);
  h.clock.resume();h.field.show(h.frame(7,[moved,h.target]),100);h.animate();expect(h.last()[2]?.action).toBe('idle');
  h.field.seek(h.frame(1),100);h.animate();expect(h.last()[2]?.action).toBe('idle');
});

it.each(['archer','knight','king','wizard','worker'])('ties %s foot motion to traveled distance rather than elapsed time',kind=>{
  const sample=(moveMs:number,ticks:number,diagonal=false)=>{
    const h=setup(kind);h.field.show(h.frame(1),100);
    const moved={...h.unit,x:5,y:diagonal?5:4,stats:{atk:0,def:0,range:0,attackMs:1000,moveMs}};
    h.field.show(h.frame(2,[moved,h.target]),100);
    for(let step=1;step<=ticks;step++){
      h.time(1000+step*100);h.field.show(h.frame(2+step,[moved,h.target]),100);
    }
    h.animate();return h.last()[2];
  };
  expect(sample(200,1)).toEqual(sample(400,2)); // half a tile at either speed
  expect(sample(200,1)).toEqual({action:'walk',frame:kind==='archer'?14:7});
  expect(sample(400,2,true)).toEqual(sample(400,2)); // a diagonal step keeps the orthogonal cadence
});
it.each([false,true])('faces the melee target immediately, including lethal hits (dead=%s)',dead=>{
  const h=setup('knight');h.field.show(h.frame(1),100);
  h.field.show({...h.frame(2,dead?[h.unit]:[h.unit,h.target]),events:[
    {tick:1,type:'attack',from:'u',to:'t',dmg:12},
    ...(dead?[{tick:1,type:'death' as const,id:'t',kind:'worker',owner:'b',x:3,y:5}]:[]),
  ]},100);h.animate();
  expect(h.last().slice(1)).toEqual([6,{action:'attack',frame:atlas.attack.impactFrames[2]}]);
  h.time(1100);h.field.show(h.frame(3,[{...h.unit,x:5,y:3}]),100);h.animate();
  expect(h.last()[1]).toBe(6); // target direction stays locked despite movement
  // A seek discards the strike: reaching the contact tick again shows no attack.
  h.field.seek(h.frame(1),100);h.field.show(h.frame(2,[h.unit]),100);h.animate();
  expect(h.last()[2]?.action).toBe('idle');
});

it.each([50,100,200])('keeps a diagonal melee approach at constant speed with %i ms replay ticks',tickMs=>{
  // d61d3345 at 6:50: e59 steps (17,26) -> (16,27), then hits e3 at
  // (16,28) one tick later. The step takes 700 ms; the hit must not rush it.
  const h=setup('knight',{...rules,diagonalMove:1.4});
  const unit={...h.unit,x:17,y:26,stats:{atk:14,def:6,range:1,attackMs:1000,moveMs:500}};
  const target={...h.target,x:16,y:28};
  const moved={...unit,x:16,y:27};
  h.field.show(h.frame(4099,[unit,target]),tickMs);
  h.field.show(h.frame(4100,[moved,target]),tickMs);
  const sprite=h.sprite('u');
  for(let step=0;step<=7;step++){
    h.time(1000+step*tickMs);
    h.field.show({...h.frame(4100+step,[moved,target]),events:step===1?
      [{tick:4100,type:'attack',from:'u',to:'t',dmg:4}]:[]},tickMs);
    h.animate();
    expect(sprite.x).toBeCloseTo((17-26-2*step/7)*TILE_W/2);
    expect(sprite.y).toBeCloseTo((17+26)*TILE_H/2+3);
    if(step>=1&&step<5)expect(h.last().slice(1)).toEqual([7,unitAnimation('knight',(4100+step)*100,0,{at:410100,dir:7})]);
    if(step===5||step===6){
      expect(h.last()[2]?.action).toBe('walk');
      expect(h.last()[1]).toBe(6); // resume facing along the step, not toward the target
    }
  }
});

it('freezes a melee approach on pause and discards it on seek',()=>{
  const h=setup('knight',{...rules,diagonalMove:1.4});
  h.field.show(h.frame(1),100);
  const moved={...h.unit,x:3,y:5,stats:{atk:14,def:6,range:1,attackMs:1000,moveMs:500}};
  const target={...h.target,x:2,y:5};
  h.field.show(h.frame(2,[moved,target]),100);
  h.time(1100);
  h.field.show({...h.frame(3,[moved,target]),events:[{tick:2,type:'attack',from:'u',to:'t',dmg:4}]},100);
  h.time(1150);h.animate();
  const sprite=h.sprite('u');
  const before={x:sprite.x,y:sprite.y,animation:h.last()[2]};
  h.clock.pause();h.time(5000);h.animate();
  expect({x:sprite.x,y:sprite.y,animation:h.last()[2]}).toEqual(before);
  h.clock.resume();
  h.field.seek(h.frame(1),100);h.animate();
  expect(sprite.x).toBe(0);
  expect(sprite.y).toBe(4*TILE_H+3);
  expect(h.last()[2]?.action).toBe('idle');
  // Back at the contact tick without its event, the knight walks instead of striking.
  h.field.show(h.frame(3,[moved,target]),100);h.animate();
  expect(h.last()[2]?.action).toBe('walk');
});
it('keeps the existing melee lunge when an attack atlas has not been published',()=>{
  const available=vi.spyOn(look,'strikeMs').mockReturnValue(undefined);
  try {
    const h=setup('knight');h.field.show(h.frame(1),100);
    h.field.show({...h.frame(2),events:[{tick:1,type:'attack',from:'u',to:'t',dmg:12}]},100);
    h.animate();
    expect(h.last()[2]?.action).toBe('idle');
    // The lunge toward the target (west of the knight) lasts 140 ms, then it stands back on its tile.
    h.time(1070);h.animate();expect(h.sprite('u').x).toBeCloseTo(-2.5);
    h.time(1140);h.animate();expect(h.sprite('u').x).toBe(0);
  } finally {available.mockRestore();}
});

/** Tile offsets that face screen directions 0..7 (see the mineral-facing table below). */
const TOWARD=[[1,1],[1,0],[1,-1],[0,-1],[-1,-1],[-1,0],[-1,1],[0,1]];
it.each(['archer','knight','king','wizard','worker'].flatMap(kind=>[0,1,2,3,4,5,6,7].map(dir=>({kind,dir}))))('plays $kind death once in direction $dir, freezes on pause and retains the corpse',({kind,dir})=>{
  const h=setup(kind);
  // A unit faces the way of its last blow.
  const [dx,dy]=TOWARD[dir];const target={...h.target,x:4+dx,y:4+dy};
  h.field.show(h.frame(1,[h.unit,target]),100);
  h.field.show({...h.frame(2,[h.unit,target]),events:[{tick:1,type:'attack',from:'u',to:'t',dmg:1}]},100);
  const sprite=h.sprite('u');
  h.field.show({...h.frame(3,[target]),events:[{tick:2,type:'death',id:'u',kind,owner:'a',x:4,y:4}]},100);
  h.animate();
  expect(h.last().slice(1)).toEqual([dir,{action:'death',frame:0}]);
  expect(sprite.rotation).toBe(0);
  h.time(2000);h.animate();expect(h.last()[2]).toEqual({action:'death',frame:12});
  h.clock.pause();h.time(9000);h.animate();expect(h.last()[2]?.frame).toBe(12);
  h.clock.resume();h.time(10500);h.animate();expect(h.last()[2]?.frame).toBe(27);
  expect(sprite.destroyed).toBe(false);
  h.time(15000);h.animate();expect(sprite.destroyed).toBe(true);
});

it('holds the death endpoint and preserves static fallback for unsupported units',()=>{
  expect(fall({kind:'archer',hp:0,maxHp:40},rules.kinds.archer).at(100_000).animation).toEqual({action:'death',frame:27});
  expect(fall({kind:'wall',hp:0,maxHp:40},rules.kinds.knight).at(1000).animation).toBeUndefined();
});

it('scales the fall with replay speed and completes after the final snapshot',()=>{
  const h=setup('archer');h.field.show(h.frame(1),200);
  h.field.show({...h.frame(2,[h.target]),events:[{tick:1,type:'death',id:'u',kind:'archer',owner:'a',x:4,y:4}]},200);
  h.animate();
  h.time(2000);h.animate();expect(h.last()[2]?.frame).toBe(6); // 0.5x
  h.field.show(h.frame(3,[h.target]),50); // switch to 2x
  h.time(2250);h.animate();expect(h.last()[2]?.frame).toBe(12);
  h.time(3250);h.animate();expect(h.last()[2]?.frame).toBe(27); // no more snapshots
});

it('removes the old corpse when seeking back to a living unit',()=>{
  const h=setup('archer');h.field.show(h.frame(1),100);
  const oldSprite=h.sprite('u');
  h.field.show({...h.frame(2,[h.target]),events:[{tick:1,type:'death',id:'u',kind:'archer',owner:'a',x:4,y:4}]},100);
  h.animate();expect(oldSprite.destroyed).toBe(false);
  h.field.seek(h.frame(1),100);h.animate();
  expect(oldSprite.destroyed).toBe(true);
  expect(h.sprite('u').destroyed).toBe(false);
  expect(h.last()[2]?.action).toBe('idle');
});

it('loops Worker idle and uses distance for walking',()=>{
 expect(unitAnimation('worker',0)).toEqual({action:'idle',frame:0});
 expect(unitAnimation('worker',1000)).toEqual({action:'idle',frame:12});
 expect(unitAnimation('worker',2500)).toEqual({action:'idle',frame:2});
 expect(unitAnimation('worker',10000,.5)).toEqual({action:'walk',frame:7});
});

it.each([[1,1,0],[1,0,1],[1,-1,2],[0,-1,3],[-1,-1,4],[-1,0,5],[-1,1,6],[0,1,7]])('faces the mineral at offset %i,%i in screen direction %i', (dx,dy,dir)=>{
 const h=setup('worker');
 const unit={...h.unit,gathering:{x:4+dx,y:4+dy}};
 h.field.show(h.frame(1,[unit]),100);h.animate();
 expect(h.last()[1]).toBe(dir);expect(h.last()[2]?.action).toBe('mine');
 const moved={...unit,x:5,stats:{atk:3,def:1,range:1,attackMs:1000,moveMs:500}};
 h.field.show(h.frame(2,[moved]),100);h.animate();
 expect(h.last()[2]?.action).toBe('walk');
});

it.each([0,1,2,3,4,5,6,7])('starts Worker melee direction %i at the actual contact pose',dir=>{
 const row=[0,1,2,3,4,3,2,1][dir];
 expect(unitAnimation('worker',1000,0,{at:1000,dir})).toEqual({action:'attack',frame:workerAtlas.attack.impactFrames[row]});
 expect(unitAnimation('worker',1400,undefined,{at:1000,dir})?.action).toBe('idle');
});
it('locks a Worker melee hit to the target instead of the mineral or movement',()=>{
 const h=setup('worker');h.field.show(h.frame(1),100);
 const mining={...h.unit,gathering:{x:5,y:5}};
 h.field.show({...h.frame(2,[mining,h.target]),events:[{tick:1,type:'attack',from:'u',to:'t',dmg:3}]},100);h.animate();
 expect(h.last().slice(1)).toEqual([6,{action:'attack',frame:workerAtlas.attack.impactFrames[2]}]);
});
it('freezes mining on pause and stops mining when work ends',()=>{
 const h=setup('worker');const unit={...h.unit,gathering:{x:5,y:5}};
 h.field.show(h.frame(10,[unit]),100);h.animate();
 expect(h.last()[2]?.action).toBe('mine');
 h.clock.pause();const before=h.last()[2];h.time(5000);h.animate();expect(h.last()[2]).toEqual(before);
 h.clock.resume();h.field.show(h.frame(11,[h.unit]),100);h.animate();expect(h.last()[2]?.action).toBe('idle');
});

it.each([0,1,2,3,4,5,6,7])('starts King melee direction %i at contact and resumes idle',dir=>{
 const row=[0,1,2,3,4,3,2,1][dir];
 expect(unitAnimation('king',1000,0,{at:1000,dir})).toEqual({action:'attack',frame:kingAtlas.attack.impactFrames[row]});
 expect(unitAnimation('king',1400,undefined,{at:1000,dir})?.action).toBe('idle');
});
it('faces the King toward his attacker and freezes the strike on pause',()=>{
 const h=setup('king');h.field.show(h.frame(1),100);
 h.field.show({...h.frame(2),events:[{tick:1,type:'attack',from:'u',to:'t',dmg:1}]},100);h.animate();
 expect(h.last().slice(1)).toEqual([6,{action:'attack',frame:kingAtlas.attack.impactFrames[2]}]);
 h.clock.pause();const before=h.last();h.time(5000);h.animate();expect(h.last()).toEqual(before);
});

it('times a diagonal step like the engine: diagonalMove times a straight one',()=>{
  // A tick (100 ms) into a step, the sprite has covered that share of the step's duration.
  const covered=(x:number,y:number)=>{
    const h=setup('knight',rules);h.field.show(h.frame(1),100);
    h.field.show(h.frame(2,[{...h.unit,x,y,stats:{atk:0,def:0,range:0,attackMs:1000,moveMs:500}},h.target]),100);
    h.time(1100);h.animate();return h.sprite('u');
  };
  expect(covered(5,4).x).toBeCloseTo(TILE_W/2*100/500);
  const diagonalMs=Math.round(500*rules.diagonalMove/100)*100;
  expect(covered(5,5).y).toBeCloseTo((8+2*100/diagonalMs)*TILE_H/2+3);
});

it('places an enemy sighted again where it is, not walking from where it was last seen',()=>{
  const h=setup('knight');h.field.show(h.frame(1,[h.target]),100);
  h.field.show(h.frame(2,[{...h.target,lastSeenMs:100}]),100);
  h.time(1050);h.field.show(h.frame(3,[{...h.target,x:12,y:9}]),100);h.animate();
  expect(h.sprite('t').x).toBe((12-9)*TILE_W/2);
  expect(h.sprite('t').y).toBe((12+9)*TILE_H/2+3);
  expect(h.lastOf('worker')[2]?.action).toBe('idle');
});
