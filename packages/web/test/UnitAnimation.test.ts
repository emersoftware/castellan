// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { Texture, type Sprite } from 'pixi.js';
import { v8, type EntityView, type SpectatorView } from '@aoa/shared';
import { GameRenderer } from '../src/render/renderer';
import { unitAnimation, unitDeathAnimation, MELEE_RECOVERY_MS } from '../src/render/unitAnimation';
import { displayKind } from '../src/render/names';
import type { SpriteSet } from '../src/render/sprites';
import workerAtlas from '../public/sprites/worker/manifest.json';
import kingAtlas from '../public/sprites/king/manifest.json';
import atlas from '../public/sprites/knight/manifest.json';
import * as animations from '../src/render/unitAnimation';
it.each([0,1,2,3,4,5,6,7])('starts knight direction %i at contact and returns to locomotion',dir=>{
  const row=[0,1,2,3,4,3,2,1][dir];
  expect(unitAnimation('knight',1000,true,{at:1000,dir})).toEqual({action:'attack',frame:atlas.attack.impactFrames[row]});
  expect(unitAnimation('knight',1399,false,{at:1000,dir})?.frame).toBe(27);
  expect(unitAnimation('knight',1000+MELEE_RECOVERY_MS,true,{at:1000,dir})?.action).toBe('walk');
  expect(unitAnimation('king',1000,false)?.action).toBe('idle');
});

function setup(kind:string){
  let now=1000;
  const renderer=Reflect.construct(GameRenderer,[document.createElement('div'),v8,{a:0,b:1}]) as GameRenderer;
  const internal=renderer as unknown as {now:()=>number;play:()=>void;sprites:SpriteSet;animate():void;
    app:{renderer:{render():void}};drawn:Map<string,{sprite:Sprite;shot?:{at:number;dir:number}}>};
  internal.now=()=>now;internal.play=vi.fn();internal.app={renderer:{render(){}}};
  const sprites=vi.fn<SpriteSet>(()=>({flip:false,art:{texture:Texture.EMPTY,silhouette:Texture.EMPTY,xray:Array(4).fill(Texture.EMPTY),scale:1,anchorX:.5,anchorY:1}}));
  internal.sprites=sprites;
  const unit:EntityView={id:'u',kind,owner:'a',x:4,y:4,hp:100,maxHp:100};
  const target:EntityView={...unit,id:'t',kind:kind==='worker'?'knight':'worker',owner:'b',x:3,y:5};
  const frame=(tick:number,entities=[unit,target])=>({tick,timeMs:tick*100,entities,deposits:[],events:[],projectiles:[]}) as unknown as SpectatorView;
  const last=()=>sprites.mock.calls.filter(c=>c[0]===kind).at(-1)!;
  return {renderer,internal,unit,target,frame,last,time:(t:number)=>{now=t;}};
}
it.each(['knight','king','agent'])('keeps %s walking between tile updates and freezes on pause',kind=>{
  const h=setup(kind);h.renderer.setFrame(h.frame(1),100);
  const moved={...h.unit,x:5,stats:{atk:0,def:10,range:0,attackMs:1000,moveMs:500}};
  for(let tick=2;tick<=6;tick++){
    h.time(1000+(tick-2)*100);h.renderer.setFrame(h.frame(tick,[moved,h.target]),100);h.internal.animate();
    expect(h.last()[2]?.action).toBe('walk');
  }
  h.renderer.setPaused(true);const before=h.last()[2];h.time(9000);h.internal.animate();expect(h.last()[2]).toEqual(before);
  h.renderer.setPaused(false);h.renderer.setFrame(h.frame(7,[moved,h.target]),100);h.internal.animate();expect(h.last()[2]?.action).toBe('idle');
  h.renderer.setFrame(h.frame(1),100,true);h.internal.animate();expect(h.last()[2]?.action).toBe('idle');
});

