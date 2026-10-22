// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Graphics, Sprite } from 'pixi.js';
import { rules, type EntityView } from '@castellan/shared';
import { buildingLook, fall } from '../src/render/look';
import fireSites from '../../../assets/sprites/castle/fire-pixels.json';
import { RAMPS, PLAYER_RAMPS } from '../src/render/palette';
import { createField, frameAt, stubArt } from './support/battlefield';

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
  const h=createField({colors:{a:2},art:stubArt({scale:1/3,anchorX:.5,anchorY:.75})});
  const entity:EntityView={id:'u',kind:'castle',owner:'a',x:4,y:4,hp:stage===25?50:25,maxHp:100};
  h.field.show(frameAt(1,[entity]),100);h.animate();
  const sprite=h.sprite('u');
  expect(sprite.tint).toBe(PLAYER_RAMPS[2].key);
  // The fire is the one sprite on the field in the fire ramp; its sparks the one graphic among the bodies.
  const flame=h.layers.objects.children.find(c=>c instanceof Sprite&&c.tint===RAMPS.fire.key)!;
  const sparks=h.layers.objects.children.find(c=>c instanceof Graphics)!;
  expect(flame).toBeDefined();
  expect(sparks).toBeDefined();
  expect(h.sprites.mock.calls.some(c=>c[2]?.action===`damaged${stage}`)).toBe(true);
  const lastFire=()=>h.sprites.mock.calls.filter(c=>c[2]?.action===`fire${stage}`).at(-1)![2];
  h.clock.pause();const before=lastFire();h.time(5000);h.animate();
  expect(lastFire()).toEqual(before);
  h.clock.resume();
  h.field.show({...frameAt(2,[]),events:[{tick:1,type:'death',id:'u',kind:'castle',owner:'a',x:4,y:4}]},100);
  h.animate();
  expect(h.sprites.mock.calls.some(c=>c[2]?.action===`death${stage}`&&c[2].frame===0)).toBe(true);
  expect(fall({kind:'castle',hp:stage===25?50:25,maxHp:100},rules.kinds.castle).at(1000).animation?.action).toBe(`death${stage}`);
  // Masonry, flame and sparks fall together in one layer.
  const collapse=sprite.parent!;
  expect(flame.parent).toBe(collapse);expect(sparks.parent).toBe(collapse);
  h.time(6000);h.animate();
  const lastDeathFire=()=>h.sprites.mock.calls.filter(c=>c[2]?.action===`deathFire${stage}`).at(-1)![2];
  const deathFrame=lastDeathFire();h.clock.pause();h.time(9000);h.animate();
  expect(lastDeathFire()).toEqual(deathFrame);
  h.clock.resume();h.time(18000);h.animate();
  expect(sprite.destroyed).toBe(true);
  expect(collapse.destroyed).toBe(true);
  expect(flame.destroyed).toBe(true);expect(sparks.destroyed).toBe(true);
});
