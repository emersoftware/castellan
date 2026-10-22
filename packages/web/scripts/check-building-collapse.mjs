// @ts-check
/** Actual Pixi/browser QA. Start the web dev server first. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { ff } from './ffmpeg.mjs';
/** @import { EntityKind } from '../../shared/src/ruleset.ts' */

const output = new URL('../../../assets/animations/buildings/collapse/review/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'], defaultViewport: { width: 1440, height: 960 } });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(/** @type {Error} */ (e).message));
  await page.goto(process.env.CASTELLAN_WEB_URL ?? 'http://127.0.0.1:5174', { waitUntil: 'networkidle0' });
  const rulesModule = `/@fs/${new URL('../../../packages/shared/src/rules.ts', import.meta.url).pathname}`;
  const review = await page.evaluateHandle(async (rulesModule) => {
    const rendererModule = '/src/render/renderer.ts'; // A Vite URL, not a file path.
    const { GameRenderer } = await import(rendererModule);
    const { rules } = await import(rulesModule);
    const host = document.createElement('div');
    host.id = 'collapse-qa';
    host.style.cssText = 'position:fixed;inset:0;background:black;z-index:100'; document.body.append(host);
    const renderer = await GameRenderer.create(host, { ...rules, map: { ...rules.map, width: 24, height: 24, walls: [], deposits: [], sharedDeposits: [] } },
      { a: 0, b: 1, c: 2, d: 3 }, { interactive: false });
    const clock = renderer.manualClock();
    /** @type {EntityKind[]} */
    const kinds = ['castle', 'tower', 'wall', 'door'];
    const entities = kinds.flatMap((kind, row) => ['a', 'b', 'c', 'd'].map((owner, col) => ({ id: `${kind}-${col}`, kind, owner,
      x: 3 + row * 3 + col * 3, y: 12 + row * 3 - col * 3, hp: 100, maxHp: 100 })));
    const neighbors = entities.filter(e => e.kind === 'wall').map(e => ({ ...e, id: `${e.id}-neighbor`, y: e.y + 1 }));
    const frame = (tick, alive = true) => ({ tick, timeMs: tick * 100, entities: alive ? [...entities, ...neighbors] : [],
      deposits: [], events: [], projectiles: [] });
    renderer.setFrame(frame(1), 100); clock.draw();
    const sprites = entities.map(e => renderer.drawn.get(e.id).sprite);
    const origins=sprites.map(s=>({x:s.x,y:s.y}));
    const layers=()=>sprites.map(s=>s.destroyed?null:s.parent);
    const die = () => renderer.setFrame({ ...frame(2, false), events: [...entities, ...neighbors].map(e => ({
      tick: 1, type: 'death', id: e.id, kind: e.kind, owner: e.owner, x: e.x, y: e.y,
    })) }, 100);
    return { renderer, clock, sprites, frame, die, origins,layers,step(ms) { clock.setTime(ms); clock.draw(); },
      cells() { return sprites.map((s,i) => s.destroyed ? { destroyed: true } : ({ frame: s.texture.frame.x / s.texture.frame.width + 7 * s.texture.frame.y / s.texture.frame.height, alpha: s.alpha, y:s.y,maskY:s.parent.mask?.y??null,groundY:origins[i].y,destroyed: false })); } };
  }, rulesModule);
  await page.screenshot({ path: `${output}/standing.png` });
  await page.evaluate(review => { review.die(); review.step(0); }, review);
  assert.ok((await page.evaluate(review => review.cells(), review)).every(c => c.frame === 0 && c.alpha === 1));
  await page.screenshot({ path: `${output}/start.png` });
  await page.evaluate(review => review.step(1000), review);
  assert.ok((await page.evaluate(review => review.cells(), review)).every(c => c.frame === 12 && c.alpha === 1));
  assert.ok((await page.evaluate(review => review.cells(), review)).every(c=>c.y===c.groundY&&c.maskY===null));
  await page.screenshot({ path: `${output}/collapse.png` });
  await page.evaluate(review => review.renderer.setPaused(true), review);
  await page.evaluate(review => review.step(9000), review);
  assert.ok((await page.evaluate(review => review.cells(), review)).every(c => c.frame === 12&&c.y===c.groundY&&c.maskY===null));
  await page.evaluate(review => { review.renderer.setPaused(false); review.step(11000); }, review);
  assert.ok((await page.evaluate(review => review.cells(), review)).every(c => c.frame === 27&&c.alpha===1&&c.y===c.groundY&&c.maskY===null));
  await page.screenshot({ path: `${output}/rubble.png` });
  await page.evaluate(review => review.step(12000), review);
  assert.ok((await page.evaluate(review => review.cells(), review)).every(c=>c.frame===27&&c.alpha>0&&c.alpha<1&&c.y===c.groundY&&c.maskY===null));
  await page.screenshot({ path: `${output}/fade-start.png` });
  await page.evaluate(review => review.step(13500), review);
  assert.ok((await page.evaluate(review => review.cells(), review)).every(c => c.frame === 27 && c.alpha >0&&c.alpha<1&&c.y===c.groundY&&c.maskY===null));
  await page.screenshot({ path: `${output}/fading.png` });
  await page.evaluate(review => review.step(15000), review);
  assert.ok((await page.evaluate(review => review.cells(), review)).every(c => c.destroyed));
  await page.screenshot({ path: `${output}/disappeared.png` });
  await page.evaluate(review => review.renderer.seek(review.frame(1), 100), review);
  assert.ok((await page.evaluate(review => review.cells(), review)).every(c => c.destroyed));
  await page.screenshot({ path: `${output}/seek.png` });
  if (process.argv.includes('--record')) {
    await mkdir(`${output}/movie-frames`, { recursive: true });
    await page.evaluate(review => review.die(), review);
    for (let frame = 0; frame < 85; frame++) {
      await page.evaluate((review, ms) => review.step(ms), review, 15000 + frame * 1000 / 12);
      await page.screenshot({ path: `${output}/movie-frames/${String(frame).padStart(3, '0')}.png` });
    }
    ff('-framerate', '12', '-i', `${output}/movie-frames/%03d.png`,
      '-frames:v','85','-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${output}/in-game-collapse.mp4`);
    ff('-i', `${output}/in-game-collapse.mp4`,
      '-filter_complex', 'fps=12,scale=960:-1,split[a][b];[a]palettegen[p];[b][p]paletteuse', `${output}/in-game-collapse.gif`);
  }
  assert.deepEqual(errors, []);
  console.log(`Pixi QA passed: four buildings, four player colors, full fall at fixed height, held final frame, fade in place without translation or clipping, pause and seek. Screenshots: ${output}`);
} finally {
  const shutdown=setTimeout(()=>browser.process()?.kill('SIGKILL'),5000);
  try { await browser.close(); } finally { clearTimeout(shutdown); }
}
