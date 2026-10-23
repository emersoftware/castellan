// @ts-check
// Publish the reviewed animation exports, retaining per-view release markers.
// Run from any directory: node packages/web/scripts/archer-animations.mjs
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { artFolder } from './art-sources.mjs';
/** @import { EntityKind } from '../../shared/src/ruleset.ts' */
const root = resolve(import.meta.dirname, '../../..');
/** @type {EntityKind} */
const kind = 'archer';
const art = artFolder(kind);
const out = resolve(root, `assets/sprites/${kind}`);
mkdirSync(out, { recursive: true });
const manifest = {};
for (const action of ['idle', 'walk', 'shoot', 'death']) {
  const source = resolve(root, `assets/animations/${art}/${action}-directions/export`);
  if(action === 'death' && !existsSync(resolve(source, 'manifest.json'))) continue;
  const { status, ...meta } = JSON.parse(readFileSync(resolve(source, 'manifest.json'), 'utf8'));
  const image = meta.image.replaceAll(art, kind);
  copyFileSync(resolve(source, meta.image), resolve(out, image));
  manifest[action] = { ...meta, image, ...(action === 'shoot' ? { releaseFrames: [14, 18, 19, 18, 16] } : {}) };
}
writeFileSync(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
