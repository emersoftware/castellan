// Publish reviewed Knight/King/Worker animation exports. Archer has its own release markers.
// node packages/web/scripts/unit-animations.mjs
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const availableOnly=process.argv.includes('--available');
const selectedKind=process.argv.find(arg=>arg.startsWith('--kind='))?.split('=')[1];
if(selectedKind&&!['knight','king','worker'].includes(selectedKind)) throw new Error('Unknown --kind');
const root=resolve(import.meta.dirname,'../../..');
// Reviewed contact poses, zero-based at 12 fps: S, SE, E, NE, N.
const impacts={knight:[6,9,6,8,11]};
for(const [kind,actions] of [['knight',['idle','walk','attack','death']],['king',['idle','walk','attack','death']],['worker',['idle','walk','mine','attack','death']]]){
  if(selectedKind&&kind!==selectedKind)continue;
  const out=resolve(root,'packages/web/public/sprites',kind);
  mkdirSync(out,{recursive:true});
  const previous=existsSync(resolve(out,'manifest.json'))?JSON.parse(readFileSync(resolve(out,'manifest.json'),'utf8')):{};
  const manifest={};
  for(const action of actions){
    const source=resolve(root,`assets/animations/${kind}/${action}-directions/export`);
    if(!existsSync(resolve(source,'manifest.json')) && !previous[action])continue;
    if(availableOnly&&!existsSync(resolve(source,'manifest.json'))){
      manifest[action]={...previous[action],available:false};
      continue;
    }
    const {status,...meta}=JSON.parse(readFileSync(resolve(source,'manifest.json'),'utf8'));
    copyFileSync(resolve(source,meta.image),resolve(out,meta.image));
    manifest[action]={...meta,...(action==='attack'?{impactFrames:impacts[kind] ?? JSON.parse(readFileSync(resolve(root,`assets/animations/${kind}/attack-directions/impact-frames.json`),'utf8'))}:{})};
  }
  writeFileSync(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
}
