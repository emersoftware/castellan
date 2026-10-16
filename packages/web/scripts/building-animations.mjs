/** Package flag-only MiniMax loops. Keep every stone/pole pixel from the reference. */
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { ff, probeDuration } from './ffmpeg.mjs';
const root = new URL('../../../', import.meta.url).pathname;
const spriteDir = `${root}packages/web/public/sprites`;
const settings = {
  castle: { file: 'castle', crop: {left:76,top:20,width:392,height:508}, width:180,height:234,pole:313, flagBottom:116, anchorX:0.5,anchorY:437/508 },
  tower: { file: 'tower', crop: {left:150,top:20,width:254,height:508}, width:108,height:216,pole:287, flagBottom:116, anchorX:128/254,anchorY:440/508 },
};
const manifest = JSON.parse(await readFile(`${spriteDir}/manifest.json`,'utf8'));
function key(data) {
 for(let i=0;i<data.length;i+=4) {
   const r=data[i],g=data[i+1],b=data[i+2];
   const chroma=Math.min(r,b)-g;
   const alpha = chroma > 45 ? 0 : chroma > 15 ? Math.round(255*(45-chroma)/30) : 255;
   data[i]=data[i+1]=data[i+2]=g; data[i+3]=alpha;
 }
 return data;
}
for(const [kind,s] of Object.entries(settings)) {
 const dir=`${root}assets/animations/buildings/${kind === "tower" ? "turret" : kind}`;
 const out=`${spriteDir}/${kind}`;
 await mkdir(out,{recursive:true}); await mkdir(`${dir}/frames`,{recursive:true});
 const ref=key(await sharp(`${dir}/reference.png`).ensureAlpha().raw().toBuffer());
 const duration=probeDuration(`${dir}/generated.mp4`);
 ff('-i',`${dir}/generated.mp4`,'-vf',`fps=${28/duration},scale=544:544`,'-frames:v','28',`${dir}/frames/%02d.png`);
 const cells=[];
 for(let frame=0;frame<28;frame++) {
   const video=key(await sharp(`${dir}/frames/${String(frame+1).padStart(2,'0')}.png`).ensureAlpha().raw().toBuffer());
   const pixels=Buffer.from(ref);
   for(let y=25;y<s.flagBottom;y++) for(let x=s.pole;x<460;x++) {
     const i=(y*544+x)*4;
     // Only the isolated cloth rectangle above the roof comes from the video.
     video.copy(pixels,i,i,i+4);
   }
   const cell=await sharp(pixels,{raw:{width:544,height:544,channels:4}}).extract(s.crop).resize(s.width,s.height).png().toBuffer();
   cells.push(cell);
 }
 await sharp({create:{width:s.width*28,height:s.height,channels:4,background:'#00000000'}})
   .composite(cells.map((input,i)=>({input,left:i*s.width,top:0}))).png().toFile(`${out}/${kind}-idle.png`);
 await writeFile(`${spriteDir}/${s.file}.png`,cells[0]);
 await writeFile(`${out}/manifest.json`,JSON.stringify({idle:{image:`${kind}-idle.png`,fps:12,frameCount:28,frameWidth:s.width,frameHeight:s.height,storedScale:3,anchorX:s.anchorX,anchorY:s.anchorY,loop:true,rows:['se']}},null,2)+'\n');
 manifest.sprites[s.file]={width:s.width/3,height:s.height/3,anchorX:s.anchorX,anchorY:s.anchorY};
 console.log(`${kind}: 28 frames, ${s.width}x${s.height}, fixed stone and pole`);
}
await writeFile(`${spriteDir}/manifest.json`,JSON.stringify(manifest,null,1)+'\n');
