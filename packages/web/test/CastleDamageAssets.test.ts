import { expect, it } from 'vitest';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const dir=new URL('../../../assets/sprites/castle/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',dir),'utf8'));
const mapping=JSON.parse(await readFile(new URL('fire-pixels.json',dir),'utf8'));

async function cells(action:string) {
  const m=manifest[action],result=[];
  for(let f=0;f<m.frameCount;f++) {
    const {data,info}=await sharp(new URL(m.image,dir).pathname).extract({left:f%m.columns*m.frameWidth,top:Math.floor(f/m.columns)*m.frameHeight,width:m.frameWidth,height:m.frameHeight}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let minX=info.width,minY=info.height,maxX=0,maxY=0,count=0;
    for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++) {
      const i=(y*info.width+x)*4;
      if(x===0||y===0||x===info.width-1||y===info.height-1)expect(data[i+3]).toBe(0);
      if(data[i+3]>128) {
        count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        if(data[i]!==data[i+1]||data[i+1]!==data[i+2])throw new Error(`${action} frame ${f}: colored source pixel`);
      }
    }
    result.push({data,minX,minY,maxX,maxY,count});
  }
  return result;
}

it.each([25,50])('stage %s preserves fixed art, animated flames and mapped emitters',async stage=>{
  const body=await cells(`damaged${stage}`),fire=await cells(`fire${stage}`),death=await cells(`death${stage}`);
  expect(body).toHaveLength(1);
  expect(death[0].data).toEqual(body[0].data);
  expect(new Set(fire.map(f=>f.data.toString('base64'))).size).toBeGreaterThan(10);
  expect(fire.every(f=>f.count>0&&f.count<body[0].count*.15)).toBe(true);
  expect(mapping.stages[String(stage)]).toHaveLength(stage===25?4:5);
  expect(mapping.collapses[String(stage)]).toHaveLength(28);
  const first=mapping.collapses[String(stage)][0];
  expect(first).toEqual(mapping.stages[String(stage)]);
  for(const point of first) {
    const x=Math.round((point.x*3+manifest[`fire${stage}`].anchorX*317));
    const y=Math.round((point.y*3+manifest[`fire${stage}`].anchorY*317));
    let heat=0;
    for(let dy=-10;dy<=0;dy++)for(let dx=-5;dx<=5;dx++)heat+=fire[0].data[((y+dy)*317+x+dx)*4+3]??0;
    expect(heat).toBeGreaterThan(255);
  }
});

it.each(['death','death25','death50'])('%s falls from the top with stable footing and compact inward rubble',async action=>{
  const frames=await cells(action),start=frames[0],end=frames.at(-1)!;
  expect(frames[27].data).toEqual(frames[26].data);
  expect(end.minY).toBeGreaterThan(start.minY+50);
  expect(end.maxY-end.minY).toBeLessThan((start.maxY-start.minY)*.6);
  expect(end.minX).toBeGreaterThan(start.minX);
  expect(end.maxX).toBeLessThan(start.maxX);
  // Lower walls stay planted while the top falls; the footprint never expands horizontally.
  for(const frame of frames)expect(frame.maxX-frame.minX).toBeLessThanOrEqual(start.maxX-start.minX+8);
  for(const frame of frames.slice(1,15))expect(Math.abs(frame.maxY-start.maxY)).toBeLessThanOrEqual(3);
});
