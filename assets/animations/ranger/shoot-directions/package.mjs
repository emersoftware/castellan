/** Build portable 8-direction previews and the 5-view sprite atlas. */
import {createRequire} from 'node:module';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdirSync,readdirSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'../../../..');
const sharp=createRequire(join(root,'packages/web/package.json'))('sharp');
const output=join(here,'export');
mkdirSync(output,{recursive:true});
const base=['s','se','e','ne','n'];
const directions=['s','se','e','ne','n','nw','w','sw'];
const views=[0,1,2,3,4,3,2,1];
const atlas=[];
const entries={};
const ff=(...args)=>execFileSync('ffmpeg',['-y','-hide_banner','-loglevel','error',...args.map(String)]);
// Keep the character and held equipment, excluding arrows already in flight.
// A two-pixel bridge preserves antialiasing gaps in the thin bow/string.
function keepCharacter(data,w,h){
 let mask=new Uint8Array(w*h);
 for(let i=0;i<mask.length;i++)mask[i]=data[i*4+3]>32?1:0;
 for(let pass=0;pass<2;pass++){
  const expanded=mask.slice();
  for(let i=0;i<mask.length;i++)if(mask[i]){
   const x=i%w;
   if(x)expanded[i-1]=1;if(x<w-1)expanded[i+1]=1;
   if(i>=w)expanded[i-w]=1;if(i+w<mask.length)expanded[i+w]=1;
  }
  mask=expanded;
 }
 const labels=new Int32Array(w*h),queue=new Int32Array(w*h);
 let id=0,best=0,size=0;
 for(let start=0;start<mask.length;start++){
  if(!mask[start]||labels[start])continue;
  id++;let tail=1,head=0;queue[0]=start;labels[start]=id;
  const add=i=>{if(mask[i]&&!labels[i]){labels[i]=id;queue[tail++]=i;}};
  while(head<tail){
   const i=queue[head++],x=i%w;
   if(x)add(i-1);if(x<w-1)add(i+1);if(i>=w)add(i-w);if(i+w<mask.length)add(i+w);
  }
  if(tail>size){size=tail;best=id;}
 }
 for(let i=0;i<labels.length;i++)if(labels[i]!==best)data[i*4+3]=0;
}
for (let view=0;view<base.length;view++){
 const name=base[view];
 const video=join(here,name,'generated.mp4');
 if(!existsSync(video))throw new Error(`Missing final video: ${video}`);
 const frames=join(here,name,'export-frames');mkdirSync(frames,{recursive:true});
 ff('-i',video,'-vf','fps=12','-frames:v',28,join(frames,'raw-%02d.png'));
 const names=readdirSync(frames).filter(n=>/^raw-\d+\.png$/.test(n)).sort();
 if(names.length!==28)throw new Error(`${name}: expected 28 frames, got ${names.length}`);
 const source=[];
 for(const n of names){
  const {data,info}=await sharp(join(frames,n)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let sx=0,count=0,bottom=0;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
   const i=(y*info.width+x)*4;
   const r=data[i],g=data[i+1],b=data[i+2];
   const m=Math.min(r,b)-g;
   const alpha=m>150?0:m>70?Math.round(255*(1-(m-70)/80)):255;
   data[i+3]=alpha;
   if(alpha<255){data[i]=Math.min(r,g+40);data[i+2]=Math.min(b,g+40);}
   if(alpha>180){bottom=Math.max(bottom,y);if(y<145){sx+=x;count++;}}
  }
  if(!count)throw new Error(`${name}/${n}: no head pixels`);
  keepCharacter(data,info.width,info.height);
  source.push({data,info,head:sx/count,bottom});
 }
 // Anchor to the first idle pose; the raised bow must not shift the character.
 const hx=source[0].head,ground=source[0].bottom;
 const sheet=[];
 for(let i=0;i<source.length;i++){
  const {data,info}=source[i];
  const resized=await sharp(data,{raw:info}).resize(272,272).png().toBuffer();
  const color=await sharp({create:{width:320,height:320,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
   .composite([{input:resized,left:Math.round(160-hx*.5),top:Math.round(290-ground*.5)}]).png().toBuffer();
  await sharp(color).toFile(join(frames,`color-${String(i).padStart(2,'0')}.png`));
  const gray=await sharp(color).resize(112,112).grayscale().png().toBuffer();
  sheet.push({input:gray,left:i*112,top:0});
 }
 const row=await sharp({create:{width:28*112,height:112,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(sheet).png().toBuffer();
 await sharp(row).toFile(join(output,`shoot-${name}.png`));
 atlas.push({input:row,left:0,top:view*112});
 for(let dir=0;dir<8;dir++){
  if(views[dir]!==view)continue;
  const flip=dir>=5;
  ff('-framerate',12,'-i',join(frames,'color-%02d.png'),'-filter_complex',`${flip?'hflip,':''}split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128`,'-loop',0,join(output,`shoot-${directions[dir]}.gif`));
  entries[directions[dir]]={screenDir:dir,row:view,flip};
 }
 console.log(`Packaged ${name}: 28 frames`);
}
await sharp({create:{width:28*112,height:5*112,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(atlas).png().toFile(join(output,'ranger-shoot.png'));
writeFileSync(join(output,'manifest.json'),JSON.stringify({image:'ranger-shoot.png',fps:12,frameCount:28,frameWidth:112,frameHeight:112,storedScale:3,anchorX:.5,anchorY:290/320,loop:false,projectileTravelIncluded:false,rows:base,directions:entries,status:'Candidate assets; renderer and projectile timing integration pending'},null,2)+'\n');
