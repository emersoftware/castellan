// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Texture, TextureSource, type Sprite } from 'pixi.js';
import { v15, type EntityView, type SpectatorView } from '@aoa/shared';
import { GameRenderer } from '../src/render/renderer';
import type { SpriteArt, SpriteSet } from '../src/render/sprites';
import manifest from '../public/sprites/manifest.json';

function setup() {
 const r=Reflect.construct(GameRenderer,[document.createElement('div'),v15,{a:0}]) as GameRenderer;
 const inner=r as unknown as {sprites:SpriteSet;now():number;animate():void;app:unknown;drawn:Map<string,{sprite:Sprite;depth:Sprite}>};
 const art=(kind:'wall'|'wallpost'|'door'|'door-open'|'wall-door-left'|'wall-door-right'|'wall-door-both'):SpriteArt=>{
   const m=manifest.sprites[kind];const source=new TextureSource({width:m.width*3,height:m.height*3});
   return {texture:new Texture({source}),silhouette:new Texture({source}),xray:[],scale:1/3,anchorX:m.anchorX,anchorY:m.anchorY};
 };
 const arts={wall:art('wall'),wallpost:art('wallpost'),door:art('door'),'door-open':art('door-open'),'wall-door-left':art('wall-door-left'),'wall-door-right':art('wall-door-right'),'wall-door-both':art('wall-door-both')};
 inner.sprites=kind=>({art:arts[kind as keyof typeof arts],flip:false});
 inner.now=()=>1000;inner.app={renderer:{render(){}}};
 return {r,inner,arts};
}
const entity=(id:string,kind:string,x:number,y:number,open=false):EntityView=>({id,kind,owner:'a',x,y,hp:300,maxHp:300,open});
const frame=(entities:EntityView[],tick=1)=>({tick,timeMs:tick*100,entities,deposits:[],events:[],projectiles:[]}) as unknown as SpectatorView;

it.each(['x','y'])('keeps door art, depth mask and ground anchor aligned along %s when opening, closing and seeking',axis=>{
 const {r,inner,arts}=setup();
 const walls=[-1,1].map(sign=>entity(`w${sign}`,'wall',5+(axis==='x'?sign:0),5+(axis==='y'?sign:0)));
 for(const [i,open] of [false,true,false,true].entries()) {
   r.setFrame(frame([...walls,entity('d','door',5,5,open)],i===3?1:i+1),100,i===3);inner.animate();
   const d=inner.drawn.get('d')!,w=inner.drawn.get('w1')!;
   expect(d.sprite.texture).toBe(arts[open?'door-open':'door'].texture);
   expect(d.depth.texture).toBe(arts[open?'door-open':'door'].silhouette);
   expect(d.sprite.scale.x).toBe((axis==='x'?-1:1)/3);
   expect(w.sprite.texture).toBe(arts['wall-door-right'].texture);
   expect(inner.drawn.get('w-1')!.sprite.texture).toBe(arts['wall-door-left'].texture);
   expect(d.sprite.anchor.x).toBe(w.sprite.anchor.x);expect(d.sprite.anchor.y).toBe(w.sprite.anchor.y);
   expect(d.depth.anchor).toMatchObject({x:d.sprite.anchor.x,y:d.sprite.anchor.y});
   expect(d.depth.scale.x).toBe(d.sprite.scale.x);expect(d.depth.position).toMatchObject({x:d.sprite.x,y:d.sprite.y});
 }
});
it.each([[1,1],[1,-1],[-1,1],[-1,-1]])('uses a wall post where the wall turns (%i,%i)',(dx,dy)=>{
 const {r,inner,arts}=setup();
 r.setFrame(frame([entity('corner','wall',5,5),entity('x','wall',5+dx,5),entity('y','wall',5,5+dy)]),100);inner.animate();
 expect(inner.drawn.get('corner')!.sprite.texture).toBe(arts.wallpost.texture);
 expect(inner.drawn.get('corner')!.depth.texture).toBe(arts.wallpost.silhouette);
});
