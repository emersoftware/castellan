// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { Texture, type Sprite, type Graphics } from 'pixi.js';
import { rules, type EntityView, type SpectatorView } from '@castellan/shared';
import { GameRenderer } from '../src/render/renderer';
import { buildingLook, fall } from '../src/render/look';
import fireSites from '../public/sprites/castle/fire-pixels.json';
import { RAMPS, PLAYER_RAMPS } from '../src/render/palette';
import type { SpriteSet } from '../src/render/sprites';

const look = (kind: string, hp: number, maxHp: number, timeMs: number) => buildingLook({ kind, hp, maxHp }, timeMs)!;
it('selects the two approved states and ignites at half health', () => {
  expect(look('castle',76,100,0).animation.action).toBe('idle');
  expect(look('castle',75,100,0).animation).toEqual({action:'damaged25',frame:0});
  expect(look('castle',51,100,0).fire).toBeUndefined();
  expect(look('castle',50,100,1000).fire?.animation).toEqual({action:'fire25',frame:12});
  expect(look('castle',26,100,0).animation).toEqual({action:'damaged25',frame:0});
  expect(look('castle',25,100,1000).fire?.animation).toEqual({action:'fire50',frame:12});
  expect(look('nexus',25,100,1000).fire?.animation).toEqual({action:'fire50',frame:12});
  expect(look('tower',25,100,1000).fire).toBeUndefined();
  expect(look('castle',1,0,1000).fire).toBeUndefined();
});

it('particles use mapped fire sites and a reproducible simulation phase', () => {
  for(const stage of [25,50] as const) {
    const sites=fireSites.stages[stage];
    expect(sites.length).toBe(stage===25?4:5);
    const particles=(timeMs:number)=>look('castle',stage===25?50:25,100,timeMs).fire!.particles;
    const p=particles(1200);
    expect(p).toHaveLength(sites.length*8);
    expect(p).toEqual(particles(1200));
    expect(p).not.toEqual(particles(1300));
    p.forEach((particle,i)=>{
      expect(particle.y).toBeLessThanOrEqual(sites[Math.floor(i/8)].y);
      expect(particle.heat).toBeGreaterThanOrEqual(.25);
      expect(particle.heat).toBeLessThanOrEqual(1);
    });
  }
});

it.each([25,50] as const)('renders stage %s with owner masonry, independent fire, pause and matching collapse', stage => {
  let now=1000;
  const renderer=Reflect.construct(GameRenderer,[document.createElement('div'),rules,{a:2}]) as GameRenderer;
  const internal=renderer as unknown as {
    now:()=>number; play:()=>void; sprites:SpriteSet; animate():void;
    app:{renderer:{render():void}};
    drawn:Map<string,{sprite:Sprite;flame?:Sprite;sparks?:Graphics}>;
  };
  internal.now=()=>now;internal.play=vi.fn();internal.app={renderer:{render(){}}};
  const sprites=vi.fn<SpriteSet>(()=>({flip:false,art:{texture:Texture.EMPTY,silhouette:Texture.EMPTY,
    xray:Array(4).fill(Texture.EMPTY),scale:1/3,anchorX:.5,anchorY:.75}}));
  internal.sprites=sprites;
  const entity:EntityView={id:'u',kind:'castle',owner:'a',x:4,y:4,hp:stage===25?50:25,maxHp:100};
  const frame=(tick:number,entities:EntityView[])=>({tick,timeMs:tick*100,entities,deposits:[],events:[],projectiles:[]}) as unknown as SpectatorView;
  renderer.setFrame(frame(1,[entity]),100);internal.animate();
  const drawn=internal.drawn.get('u')!;
  expect(drawn.sprite.tint).toBe(PLAYER_RAMPS[2].key);
  expect(drawn.flame?.tint).toBe(RAMPS.fire.key);
  expect(drawn.sparks).toBeDefined();
  expect(sprites.mock.calls.some(c=>c[2]?.action===`damaged${stage}`)).toBe(true);
  const lastFire=()=>sprites.mock.calls.filter(c=>c[2]?.action===`fire${stage}`).at(-1)![2];
  renderer.setPaused(true);const before=lastFire();now=5000;internal.animate();
  expect(lastFire()).toEqual(before);
  renderer.setPaused(false);
  renderer.setFrame({...frame(2,[]),events:[{tick:1,type:'death',id:'u',kind:'castle',owner:'a',x:4,y:4}]},100);
  internal.animate();
  expect(sprites.mock.calls.some(c=>c[2]?.action===`death${stage}`&&c[2].frame===0)).toBe(true);
  expect(fall({kind:'castle',hp:stage===25?50:25,maxHp:100},rules.kinds.castle).at(1000).animation?.action).toBe(`death${stage}`);
  now=6000;internal.animate();
  const lastDeathFire=()=>sprites.mock.calls.filter(c=>c[2]?.action===`deathFire${stage}`).at(-1)![2];
  const deathFrame=lastDeathFire();renderer.setPaused(true);now=9000;internal.animate();
  expect(lastDeathFire()).toEqual(deathFrame);
  renderer.setPaused(false);now=18000;internal.animate();
  expect(drawn.sprite.destroyed).toBe(true);
  expect(drawn.flame).toBeUndefined();expect(drawn.sparks).toBeUndefined();
});
