// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { Texture, type Sprite, type Graphics } from 'pixi.js';
import { rules, type EntityView, type SpectatorView } from '@aoa/shared';
import { GameRenderer } from '../src/render/renderer';
import { castleDamageStage, castleFire, castleEmitters, fireParticles } from '../src/render/castleDamage';
import { buildingCollapse } from '../src/render/buildingCollapse';
import { RAMPS, PLAYER_RAMPS } from '../src/render/palette';
import type { SpriteSet } from '../src/render/sprites';

it('selects the two approved states and ignites at half health', () => {
  expect(castleDamageStage('castle',76,100)).toBeUndefined();
  expect(castleDamageStage('castle',75,100)).toBe(25);
  expect(castleFire('castle',51,100,0)).toBeUndefined();
  expect(castleFire('castle',50,100,1000)).toEqual({action:'fire25',frame:12});
  expect(castleDamageStage('castle',26,100)).toBe(25);
  expect(castleFire('castle',25,100,1000)).toEqual({action:'fire50',frame:12});
  expect(castleFire('nexus',25,100,1000)).toEqual({action:'fire50',frame:12});
  expect(castleFire('tower',25,100,1000)).toBeUndefined();
  expect(castleFire('castle',1,0,1000)).toBeUndefined();
});

it('particles use mapped fire sites and a reproducible simulation phase', () => {
  for(const stage of [25,50] as const) {
    const sites=castleEmitters(stage);
    expect(sites.length).toBe(stage===25?4:5);
    const p=fireParticles(sites,1200);
    expect(p).toHaveLength(sites.length*8);
    expect(p).toEqual(fireParticles(sites,1200));
    expect(p).not.toEqual(fireParticles(sites,1300));
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
  expect(buildingCollapse('castle',1000,stage)?.animation.action).toBe(`death${stage}`);
  now=6000;internal.animate();
  const lastDeathFire=()=>sprites.mock.calls.filter(c=>c[2]?.action===`deathFire${stage}`).at(-1)![2];
  const deathFrame=lastDeathFire();renderer.setPaused(true);now=9000;internal.animate();
  expect(lastDeathFire()).toEqual(deathFrame);
  renderer.setPaused(false);now=18000;internal.animate();
  expect(drawn.sprite.destroyed).toBe(true);
  expect(drawn.flame).toBeUndefined();expect(drawn.sparks).toBeUndefined();
});
