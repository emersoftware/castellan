// Verify the published assets, independently of the sprite exporter.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../../..');
const sharp=createRequire(root+'/packages/web/package.json')('sharp');
const expected={ranger:['idle','walk','shoot','death'],knight:['idle','walk','attack','death'],king:['idle','walk','attack','death'],worker:['idle','walk','mine','attack','death']};
let atlases=0,cells=0;
for(const [kind,actions] of Object.entries(expected)){
 const base=root+'/assets/sprites/'+kind;
 const manifest=JSON.parse(readFileSync(base+'/manifest.json'));
 for(const action of actions){
  const meta=manifest[action];assert.ok(meta&&meta.available!==false,kind+'/'+action);
  assert.equal(meta.rows.length,5);assert.equal(Object.keys(meta.directions).length,8);
  ['s','se','e','ne','n','nw','w','sw'].forEach((direction,index)=>{
   assert.deepEqual(meta.directions[direction],{screenDir:index,row:[0,1,2,3,4,3,2,1][index],flip:index>=5});
  });
  if(action==='attack'){assert.equal(meta.loop,false);assert.equal(meta.impactFrames.length,5);for(const marker of meta.impactFrames)assert.ok(Number.isInteger(marker)&&marker>=0&&marker<meta.frameCount);}
  if(action==='death'){assert.equal(meta.loop,false);assert.ok(Math.abs(meta.anchorY*meta.frameHeight-101.5)<1e-9,'preserve standing ground anchor');}
  const {data,info}=await sharp(base+'/'+meta.image).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,meta.frameCount*meta.frameWidth);assert.equal(info.height,5*meta.frameHeight);
  for(let row=0;row<5;row++)for(let frame=0;frame<meta.frameCount;frame++){
   let opaque=0,border=0;
   for(let y=0;y<meta.frameHeight;y++)for(let x=0;x<meta.frameWidth;x++){
    const offset=((row*meta.frameHeight+y)*info.width+frame*meta.frameWidth+x)*4;
    if(data[offset+3]>180){opaque++;if(!x||!y||x===meta.frameWidth-1||y===meta.frameHeight-1)border++;}
    if(action==='death'&&frame===meta.frameCount-1){
     const previous=offset-meta.frameWidth*4;
     for(let c=0;c<4;c++)assert.equal(data[offset+c],data[previous+c],'death endpoint must hold');
    }
   }
   assert.ok(opaque>20,`${kind}/${action}/${row}/${frame} is empty`);
   assert.equal(border,0,`${kind}/${action}/${row}/${frame} reaches atlas cell edge`);
   cells++;
  }
  atlases++;
 }
}
console.log(JSON.stringify({atlases,cells,checks:'all required actions, eight directions, dimensions, nonempty cells, transparent borders, held death endpoints'}));
