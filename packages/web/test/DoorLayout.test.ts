// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Texture, TextureSource } from 'pixi.js';
import { rules, type EntityView } from '@castellan/shared';
import type { SpriteArt } from '../src/render/sprites';
import { createField, frameAt, stubArt } from './support/battlefield';
import manifest from '../../../assets/sprites/manifest.json';

function setup() {
 const art=(kind:'wall'|'wallpost'|'door'|'door-open'|'wall-door-left'|'wall-door-right'|'wall-door-both'):SpriteArt=>{
   const m=manifest.sprites[kind];const source=new TextureSource({width:m.width*3,height:m.height*3});
   return {texture:new Texture({source}),silhouette:new Texture({source}),xray:[],scale:1/3,anchorX:m.anchorX,anchorY:m.anchorY,top:0};
 };
 const arts={wall:art('wall'),wallpost:art('wallpost'),door:art('door'),'door-open':art('door-open'),'wall-door-left':art('wall-door-left'),'wall-door-right':art('wall-door-right'),'wall-door-both':art('wall-door-both')};
 const h=createField({ruleset:rules,colors:{a:0},sprites:kind=>({art:arts[kind as keyof typeof arts]??stubArt(),flip:false})});
 return {...h,arts};
}
const entity=(id:string,kind:string,x:number,y:number,open=false):EntityView=>({id,kind,owner:'a',x,y,hp:300,maxHp:300,open});

it.each(['x','y'])('keeps door art, depth mask and ground anchor aligned along %s when opening, closing and seeking',axis=>{
 const h=setup();
 const walls=[-1,1].map(sign=>entity(`w${sign}`,'wall',5+(axis==='x'?sign:0),5+(axis==='y'?sign:0)));
 for(const [i,open] of [false,true,false,true].entries()) {
   const frame=frameAt(i===3?1:i+1,[...walls,entity('d','door',5,5,open)]);
   if(i===3)h.field.seek(frame,100);else h.field.show(frame,100);
   h.animate();
   const d=h.sprite('d'),w=h.sprite('w1'),depth=h.occluderOf(d)!;
   expect(d.texture).toBe(h.arts[open?'door-open':'door'].texture);
   expect(depth.texture).toBe(h.arts[open?'door-open':'door'].silhouette);
   expect(d.scale.x).toBe((axis==='x'?-1:1)/3);
   expect(w.texture).toBe(h.arts['wall-door-right'].texture);
   expect(h.sprite('w-1').texture).toBe(h.arts['wall-door-left'].texture);
   expect(d.anchor.x).toBe(w.anchor.x);expect(d.anchor.y).toBe(w.anchor.y);
   expect(depth.anchor).toMatchObject({x:d.anchor.x,y:d.anchor.y});
   expect(depth.scale.x).toBe(d.scale.x);expect(depth.position).toMatchObject({x:d.x,y:d.y});
 }
});
it.each([[1,1],[1,-1],[-1,1],[-1,-1]])('uses a wall post where the wall turns (%i,%i)',(dx,dy)=>{
 const h=setup();
 h.field.show(frameAt(1,[entity('corner','wall',5,5),entity('x','wall',5+dx,5),entity('y','wall',5,5+dy)]),100);h.animate();
 const corner=h.sprite('corner');
 expect(corner.texture).toBe(h.arts.wallpost.texture);
 expect(h.occluderOf(corner)!.texture).toBe(h.arts.wallpost.silhouette);
});
