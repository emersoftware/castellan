import { expect, it } from 'vitest';
import sharp from 'sharp';

const pixels = async (name: string) => {
 const {data,info}=await sharp(new URL(`../public/sprites/${name}`,import.meta.url).pathname).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 return (x:number,y:number)=>Array.from(data.subarray((y*info.width+x)*4,(y*info.width+x)*4+4));
};
it('leaves an open passage visible through the adjoining wall instead of painting over it',async()=>{
 const wall=await pixels('wall.png'),trimmed=await pixels('wall-door-right.svg'),open=await pixels('door-open.svg');
 // A point in the arch (45,70) maps to (93,46) in the front neighbour:
 // one grid step is (-48,+24) stored pixels. The old full wall hid the hole.
 expect(open(45,70)[3]).toBe(0);
 expect(wall(93,46)[3]).toBeGreaterThan(127);
 expect(trimmed(93,46)[3]).toBe(0);
});
it('raises the gate without cutting away the masonry above its arch',async()=>{
 const wall=await pixels('wall.png'),open=await pixels('door-open.svg'),closed=await pixels('door.svg');
 expect(open(41,70)[3]).toBe(0);
 expect(closed(41,70)[3]).toBeGreaterThan(127);
 expect(open(45,40)).toEqual(wall(45,40));
 expect(closed(45,40)).toEqual(wall(45,40));
});
