/** Measure the exported crystal and mark visually reviewed burst frames. */
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const [action]=process.argv.slice(2);
if(!['heal','hack','convert'].includes(action))throw new Error('Usage: node assets/animations/wizard/cast-points.mjs heal|hack|convert [--direction=se]');
const direction=process.argv.find(arg=>arg.startsWith('--direction='))?.split('=')[1];
const base=resolve(import.meta.dirname,`${action}-directions`);
const output=resolve(base,direction?`export-${direction}`:'export');
const sharp=createRequire(resolve(import.meta.dirname,'../../../packages/web/package.json'))('sharp');
const meta=JSON.parse(readFileSync(resolve(output,'manifest.json')));
const review=JSON.parse(readFileSync(resolve(base,'casting-review.json')));
if(meta.fps!==12||meta.frameCount!==28||meta.frameWidth!==112||meta.frameHeight!==112||meta.anchorY*112!==101.5)throw new Error('Unexpected casting atlas contract');
const {data,info}=await sharp(resolve(output,meta.image)).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});

// A small bright connected component near the previous measured position avoids
// averaging disconnected arcs into the crystal. Missing/ambiguous tracks fail;
// the marked contact sheet remains the final visual check, not auto-acceptance.
function crystalAt(row,frame,previous){
 const candidates=[],seen=new Set();
 const pixel=(x,y)=>((row*112+y)*info.width+frame*112+x)*4;
 const bright=(x,y)=>x>=0&&x<112&&y>=0&&y<100&&data[pixel(x,y)+3]>=200&&data[pixel(x,y)]>=150;
 for(let y=0;y<100;y++)for(let x=0;x<112;x++){
  const index=y*112+x;
  if(seen.has(index)||!bright(x,y))continue;
  const queue=[[x,y]];seen.add(index);
  let sx=0,sy=0,weight=0,x0=x,x1=x,y0=y,y1=y;
  for(let head=0;head<queue.length;head++){
   const [px,py]=queue[head],w=data[pixel(px,py)]-149;
   sx+=px*w;sy+=py*w;weight+=w;
   x0=Math.min(x0,px);x1=Math.max(x1,px);y0=Math.min(y0,py);y1=Math.max(y1,py);
   for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
    const nx=px+dx,ny=py+dy,next=ny*112+nx;
    if(bright(nx,ny)&&!seen.has(next)){seen.add(next);queue.push([nx,ny]);}
   }
  }
  if(queue.length<1||queue.length>90||x1-x0>12||y1-y0>15)continue;
  const point=[sx/weight,sy/weight];
  const distance=Math.hypot(point[0]-previous[0],point[1]-previous[1]);
  if(distance<=12)candidates.push({point,distance});
 }
 candidates.sort((a,b)=>a.distance-b.distance);
 if(!candidates.length||candidates[1]&&candidates[1].distance-candidates[0].distance<1)throw new Error(`${meta.rows[row]}/${frame}: missing or ambiguous crystal; review the source and seed`);
 return candidates[0].point.map(value=>Math.round(value*100)/100);
}

const crystal=[],pulses=[];
for(const [row,name] of meta.rows.entries()){
 const entry=review.views[name];
 if(!entry?.seed||!Array.isArray(entry.pulses)||!entry.reason)throw new Error(`${name}: missing visual review`);
 const points=[];
 for(let frame=0;frame<28;frame++)points.push(crystalAt(row,frame,frame===0||frame===27?entry.seed:points.at(-1)));
 for(const frame of entry.pulses)if(!Number.isInteger(frame)||frame<0||frame>=27)throw new Error(`${name}: invalid pulse frame`);
 // Measure an already published legacy atlas without rewriting its endpoints.
 if(review.requireExactLoop!==false)for(let y=0;y<112;y++)for(let x=0;x<112;x++)for(let c=0;c<4;c++){
  if(data[((row*112+y)*info.width+x)*4+c]!==data[((row*112+y)*info.width+27*112+x)*4+c])throw new Error(`${name}: loop endpoints differ`);
 }
 crystal.push(points);pulses.push(entry.pulses);
}
writeFileSync(resolve(output,'cast-points.json'),JSON.stringify({fps:12,frameCount:28,rows:meta.rows,crystal,pulses},null,2)+'\n');

const columns=14,cellHeight=132,width=columns*112,height=meta.rows.length*2*cellHeight;
const layers=[],marks=[];
for(const [row,name] of meta.rows.entries())for(let frame=0;frame<28;frame++){
 const left=frame%columns*112,top=(row*2+Math.floor(frame/columns))*cellHeight;
 const burst=pulses[row].includes(frame),[x,y]=crystal[row][frame];
 layers.push({input:await sharp(resolve(output,meta.image)).extract({left:frame*112,top:row*112,width:112,height:112}).png().toBuffer(),left,top:top+20});
 marks.push(`<text x="${left+4}" y="${top+14}" fill="${burst?'#ffe45c':'white'}">${name.toUpperCase()} ${frame}${burst?' PULSE':''}</text><rect x="${left+1}" y="${top+20}" width="110" height="111" fill="none" stroke="${burst?'#ffe45c':'#444'}"/><path d="M${left+x-4} ${top+20+y}h8 M${left+x} ${top+16+y}v8" stroke="#ff5050" fill="none"/>`);
}
layers.push({input:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g font-family="monospace" font-size="11">${marks.join('')}</g></svg>`),left:0,top:0});
await sharp({create:{width,height,channels:4,background:'#242830'}}).composite(layers).png().toFile(resolve(output,'cast-points-contact-sheet.png'));
console.log(`${action}: measured ${meta.rows.length*28} crystal centres; review cast-points-contact-sheet.png before accepting.`);
