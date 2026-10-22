/** Export the two reviewed damage states, HF fire loops, collapse clips and emitters. */
import sharp from 'sharp';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { ff, probe } from './ffmpeg.mjs';

const root = new URL('../../../', import.meta.url).pathname;
const dir = `${root}assets/animations/buildings/castle/damage-stages`;
const out = `${root}assets/sprites/castle`;
const prepare = process.argv.includes('--prepare');
const width = 1107, height = 1421;
// Original castle: 374x480 centered on 544, crop 392x508 -> 180x234 stored pixels.
const sourceAnchor = { x: width / 2, y: (20 + 437 - 32) / 480 * height };
const gameScale = 480 / height * 234 / 508;
const h = 380, w = Math.round(width * h / height);
const left = Math.round(272 - w / 2), top = Math.round(400 - sourceAnchor.y / height * h);
const size = Math.ceil(544 * gameScale / (h / height));
const layout = { sourceWidth: width, sourceHeight: height, sourceAnchor, referenceWidth: 544, referenceHeight: 544,
  left, top, w, h, frameWidth: size, frameHeight: size, storedScale: 3,
  anchorX: (left + sourceAnchor.x / width * w) / 544, anchorY: (top + sourceAnchor.y / height * h) / 544 };
const warm = (r,g,b) => r > b + 35 && r > g + 12 && g > b + 8;

function groups(pixels, inputWidth=width, inputHeight=height) {
  const reference=inputWidth===544;
  const mask = new Uint8Array(inputWidth * inputHeight);
  for(let p=0;p<mask.length;p++) { const i=p*4; mask[p] = pixels[i+3]>128 && warm(pixels[i],pixels[i+1],pixels[i+2]) ? 1 : 0; }
  const found=[];
  for(let p=0;p<mask.length;p++) {
    if(!mask[p])continue;
    const queue=[p];mask[p]=0;let minX=inputWidth,minY=inputHeight,maxX=0,maxY=0;
    for(let q=0;q<queue.length;q++) {
      const at=queue[q],x=at%inputWidth,y=Math.floor(at/inputWidth);
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      for(const n of [x>0?at-1:-1,x<inputWidth-1?at+1:-1,y>0?at-inputWidth:-1,y<inputHeight-1?at+inputWidth:-1]) {
        if(n>=0&&mask[n]){mask[n]=0;queue.push(n);}
      }
    }
    if(queue.length>(reference?8:90))found.push({count:queue.length,minX,minY,maxX,maxY});
  }
  // Merge nearby colored fragments into the same physical fire site.
  const merged=[];
  for(const g of found.sort((a,b)=>b.count-a.count)) {
    const mx=reference?15:55,my=reference?19:70;
    const target=merged.find(a=>g.minX<a.maxX+mx&&g.maxX>a.minX-mx&&g.minY<a.maxY+my&&g.maxY>a.minY-my);
    if(target){target.count+=g.count;target.minX=Math.min(target.minX,g.minX);target.maxX=Math.max(target.maxX,g.maxX);target.minY=Math.min(target.minY,g.minY);target.maxY=Math.max(target.maxY,g.maxY);}
    else merged.push({...g});
  }
  return merged.sort((a,b)=>a.minY-b.minY).map((g,i)=>{
    const x=(g.minX+g.maxX)/2,y=g.maxY-4;
    return {id:`fire-${i+1}`,coordinateSpace:reference?'reference':'source',sourceX:x,sourceY:y,sourceBounds:{x:g.minX,y:g.minY,width:g.maxX-g.minX+1,height:g.maxY-g.minY+1},
      pixelCount:g.count, x:((reference?x:left+x/width*w)-layout.anchorX*544)*size/544/3,
      y:((reference?y:top+y/height*h)-layout.anchorY*544)*size/544/3,
      radius:Math.max(.8,(g.maxX-g.minX)*(reference?1:w/width)*size/544/3*.35)};
  });
}
// Alpha from the magenta screen behind the generated frames.
const screen=(r,g,b)=>{const chroma=Math.min(r,b)-g;return chroma>45?0:chroma>15?Math.round(255*(45-chroma)/30):255;};
// Material stays grayscale; flames are grayscale heat, tinted by the fire key in game.
function keyMaterial(data) {
  for(let i=0;i<data.length;i+=4) {
    const [r,g,b]=[data[i],data[i+1],data[i+2]];
    data[i]=data[i+1]=data[i+2]=g;data[i+3]=screen(r,g,b);
  }
  return data;
}
function keyFire(data) {
  for(let i=0;i<data.length;i+=4) {
    const [r,g,b]=[data[i],data[i+1],data[i+2]];
    data[i+3]=screen(r,g,b)&&warm(r,g,b)?255:0;data[i]=data[i+1]=data[i+2]=Math.max(r,g,b);
  }
  return data;
}
async function scaled(data) {
  const pixels=await sharp(data,{raw:{width:544,height:544,channels:4}}).resize(size,size).raw().toBuffer();
  for(let i=3;i<pixels.length;i+=4) if(pixels[i]<=8)pixels[i]=0;
  return sharp(pixels,{raw:{width:size,height:size,channels:4}}).png().toBuffer();
}
async function atlas(name,cells,loop) {
  const columns=Math.min(7,cells.length),rows=Math.ceil(cells.length/columns);
  await sharp({create:{width:size*columns,height:size*rows,channels:4,background:'#00000000'}})
    .composite(cells.map((input,i)=>({input,left:i%columns*size,top:Math.floor(i/columns)*size}))).png().toFile(`${out}/${name}.png`);
  return {image:`${name}.png`,fps:12,frameCount:cells.length,columns,frameWidth:size,frameHeight:size,storedScale:3,
    anchorX:layout.anchorX,anchorY:layout.anchorY,loop,rows:['se']};
}

