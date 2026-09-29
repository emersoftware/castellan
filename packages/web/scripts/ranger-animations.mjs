// Publish the reviewed animation exports, retaining per-view release markers.
// Run from any directory: node packages/web/scripts/ranger-animations.mjs
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../../..');
const out = resolve(root, 'packages/web/public/sprites/ranger');
mkdirSync(out, { recursive: true });
const manifest = {};
for (const action of ['idle', 'walk', 'shoot', 'death']) {
  const source = resolve(root, `assets/animations/ranger/${action}-directions/export`);
  if(action === 'death' && !existsSync(resolve(source, 'manifest.json'))) continue;
  const { status, ...meta } = JSON.parse(readFileSync(resolve(source, 'manifest.json'), 'utf8'));
  copyFileSync(resolve(source, meta.image), resolve(out, meta.image));
  manifest[action] = { ...meta, ...(action === 'shoot' ? { releaseFrames: [14, 18, 19, 18, 16] } : {}) };
}
writeFileSync(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
