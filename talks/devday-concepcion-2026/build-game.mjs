/** Bundle game.ts (the game's Pixi renderer + clip decoder) into game.js and copy the sprites it draws.
 *  Board clips are committed runtime assets under assets/clips/.
 *    node build-game.mjs            (from this folder or the repo root) */
import { createRequire } from 'node:module';
import { cpSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const require = createRequire(join(root, 'package.json'));
const tsxRequire = createRequire(require.resolve('tsx/package.json'));
const { build } = tsxRequire('esbuild');
// The landing's half-resolution set: the talk draws boards at 2 device pixels per canvas pixel.
cpSync(join(root, 'packages/web/public/game-assets/hero-sprites'), join(here, 'assets/sprites'), { recursive: true });
await build({
  entryPoints: [join(here, 'game.ts')], outfile: join(here, 'game.js'), bundle: true, format: 'iife', target: 'es2022',
  platform: 'browser', minify: true, sourcemap: false, legalComments: 'none', define: { 'process.env.NODE_ENV': '"production"' },
});
console.log(`Built game.js ${(statSync(join(here, 'game.js')).size / 1024).toFixed(0)} KB`);
