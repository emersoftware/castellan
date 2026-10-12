// Distribution copies only: source art/music remains untouched in public/ and assets/.
import { readdir, readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { buildHeroSprites } from './hero-assets.mjs';
const root = resolve(import.meta.dirname, '../public');
const out = resolve(root, 'game-assets');
const kinds = ['archer','knight','king','worker','castle','tower','wall','wallpost','door','door-open','wall-door-left','wall-door-right','wall-door-both'];
const inputs = ['sprites/manifest.json', ...kinds.map(k => `sprites/${k}/manifest.json`)];
for (const path of [...inputs]) {
  const m = JSON.parse(await readFile(resolve(root,path),'utf8'));
  if (m.sprites) for (const [name,v] of Object.entries(m.sprites)) inputs.push(`sprites/${name}.${v.format ?? 'png'}`);
  else for (const v of Object.values(m)) if (v.available !== false) inputs.push(`sprites/${path.split('/')[1]}/${v.image}`);
}
// Static portrait files that are not renderer entries.
for (const name of ['mineral.png','door.svg']) if (!inputs.includes(`sprites/${name}`)) inputs.push(`sprites/${name}`);
for (const track of ['theme','battle']) inputs.push(`music/${track}.mp3`,`music/${track}.json`);
const hash = createHash('sha256').update(await readFile(new URL(import.meta.url)));
hash.update(await readFile(new URL('./hero-assets.mjs', import.meta.url)));
for (const path of inputs) hash.update(path).update(await readFile(resolve(root,path)));
const signature = hash.digest('hex');
let cached; try { cached=JSON.parse(await readFile(resolve(out,'build.json'),'utf8')); } catch {}
let heroReady = false;
try {
  for (const path of ['manifest.json', ...kinds.map(kind => `${kind}/manifest.json`)]) {
    const m = JSON.parse(await readFile(resolve(out, 'hero-sprites', path), 'utf8'));
    const images = m.sprites ? Object.keys(m.sprites).map(name => `${name}.webp`)
      : Object.values(m).filter(v => v.available !== false).map(v => `${path.split('/')[0]}/${v.image}`);
    await Promise.all(images.map(image => stat(resolve(out, 'hero-sprites', image))));
  }
  heroReady = true;
} catch {}
if (cached?.signature === signature) {
  // Full-size art/music is checked in. A clean checkout lacks only the ignored
  // hero copies; generating those must not require an audio encoder in CI.
  if (!heroReady) {
    const heroBytes = await buildHeroSprites(resolve(root, 'sprites'), resolve(out, 'hero-sprites'), kinds);
    await writeFile(resolve(out, 'build.json'), JSON.stringify({ ...cached, heroBytes }, null, 2));
    console.log(`Generated hero sprites: ${heroBytes} bytes`);
  } else console.log('Runtime assets up to date');
  process.exit(0);
}
await mkdir(out,{recursive:true});
let before=0, after=0;
for (const path of new Set(inputs)) {
  const from=resolve(root,path); let target=resolve(out,path); await mkdir(dirname(target),{recursive:true});
  before+=(await stat(from)).size;
  if (path.endsWith('.png')) {
    target=target.replace(/\.png$/,'.webp');
    // 3x art already matches max camera zoom. Preserve all visible pixels and anchors.
    await sharp(from).webp({lossless:true,effort:6}).toFile(target);
  } else if (path.endsWith('.mp3')) {
    execFileSync('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',from,'-c:a','libmp3lame','-b:a','64k','-ar','32000',target]);
  } else if (path.endsWith('.json')) {
    const m=JSON.parse(await readFile(from,'utf8'));
    if (m.sprites) for (const v of Object.values(m.sprites)) if (!v.format) v.format='webp';
    if (!m.sprites) for (const v of Object.values(m)) if (v && typeof v==='object' && v.image) v.image=v.image.replace(/\.png$/,'.webp');
    await writeFile(target,JSON.stringify(m));
  } else await copyFile(from,target);
  after+=(await stat(target)).size;
}
const heroBytes = await buildHeroSprites(resolve(root, 'sprites'), resolve(out, 'hero-sprites'), kinds);
await writeFile(resolve(out,'build.json'),JSON.stringify({signature,before,after,heroBytes},null,2));
console.log(JSON.stringify({before,after,heroBytes,savedPercent:Math.round((1-after/before)*100)}));