it.each(['ranger','knight','king','worker'])('ties %s foot motion to traveled distance rather than elapsed time',kind=>{
  const sample=(moveMs:number,ticks:number,diagonal=false)=>{
    const h=setup(kind);h.renderer.setFrame(h.frame(1),100);
    const moved={...h.unit,x:5,y:diagonal?5:4,stats:{atk:0,def:0,range:0,attackMs:1000,moveMs}};
    h.renderer.setFrame(h.frame(2,[moved,h.target]),100);
    for(let step=1;step<=ticks;step++){
      h.time(1000+step*100);h.renderer.setFrame(h.frame(2+step,[moved,h.target]),100);
    }
    h.internal.animate();return h.last()[2];
  };
  expect(sample(200,1)).toEqual(sample(400,2)); // half a tile at either speed
  expect(sample(200,1)).toEqual({action:'walk',frame:kind==='ranger'?14:7});
  expect(sample(400,2,true)).toEqual(sample(400,2)); // a diagonal step keeps the orthogonal cadence
});
it.each([false,true])('faces the melee target immediately, including lethal hits (dead=%s)',dead=>{
  const h=setup('knight');h.renderer.setFrame(h.frame(1),100);
  h.renderer.setFrame({...h.frame(2,dead?[h.unit]:[h.unit,h.target]),events:[
    {tick:1,type:'attack',from:'u',to:'t',dmg:12},
    ...(dead?[{tick:1,type:'death' as const,id:'t',kind:'worker',owner:'b',x:3,y:5}]:[]),
  ]},100);h.internal.animate();
  expect(h.last().slice(1)).toEqual([6,{action:'attack',frame:atlas.attack.impactFrames[2]}]);
  h.time(1100);h.renderer.setFrame(h.frame(3,[{...h.unit,x:5,y:3}]),100);h.internal.animate();
  expect(h.last()[1]).toBe(6); // target direction stays locked despite movement
  h.renderer.setFrame(h.frame(1),100,true);h.internal.animate();expect(h.internal.drawn.get('u')!.shot).toBeUndefined();
});
it('presents historic unit and building names without altering replay data',()=>{
  expect(displayKind('agent')).toBe('king');expect(displayKind('nexus')).toBe('castle');expect(displayKind('knight')).toBe('knight');
});

it('keeps the existing melee lunge when an attack atlas has not been published',()=>{
  const available=vi.spyOn(animations,'hasUnitAnimation').mockReturnValue(false);
  try {
    const h=setup('knight');h.renderer.setFrame(h.frame(1),100);
    h.renderer.setFrame({...h.frame(2),events:[{tick:1,type:'attack',from:'u',to:'t',dmg:12}]},100);
    expect(h.internal.drawn.get('u')!.shot).toBeUndefined();
    expect((h.internal.drawn.get('u') as unknown as {lungeUntil:number}).lungeUntil).toBe(1140);
  } finally {available.mockRestore();}
});

it.each(['ranger','knight','king','worker'].flatMap(kind=>[0,1,2,3,4,5,6,7].map(dir=>({kind,dir}))))('plays $kind death once in direction $dir, freezes on pause and retains the corpse',({kind,dir})=>{
  const h=setup(kind);h.renderer.setFrame(h.frame(1),100);
  const drawn=h.internal.drawn.get('u')!;
  Object.assign(drawn,{dir});
  const sprite=drawn.sprite;
  h.renderer.setFrame({...h.frame(2,[h.target]),events:[{tick:1,type:'death',id:'u',kind,owner:'a',x:4,y:4}]},100);
  h.internal.animate();
  expect(h.last().slice(1)).toEqual([dir,{action:'death',frame:0}]);
  expect(sprite.rotation).toBe(0);
  h.time(2000);h.internal.animate();expect(h.last()[2]).toEqual({action:'death',frame:12});
  h.renderer.setPaused(true);h.time(9000);h.internal.animate();expect(h.last()[2]?.frame).toBe(12);
  h.renderer.setPaused(false);h.time(10500);h.internal.animate();expect(h.last()[2]?.frame).toBe(27);
  expect(sprite.destroyed).toBe(false);
  h.time(15000);h.internal.animate();expect(sprite.destroyed).toBe(true);
});

it('holds the death endpoint and preserves static fallback for unsupported units',()=>{
  expect(unitDeathAnimation('ranger',100_000)).toEqual({action:'death',frame:27});
  expect(unitDeathAnimation('wall',1000)).toBeUndefined();
});

it('scales the fall with replay speed and completes after the final snapshot',()=>{
  const h=setup('ranger');h.renderer.setFrame(h.frame(1),200);
  h.renderer.setFrame({...h.frame(2,[h.target]),events:[{tick:1,type:'death',id:'u',kind:'ranger',owner:'a',x:4,y:4}]},200);
  h.internal.animate();
  h.time(2000);h.internal.animate();expect(h.last()[2]?.frame).toBe(6); // 0.5x
  h.renderer.setFrame(h.frame(3,[h.target]),50); // switch to 2x
  h.time(2250);h.internal.animate();expect(h.last()[2]?.frame).toBe(12);
  h.time(3250);h.internal.animate();expect(h.last()[2]?.frame).toBe(27); // no more snapshots
});

