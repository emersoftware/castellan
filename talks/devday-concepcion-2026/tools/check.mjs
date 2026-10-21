// QA for the talk: walks every step forward and back in an isolated headless Chrome.
//   node tools/check.mjs [--size 1920x1080] [--reduce] [--shots dir] [--only id,id] [--wait ms]
// Reports console errors, failed requests, elements outside the 16:9 stage, text that overflows
// its box, media still playing after leaving its scene, forward/back state mismatches and any
// non-local URL in the deck's sources. Exit code 1 if something fails.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const talk = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../../../packages/web/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');
const { values: o } = parseArgs({ options: {
  size: { type: 'string', default: '1920x1080' }, reduce: { type: 'boolean', default: false },
  shots: { type: 'string' }, only: { type: 'string' }, wait: { type: 'string', default: '1400' }, back: { type: 'boolean', default: true },
} });
const [W, H] = o.size.split('x').map(Number);
const wait = Number(o.wait);

// ───── static server ─────
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '');
  if (path.includes('..')) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(join(talk, path || 'index.html'));
    const range = req.headers.range;
    if (range && /^bytes=/.test(range)) {
      const [a, b] = range.slice(6).split('-'); const start = Number(a) || 0; const end = b ? Number(b) : body.length - 1;
      res.writeHead(206, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      res.end(body.subarray(start, end + 1)); return;
    }
    res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

// ───── sources: nothing remote ─────
const problems = [];
for (const file of ['index.html', 'slides.css', 'slides.js', 'scenes.js']) {
  const text = await readFile(join(talk, file), 'utf8');
  for (const m of text.matchAll(/(?:src|href|url)\s*[=(]\s*["']?(https?:)?\/\//g)) problems.push({ kind: 'remote-url', file, at: m.index });
  for (const m of text.matchAll(/https?:\/\/(?!www\.w3\.org)[^\s"'<>)]+/g)) problems.push({ kind: 'remote-url', file, url: m[0] });
}

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const report = { size: o.size, reduce: o.reduce, steps: [], problems };
try {
  const page = await browser.newPage();
  if (o.reduce) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  page.on('pageerror', e => problems.push({ kind: 'pageerror', message: e.message }));
  page.on('console', m => { if (m.type() === 'error') problems.push({ kind: 'console', message: m.text() }); });
  page.on('requestfailed', r => problems.push({ kind: 'requestfailed', url: r.url(), error: r.failure()?.errorText }));
  page.on('response', r => { if (r.status() >= 400) problems.push({ kind: 'http', url: r.url(), status: r.status() }); });
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction(() => window.talk && window.TalkScenes);
  // A gesture, so audio may start like it would with a clicker.
  await page.mouse.click(5, 5);
  const scenes = await page.evaluate(() => window.talk.scenes);
  const only = o.only?.split(',');
  if (o.shots) await mkdir(o.shots, { recursive: true });

  const snapshot = () => page.evaluate(() => {
    const deck = document.getElementById('deck').getBoundingClientRect();
    const scene = document.querySelector('.scene.active');
    const out = [], overflow = [];
    for (const el of scene.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[aria-hidden="true"]') && el.tagName !== 'CANVAS') continue;
      if (el.closest('.clip') && el.tagName === 'CANVAS') continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.left < deck.left - 1 || r.top < deck.top - 1 || r.right > deck.right + 1 || r.bottom > deck.bottom + 1) out.push({ el: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : ''), rect: [r.left - deck.left, r.top - deck.top, r.right - deck.left, r.bottom - deck.top].map(Math.round) });
      if (el.children.length === 0 && el.textContent.trim() && (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) && cs.overflow !== 'visible') overflow.push(el.textContent.trim().slice(0, 50));
    }
    const on = [...scene.querySelectorAll('[data-in],[data-out]')].map(n => n.classList.contains('on') ? 1 : 0).join('');
    const media = [...document.querySelectorAll('video, audio')].filter(m => !m.paused && !m.closest('.scene.active')).map(m => m.currentSrc.split('/').pop());
    return { id: scene.id, step: Number(scene.dataset.step), on, out, overflow, media, state: window.talk.state };
  });

  const forward = new Map();
  await page.evaluate(() => window.talk.go(0, 0));
  for (let i = 0; i < scenes.length; i++) {
    for (let k = 0; k < scenes[i].steps; k++) {
      if (!(i === 0 && k === 0)) await page.keyboard.press('ArrowRight');
      if (only && !only.includes(scenes[i].id)) continue;
      await new Promise(r => setTimeout(r, wait));
      const s = await snapshot();
      forward.set(`${s.id}/${s.step}`, s.on);
      report.steps.push({ dir: 'forward', ...s });
      if (s.out.length) problems.push({ kind: 'outside-stage', at: `${s.id}/${s.step}`, items: s.out.slice(0, 6) });
      if (s.overflow.length) problems.push({ kind: 'text-overflow', at: `${s.id}/${s.step}`, items: s.overflow.slice(0, 6) });
      if (s.media.length) problems.push({ kind: 'media-playing-offscreen', at: `${s.id}/${s.step}`, items: s.media });
      if (o.shots) await page.screenshot({ path: join(o.shots, `${String(i + 1).padStart(2, '0')}-${s.id}-${k}.png`) });
    }
  }
  if (o.back) {
    for (let n = 0; n < 200; n++) {
      const before = await page.evaluate(() => window.talk.state);
      if (before.scene === 0 && before.step === 0) break;
      await page.keyboard.press('ArrowLeft');
      const s = await snapshot();
      if (only && !only.includes(s.id)) continue;
      const f = forward.get(`${s.id}/${s.step}`);
      if (f !== undefined && f !== s.on) problems.push({ kind: 'back-mismatch', at: `${s.id}/${s.step}`, forward: f, back: s.on });
    }
  }
} finally {
  await browser.close();
  server.close();
}
const dir = o.shots ?? '/tmp';
await writeFile(join(dir, `check-${o.size}${o.reduce ? '-reduce' : ''}.json`), JSON.stringify(report, null, 1));
const summary = problems.reduce((a, p) => (a[p.kind] = (a[p.kind] || 0) + 1, a), {});
console.log(`${o.size}${o.reduce ? ' reduced-motion' : ''}: ${report.steps.length} steps checked`, JSON.stringify(summary));
for (const p of problems.slice(0, 40)) console.log(' ', JSON.stringify(p).slice(0, 300));
process.exit(problems.length ? 1 : 0);
