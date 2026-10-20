// Screenshot any URL in an isolated headless Chrome (temporary profile; never the user's browser).
//   node tools/peek.mjs <url> <out.png> [width] [height] [waitMs]
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../packages/web/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');
const [url, out, w = '1440', h = '810', wait = '2500'] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: Number(w), height: Number(h) },
});
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('pageerror:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, Number(wait)));
  await page.screenshot({ path: out });
  console.log('saved', out);
} finally { await browser.close(); }
