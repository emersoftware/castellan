// @ts-check
// Publish reviewed Knight/King/Worker/Wizard animation exports. Archer has its own release markers.
// node packages/web/scripts/unit-animations.mjs
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
/** @import { EntityKind } from '../../shared/src/ruleset.ts' */
const availableOnly=process.argv.includes('--available');
const selectedKind=process.argv.find(arg=>arg.startsWith('--kind='))?.split('=')[1];
/** @type {[EntityKind, string[]][]} */
const units=[['knight',['idle','walk','attack','death']],['king',['idle','walk','attack','death']],['worker',['idle','walk','mine','attack','death']],['wizard',['idle','walk','heal','hack','convert','death']]];
if(selectedKind&&!units.some(([kind])=>kind===selectedKind)) throw new Error('Unknown --kind');
const root=resolve(import.meta.dirname,'../../..');
// Reviewed contact poses, zero-based at 12 fps: S, SE, E, NE, N.
const impacts={knight:[6,9,6,8,11]};
// Display size relative to the export, where a character's exports disagree with the others' shared scale.
// The Wizard's idle reached 27.8 screen pixels against 24.2-25.5 for Archer, Knight and King, with matching shoulders:
// at 0.92 its pointed hood still tops the King's crown slightly (wizard README, "Game scale").
const sizeFactors={wizard:0.92};
// Rows generated facing the opposite diagonal publish their mirror swapped. Every Wizard SE row faces SW (its hood tip
// and the drape of its robe point back toward the upper right, unlike its E and NE rows), so SW draws it plain and SE
// mirrored.
const swappedMirrors={wizard:['se','sw']};
// A casting clip's export carries cast-points.json: its staff crystal per row and frame, in stored pixels of a cell,
// and the reviewed frames where it flares. The renderer sends particles from there, in step with the gesture.
for(const [kind,actions] of units){
  if(selectedKind&&kind!==selectedKind)continue;
  const out=resolve(root,'assets/sprites',kind);
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
    const points=existsSync(resolve(source,'cast-points.json'))?JSON.parse(readFileSync(resolve(source,'cast-points.json'),'utf8')):undefined;
    for(const direction of swappedMirrors[kind]??[])meta.directions[direction]={...meta.directions[direction],flip:!meta.directions[direction].flip};
    if(points&&(JSON.stringify(points.rows)!==JSON.stringify(meta.rows)||points.frameCount!==meta.frameCount))throw new Error(`${kind} ${action}: cast points do not match the atlas`);
    copyFileSync(resolve(source,meta.image),resolve(out,meta.image));
    manifest[action]={...meta,...(sizeFactors[kind]?{sizeFactor:sizeFactors[kind]}:{}),...(points?{castPoints:{crystal:points.crystal,pulses:points.pulses}}:{}),...(action==='attack'?{impactFrames:impacts[kind] ?? JSON.parse(readFileSync(resolve(root,`assets/animations/${kind}/attack-directions/impact-frames.json`),'utf8'))}:{})};
  }
  writeFileSync(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
}
