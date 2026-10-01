import { expect, it } from 'vitest';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

it.each(['castle', 'turret'])('%s has a moving flag, fixed masonry and transparent cell borders', async kind => {
  const base = new URL(`../public/sprites/${kind}/`, import.meta.url);
  const { idle: m } = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
  const { data, info } = await sharp(await readFile(new URL(m.image, base))).raw().toBuffer({resolveWithObject:true});
  expect(info.width).toBe(m.frameWidth * m.frameCount);
  expect(info.height).toBe(m.frameHeight);
  let flagChanges = 0;
  for(let frame=1; frame<m.frameCount; frame++) {
    for(let y=0; y<info.height; y++) for(let x=0; x<m.frameWidth; x++) {
      const at=(y*info.width+frame*m.frameWidth+x)*4;
      const first=(y*info.width+x)*4;
      if(y===0 || y===info.height-1 || x===0 || x===m.frameWidth-1) expect(data[at+3]).toBe(0);
      if(y > info.height*0.21) {
        if(!data.subarray(at,at+4).equals(data.subarray(first,first+4))) throw new Error(`Masonry moved in ${kind} frame ${frame}, ${x},${y}`);
      } else if(!data.subarray(at,at+4).equals(data.subarray(first,first+4))) flagChanges++;
    }
  }
  expect(flagChanges).toBeGreaterThan(100);
});
