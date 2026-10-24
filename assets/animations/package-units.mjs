/** Build portable 8-direction previews and the 5-view sprite atlas. */
import {createRequire} from 'node:module';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdirSync,readdirSync,writeFileSync,existsSync,readFileSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const [kind,action]=process.argv.slice(2);
const requestedDirection=process.argv.find(arg=>arg.startsWith('--direction='))?.split('=')[1];
if(requestedDirection&&!/^(s|se|e|ne|n)$/.test(requestedDirection))throw new Error('Unknown --direction');
if(!['knight','king','ranger','worker','wizard'].includes(kind)||!['idle','walk','attack','death','mine','heal','hack','convert'].includes(action)||action==='convert'&&kind!=='wizard')throw new Error('Usage: node assets/animations/package-units.mjs knight|king|ranger|worker|wizard idle|walk|attack|death|mine|heal|hack|convert');
const here=join(root,'assets/animations',kind,`${action}-directions`);
const sharp=createRequire(join(root,'packages/web/package.json'))('sharp');
const output=join(here,requestedDirection?`export-${requestedDirection}`:'export');
mkdirSync(output,{recursive:true});
// Fallen hands/equipment can extend below the standing ground line. Preserve
// the same 0.35 raster scale and ground position, with extra transparent space.
const canvasHeight=action==='death'?340:320;
const frameHeight=canvasHeight*112/320;
const base=['s','se','e','ne','n'];
const directions=['s','se','e','ne','n','nw','w','sw'];
const views=[0,1,2,3,4,3,2,1];
const atlas=[];
const entries={};
const settingsPath=join(here,'export-settings.json');
const settings=existsSync(settingsPath)?JSON.parse(readFileSync(settingsPath,'utf8')):{};
const ff=(...args)=>execFileSync('ffmpeg',['-y','-hide_banner','-loglevel','error',...args.map(String)]);
// Keep the character and held equipment, excluding disconnected generation debris.
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
 const video=join(here,name,...(action==='walk'?['continuous']:[]),'generated.mp4');
 if(requestedDirection&&name!==requestedDirection)continue;
 if(!existsSync(video))throw new Error(`Missing final video: ${video}`);
 const frames=join(here,name,'export-frames');mkdirSync(frames,{recursive:true});
 for(const old of readdirSync(frames).filter(n=>/^raw-\d+\.png$/.test(n)))unlinkSync(join(frames,old));
 ff('-i',video,'-vf','fps=12',...(action==='death'?[]:['-frames:v',28]),join(frames,'raw-%02d.png'));
 const names=readdirSync(frames).filter(n=>/^raw-\d+\.png$/.test(n)).sort();
 if(action!=='death'&&names.length!==28||!names.length)throw new Error(`${name}: invalid frame count ${names.length}`);
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
   if(alpha>180){bottom=Math.max(bottom,y);if(y<(kind==='worker'?195:145)){sx+=x;count++;}}
  }
  if(!count&&source.length===0)throw new Error(`${name}/${n}: no initial head pixels`);
  keepCharacter(data,info.width,info.height);
  // Padding in the atlas cannot recover a limb already clipped in the video.
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
   if((!x||!y||x===info.width-1||y===info.height-1)&&data[(y*info.width+x)*4+3]>180)
    throw new Error(`${name}/${n}: character touches source boundary; fix the reference before exporting`);
  }
  source.push({data,info,head:sx/count,bottom});
 }
 // Keep one fixed translation per clip; do not erase breathing or steps.
 const hx=source[0].head,ground=source[0].bottom;
 // Remove reviewed leading hesitation from deaths; keep the original ground
 // alignment and extend the fallen endpoint instead of looping the collapse.
 const start=action==='death'?(settings.startFrames?.[name]??0):0;
 if(!Number.isInteger(start)||start<0||start>=source.length)throw new Error(`${name}: invalid start frame ${start}`);
 const trimmed=source.slice(start,settings.endFrames?.[name]??source.length);
 const selected=trimmed.length>28?Array.from({length:28},(_,i)=>trimmed[Math.round(i*(trimmed.length-1)/27)]):trimmed;
 while(selected.length<28)selected.push(selected.at(-1));
 // Conditioning matches both endpoints; make the exported casting loop exact too.
 if(kind==='wizard'&&['heal','hack','convert'].includes(action))selected[27]=selected[0];
 const sheet=[];
 for(let i=0;i<selected.length;i++){
  const {data,info}=selected[i];
  const pixelScale=.5/(settings.referenceScale?.[name]??1);
  let resized=await sharp(data,{raw:info}).resize(Math.round(info.width*pixelScale),Math.round(info.height*pixelScale)).png().toBuffer();
  let left=Math.round(160-hx*pixelScale),top=Math.round(290-ground*pixelScale);
  if(kind==='wizard'&&['heal','hack','convert'].includes(action)){
   // Smaller references leave overhead room; discard only transparent padding
   // before composition, retaining the fixed translation and every visible pixel.
   const {data:rgba,info:size}=await sharp(resized).ensureAlpha().raw().toBuffer({resolveWithObject:true});
   let x0=size.width,y0=size.height,x1=0,y1=0;
   for(let y=0;y<size.height;y++)for(let x=0;x<size.width;x++)if(rgba[(y*size.width+x)*4+3]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
   left+=x0;top+=y0;
   if(left<0||top<0||left+x1-x0+1>320||top+y1-y0+1>canvasHeight)throw new Error(`${name}/${i}: casting leaves atlas cell; review reference and motion`);
   resized=await sharp(resized).extract({left:x0,top:y0,width:x1-x0+1,height:y1-y0+1}).png().toBuffer();
  }
  const color=await sharp({create:{width:320,height:canvasHeight,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
   .composite([{input:resized,left,top}]).png().toBuffer();
  await sharp(color).toFile(join(frames,`color-${String(i).padStart(2,'0')}.png`));
  const gray=await sharp(color).resize(112,frameHeight).grayscale().png().toBuffer();
  sheet.push({input:gray,left:i*112,top:0});
 }
 const row=await sharp({create:{width:28*112,height:frameHeight,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(sheet).png().toBuffer();
 await sharp(row).toFile(join(output,`${action}-${name}.png`));
 const exportedRow=atlas.length;
 atlas.push({input:row,left:0,top:exportedRow*frameHeight});
 for(let dir=0;dir<8;dir++){
  if(views[dir]!==view)continue;
  const flip=dir>=5;
  ff('-framerate',12,'-i',join(frames,'color-%02d.png'),'-filter_complex',`${flip?'hflip,':''}split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128`,'-loop',0,join(output,`${action}-${directions[dir]}.gif`));
  entries[directions[dir]]={screenDir:dir,row:exportedRow,flip};
 }
 console.log(`Packaged ${name}: 28 frames`);
}
const exportedViews=requestedDirection?[requestedDirection]:base;
await sharp({create:{width:28*112,height:exportedViews.length*frameHeight,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(atlas).png().toFile(join(output,`${kind}-${action}.png`));
writeFileSync(join(output,'manifest.json'),JSON.stringify({image:`${kind}-${action}.png`,fps:12,frameCount:28,frameWidth:112,frameHeight,storedScale:3,anchorX:.5,anchorY:290/canvasHeight,loop:!['attack','death'].includes(action),rows:exportedViews,directions:entries,status:requestedDirection?'Partial pilot; not for publishing':'Generated; inspect previews before publishing'},null,2)+'\n');

const exportFolder=requestedDirection?`export-${requestedDirection}`:'export';
const cells=directions.filter(d=>entries[d]).map(d=>`<figure><img src="${exportFolder}/${action}-${d}.gif"/><figcaption>${d.toUpperCase()}</figcaption></figure>`).join('');
writeFileSync(join(here,requestedDirection?`index-${requestedDirection}.html`:'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><title>${kind} ${action}</title><style>body{background:#191b22;color:#eee;font:18px system-ui;padding:24px}main{display:grid;grid-template-columns:repeat(4,1fr)}figure{margin:8px;text-align:center}img{width:100%;max-width:320px;background:#292e39}h1{text-transform:capitalize}</style><h1>${kind}: ${action}</h1><p>${requestedDirection?'Partial pilot; unavailable directions are omitted.':'Eight directions. Five generated views plus three mirrored views.'}</p><main>${cells}</main></html>`);