await mkdir(out,{recursive:true});
const previousMapping=await readFile(`${out}/fire-pixels.json`,'utf8').then(JSON.parse,()=>({}));
const emitters={layout,stages:{},collapses:prepare?(previousMapping.collapses??{}):{}};
let manifest=JSON.parse(await readFile(`${out}/manifest.json`,'utf8'));
for(const stage of ['healthy',25,50]) {
  const source=await readFile(stage==='healthy'?`${dir}/../source.png`:`${dir}/destruction-${stage}.png`);
  const sourcePixels=await sharp(source).ensureAlpha().raw().toBuffer();
  const fires=groups(sourcePixels);if(stage!=='healthy')emitters.stages[String(stage)]=fires;
  if(prepare) {
    for(const action of (stage==='healthy'?['death']:['fire','death'])) {
      const folder=`${dir}/${action}-${stage}`;await mkdir(folder,{recursive:true});
      // Prepared endpoints are reviewed source art. Never overwrite them on reruns.
      if(await access(`${folder}/reference.png`).then(()=>true,()=>false)) {
        console.log(`${action}-${stage}: existing reviewed reference preserved`);
        continue;
      }
      await sharp({create:{width:544,height:544,channels:3,background:'#ff00ff'}})
        .composite([{input:await sharp(source).resize(w,h).png().toBuffer(),left,top}]).png().toFile(`${folder}/reference.png`);
      await writeFile(`${folder}/reference-layout.json`,JSON.stringify(layout,null,2)+'\n');
      if(action==='death') {
        // Prefer the current imagegen endpoint over legacy generated rubble.
        const reviewedEndpoint = `${dir}/rubble-aoe-v2-reference.png`;
        if(await access(reviewedEndpoint).then(()=>true,()=>false)) {
          await writeFile(`${folder}/last-reference.png`,await readFile(reviewedEndpoint));
          continue;
        }
        // The healthy source uses the same reviewed compact endpoint as the mild stage.
        if(stage==='healthy') {
          await writeFile(`${folder}/last-reference.png`,await readFile(`${dir}/death-25/last-reference.png`));
          continue;
        }
        const old=JSON.parse(await readFile(`${root}assets/animations/buildings/collapse/castle/reference-layout.json`,'utf8'));
        const oldSize=Math.ceil(544/old.scale),ratio=oldSize/size;
        const endpoint=await sharp(`${root}assets/animations/buildings/collapse/castle/frames/26.png`).ensureAlpha().raw().toBuffer();
        const pixels=Buffer.alloc(544*544*4);
        for(let y=0;y<544;y++)for(let x=0;x<544;x++) {
          const at=(y*544+x)*4;
          const ox=Math.round(old.anchorX*544+(x-layout.anchorX*544)/ratio);
          const oy=Math.round(old.anchorY*544+(y-layout.anchorY*544)/ratio);
          if(ox>=0&&oy>=0&&ox<544&&oy<544)endpoint.copy(pixels,at,(oy*544+ox)*4,(oy*544+ox)*4+4);
          else {pixels[at]=255;pixels[at+2]=255;pixels[at+3]=255;}
        }
        await sharp(pixels,{raw:{width:544,height:544,channels:4}}).png().toFile(`${folder}/last-reference.png`);
      }
    }
    console.log(`${stage}%: reference ready, ${fires.length} mapped fire sites`);
    continue;
  }
  // Keep the reviewed stonework fixed. Warm pixels become dark cavity material;
  // flame pixels outside the original solid silhouette stay transparent.
  const body=Buffer.from(sourcePixels);
  for(let i=0;i<body.length;i+=4) {
    const hot=warm(body[i],body[i+1],body[i+2]);
    const gray=hot?body[i+2]:Math.round((body[i]+body[i+1]+body[i+2])/3);
    if(hot)body[i+3]=0;
    body[i]=body[i+1]=body[i+2]=gray;
  }
  const material=await sharp({create:{width:544,height:544,channels:4,background:'#00000000'}})
    .composite([{input:await sharp(body,{raw:{width,height,channels:4}}).resize(w,h).png().toBuffer(),left,top}]).raw().toBuffer();
  if(stage!=='healthy')manifest[`damaged${stage}`]=await atlas(`castle-damaged-${stage}`,[await scaled(material)],false);
  for(const action of (stage==='healthy'?['death']:['fire','death'])) {
    const folder=`${dir}/${action}-${stage}`;await mkdir(`${folder}/frames`,{recursive:true});
    const {duration}=probe(`${folder}/generated.mp4`);
    // Inward collapses start at the battlements. Preserve the whole top-to-bottom motion.
    const trim=0;
    ff('-ss',String(trim),'-i',`${folder}/generated.mp4`,'-vf',`fps=${28/(duration-trim)},scale=544:544`,'-frames:v','28',`${folder}/frames/%02d.png`);
    const cells=[],fireCells=[],tracks=[];
    for(let f=1;f<=28;f++) {
      const raw=await sharp(`${folder}/frames/${String(f).padStart(2,'0')}.png`).ensureAlpha().raw().toBuffer();
      const frame=(action==='fire'?keyFire:keyMaterial)(Buffer.from(raw));
      if(action==='death') {
        tracks.push(groups(raw,544,544));
        fireCells.push(await scaled(keyFire(Buffer.from(raw))));
        for(let i=0;i<frame.length;i+=4)if(warm(raw[i],raw[i+1],raw[i+2]))frame[i+3]=0;
      }
      if(action==='fire') {
        // Restrict generated fire to source fire sites with room for rising sparks.
        for(let y=0;y<544;y++)for(let x=0;x<544;x++) {
          if(!fires.some(g=>x>=left+(g.sourceBounds.x-75)/width*w&&x<=left+(g.sourceBounds.x+g.sourceBounds.width+75)/width*w
            &&y>=top+(g.sourceBounds.y-160)/height*h&&y<=top+(g.sourceBounds.y+g.sourceBounds.height+20)/height*h))frame[(y*544+x)*4+3]=0;
        }
      }
      cells.push(await scaled(frame));
    }
    if(action==='death') {
      cells[0]=await scaled(material);
      cells[26]=cells[27];
      fireCells[0]=await scaled(keyFire(await sharp(`${folder}/reference.png`).ensureAlpha().raw().toBuffer()));
      fireCells[26]=fireCells[27];tracks[0]=fires;tracks[26]=tracks[27];
      if(stage!=='healthy') {
        manifest[`deathFire${stage}`]=await atlas(`castle-death-fire-${stage}`,fireCells,false);
        emitters.collapses[String(stage)]=tracks;
      }
    }
    const suffix=stage==='healthy'?'':String(stage);
    manifest[`${action}${suffix}`]=await atlas(stage==='healthy'?'castle-death':`castle-${action}-${stage}`,cells,action==='fire');
    await mkdir(`${folder}/sprite-frames`,{recursive:true});
    for(let f=0;f<cells.length;f++)await writeFile(`${folder}/sprite-frames/${String(f).padStart(2,'0')}.png`,cells[f]);
    ff('-framerate','12','-i',`${folder}/sprite-frames/%02d.png`,'-filter_complex','split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=64',`${folder}/sprite-preview.gif`);
    console.log(`${action}-${stage}: 28 frames exported`);
  }
}
await writeFile(`${dir}/fire-pixels.json`,JSON.stringify(emitters,null,2)+'\n');
await writeFile(`${out}/fire-pixels.json`,JSON.stringify(emitters,null,2)+'\n');
if(!prepare)await writeFile(`${out}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