it('removes the old corpse when seeking back to a living unit',()=>{
  const h=setup('ranger');h.renderer.setFrame(h.frame(1),100);
  const oldSprite=h.internal.drawn.get('u')!.sprite;
  h.renderer.setFrame({...h.frame(2,[h.target]),events:[{tick:1,type:'death',id:'u',kind:'ranger',owner:'a',x:4,y:4}]},100);
  h.internal.animate();expect(oldSprite.destroyed).toBe(false);
  h.renderer.setFrame(h.frame(1),100,true);h.internal.animate();
  expect(oldSprite.destroyed).toBe(true);
  expect(h.internal.drawn.get('u')!.sprite.destroyed).toBe(false);
  expect(h.last()[2]?.action).toBe('idle');
});

it('keeps Worker static when idle and uses distance for walking',()=>{
 expect(unitAnimation('worker',0,false)).toBeUndefined();
 expect(unitAnimation('worker',10000,true,undefined,.5)).toEqual({action:'walk',frame:7});
});

it.each([[1,1,0],[1,0,1],[1,-1,2],[0,-1,3],[-1,-1,4],[-1,0,5],[-1,1,6],[0,1,7]])('faces the mineral at offset %i,%i in screen direction %i', (dx,dy,dir)=>{
 const mining=vi.spyOn(animations,'unitMiningAnimation').mockReturnValue({action:'mine',frame:3});
 try {
  const h=setup('worker');
  const unit={...h.unit,gathering:{x:4+dx,y:4+dy}};
  h.renderer.setFrame(h.frame(1,[unit]),100);h.internal.animate();
  expect(h.last().slice(1)).toEqual([dir,{action:'mine',frame:3}]);
  const moved={...unit,x:5,stats:{atk:3,def:1,range:1,attackMs:1000,moveMs:500}};
  h.renderer.setFrame(h.frame(2,[moved]),100);h.internal.animate();
  expect(h.last()[2]?.action).toBe('walk');
 }finally{mining.mockRestore();}
});

it.each([0,1,2,3,4,5,6,7])('starts Worker melee direction %i at the actual contact pose',dir=>{
 const row=[0,1,2,3,4,3,2,1][dir];
 expect(unitAnimation('worker',1000,true,{at:1000,dir})).toEqual({action:'attack',frame:workerAtlas.attack.impactFrames[row]});
 expect(unitAnimation('worker',1400,false,{at:1000,dir})).toBeUndefined();
});
it('locks a Worker melee hit to the target instead of the mineral or movement',()=>{
 const h=setup('worker');h.renderer.setFrame(h.frame(1),100);
 const mining={...h.unit,gathering:{x:5,y:5}};
 h.renderer.setFrame({...h.frame(2,[mining,h.target]),events:[{tick:1,type:'attack',from:'u',to:'t',dmg:3}]},100);h.internal.animate();
 expect(h.last().slice(1)).toEqual([6,{action:'attack',frame:workerAtlas.attack.impactFrames[2]}]);
});
it('freezes mining on pause and stops mining when work ends',()=>{
 const h=setup('worker');const unit={...h.unit,gathering:{x:5,y:5}};
 h.renderer.setFrame(h.frame(10,[unit]),100);h.internal.animate();
 expect(h.last()[2]?.action).toBe('mine');
 h.renderer.setPaused(true);const before=h.last()[2];h.time(5000);h.internal.animate();expect(h.last()[2]).toEqual(before);
 h.renderer.setPaused(false);h.renderer.setFrame(h.frame(11,[h.unit]),100);h.internal.animate();expect(h.last()[2]).toBeUndefined();
});

it.each([0,1,2,3,4,5,6,7])('starts King melee direction %i at contact and resumes idle',dir=>{
 const row=[0,1,2,3,4,3,2,1][dir];
 expect(unitAnimation('king',1000,true,{at:1000,dir})).toEqual({action:'attack',frame:kingAtlas.attack.impactFrames[row]});
 expect(unitAnimation('king',1400,false,{at:1000,dir})?.action).toBe('idle');
});
it('faces the King toward his attacker and freezes the strike on pause',()=>{
 const h=setup('king');h.renderer.setFrame(h.frame(1),100);
 h.renderer.setFrame({...h.frame(2),events:[{tick:1,type:'attack',from:'u',to:'t',dmg:1}]},100);h.internal.animate();
 expect(h.last().slice(1)).toEqual([6,{action:'attack',frame:kingAtlas.attack.impactFrames[2]}]);
 h.renderer.setPaused(true);const before=h.last();h.time(5000);h.internal.animate();expect(h.last()).toEqual(before);
});
