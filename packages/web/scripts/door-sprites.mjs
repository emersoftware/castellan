// @ts-check
// Keep the wall's masonry and ground anchor; leave a real opening between neighbours.
import { readFile, writeFile } from 'node:fs/promises';
/** @import { ClipArt } from '../src/render/clips.ts' */
const base = new URL('../../../assets/sprites/', import.meta.url);
const wall = (await readFile(new URL('wall.png', base))).toString('base64');
const opening = 'M30 114V88Q30 75 45 73Q60 75 60 88V114Z';
const wallImage = `<image width="103" height="108" href="data:image/png;base64,${wall}"`;
for (const open of [false, true]) {
  const bars = [34, 41, 48, 55].map(x => `<path d="M${x} 72V${open ? 85 : 114}"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="103" height="108" viewBox="0 0 103 108">
<defs>
  <mask id="masonry" maskUnits="userSpaceOnUse" x="0" y="0" width="103" height="108"><rect width="103" height="108" fill="white"/><path d="${opening}" transform="matrix(1 -.5 0 1 0 0)" fill="black"/></mask>
  <clipPath id="passage"><path d="${opening}"/></clipPath>
</defs>
${wallImage} mask="url(#masonry)"/>
<g transform="matrix(1 -.5 0 1 0 0)">
  <path d="M29 114V88Q29 74 45 72Q61 74 61 88V114" fill="none" stroke="#727272" stroke-width="2"/>
  <g clip-path="url(#passage)">
    <path d="M31 114V88Q31 77 45 75Q59 77 59 88V114" fill="none" stroke="#333" stroke-width="2"/>
    <g fill="none" stroke="#bcbcbc" stroke-width="2.3">${bars}<path d="M30 81H60${open ? '' : 'M30 95H60M30 108H60'}"/></g>
  </g>
</g>
</svg>\n`;
  await writeFile(new URL(open ? 'door-open.svg' : 'door.svg', base), svg);
}
// Original wall art spans almost two cells. Trim only ends that meet a door,
// otherwise the next wall paints over the passage (in both colour and depth).
for (const side of ['left', 'right', 'both']) {
  const x = side === 'right' ? 0 : 20;
  const end = side === 'left' ? 103 : 68;
  await writeFile(new URL(`wall-door-${side}.svg`, base), `<svg xmlns="http://www.w3.org/2000/svg" width="103" height="108"><defs><clipPath id="end"><rect x="${x}" width="${end-x}" height="108"/></clipPath></defs>${wallImage} clip-path="url(#end)"/></svg>\n`);
}
const path = new URL('manifest.json', base);
const manifest = JSON.parse(await readFile(path, 'utf8'));
/** @type {ClipArt[]} */
const pieces = ['door', 'door-open', 'wall-door-left', 'wall-door-right', 'wall-door-both'];
for (const kind of pieces) manifest.sprites[kind] = { ...manifest.sprites.wall, format: 'svg' };
await writeFile(path, JSON.stringify(manifest, null, 1) + '\n');
