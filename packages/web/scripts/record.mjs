// Records a replay to MP4: headless Chrome renders /record/:id frame by frame on a
// virtual clock (so no frame is dropped), ffmpeg encodes.
// Dithering is the worst case for video codecs (per-pixel noise, colour on single
// pixels), so frames are upscaled with nearest neighbour (--scale 2: each pixel a
// 2×2 block, which lines up with 4:2:0 chroma so colours don't bleed) and encoded
// at high quality. A screen recording (QuickTime) gets neither and looks smeared.
//   node scripts/record.mjs <replayId> [--speed 2] [--fps 30] [--scale 2] [--out file.mp4]
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import puppeteer from "puppeteer-core";

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    speed: { type: "string", default: "2" },
    fps: { type: "string", default: "30" },
    out: { type: "string" },
    server: { type: "string", default: process.env.AOA_SERVER ?? "http://localhost:4400" },
    width: { type: "string", default: "1280" },
    height: { type: "string", default: "720" },
    scale: { type: "string", default: "2" },
  },
});
const id = positionals[0];
if (!id) throw new Error("usage: node scripts/record.mjs <replayId> [--speed 2] [--fps 30] [--out file.mp4]");
const speed = Number(o.speed);
const fps = Number(o.fps);
const out = resolve(o.out ?? `../../videos/${id}-${o.speed}x.mp4`);
mkdirSync(dirname(out), { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
  defaultViewport: { width: Number(o.width), height: Number(o.height) },
});
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`${o.server}/record/${id}`);
  await page.waitForFunction(() => window.__record?.ready, { timeout: 600_000 });
  const { ticks, verified } = await page.evaluate(() => ({ ticks: window.__record.ticks, verified: window.__record.verified }));
  const gameMs = (ticks - 1) * 100;
  const step = (1000 / fps) * speed;
  const frames = Math.ceil(gameMs / step) + fps * 4; // hold the final screen 4 s
  console.log(`replay ${id}: ${ticks} ticks, verified ${verified}; ${frames} frames → ${out}`);

  const scale = Math.max(1, Math.round(Number(o.scale)));
  const ffmpeg = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
    "-vf", `scale=iw*${scale}:ih*${scale}:flags=neighbor`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "12", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
  const cdp = await page.createCDPSession();
  const started = Date.now();
  for (let k = 0; k < frames; k++) {
    await page.evaluate((ms) => window.__record.frame(ms), Math.min(k * step, gameMs));
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    if (!ffmpeg.stdin.write(Buffer.from(data, "base64"))) await new Promise((r) => ffmpeg.stdin.once("drain", r));
    if (k % 300 === 0) console.log(`  frame ${k}/${frames} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
  }
  ffmpeg.stdin.end();
  await new Promise((r, j) => ffmpeg.on("close", (c) => (c === 0 ? r() : j(new Error(`ffmpeg exit ${c}`)))));
  console.log(`done: ${out}`);
} finally {
  await browser.close();
}
