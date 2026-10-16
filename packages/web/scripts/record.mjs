// Records a replay to MP4: headless Chrome renders /record/:id frame by frame on a
// virtual clock (so no frame is dropped), ffmpeg encodes.
// Dithering is the worst case for video codecs (per-pixel noise, colour on single
// pixels), so frames are upscaled with nearest neighbour (--scale 2: each pixel a
// 2×2 block, which lines up with 4:2:0 chroma so colours don't bleed) and encoded
// at high quality. A screen recording (QuickTime) gets neither and looks smeared.
//   node scripts/record.mjs <replayId> [--speed 2] [--fps 30] [--scale 2] [--out file.mp4] [--clean]
//     [--camera auto|x,y] [--zoom k] [--pov p1] [--from s] [--to s] [--fade-in s] [--fade-out s] [--world-in s] [--world-out s]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import puppeteer from "puppeteer-core";
import { encodeMp4 } from "./ffmpeg.mjs";

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
    // Map only, without HUD (overlays come later in the video edit), and a camera that follows the fights.
    clean: { type: "boolean", default: false },
    // "auto" (pans after the fighting) or a fixed "x,y" tile; zoom: the game's zoom steps (×1.25) from the whole map.
    camera: { type: "string" },
    zoom: { type: "string" },
    // Screen pixels to put the camera's target below the centre (room for titles above).
    dy: { type: "string" },
    // One player's view, under its fog of war.
    pov: { type: "string" },
    // Dissolves at the ends of the shot, in video seconds: units only, or the whole world (map changes).
    "fade-in": { type: "string" }, "fade-out": { type: "string" }, "world-in": { type: "string" }, "world-out": { type: "string" },
    // Only this stretch of the game, in game seconds (no end hold unless it reaches the end).
    from: { type: "string" },
    to: { type: "string" },
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
  // Shot bounds and dissolves go to the page in game milliseconds.
  const gms = (s) => String(Math.round(Number(s) * 1000 * Number(o.speed)));
  const query = new URLSearchParams({
    ...(o.clean ? { clean: "" } : {}), ...(o.camera ? { camera: o.camera } : {}), ...(o.zoom ? { zoom: o.zoom } : {}), ...(o.dy ? { dy: o.dy } : {}), ...(o.pov ? { pov: o.pov } : {}),
    ...(o.from ? { from: String(Number(o.from) * 1000) } : {}), ...(o.to ? { to: String(Number(o.to) * 1000) } : {}),
    ...(o["fade-in"] ? { fadeIn: gms(o["fade-in"]) } : {}), ...(o["fade-out"] ? { fadeOut: gms(o["fade-out"]) } : {}),
    ...(o["world-in"] ? { worldIn: gms(o["world-in"]) } : {}), ...(o["world-out"] ? { worldOut: gms(o["world-out"]) } : {}),
  }).toString();
  await page.goto(`${o.server}/record/${id}${query ? `?${query}` : ""}`);
  await page.waitForFunction(() => window.__record?.ready, { timeout: 600_000 });
  const { ticks, verified } = await page.evaluate(() => ({ ticks: window.__record.ticks, verified: window.__record.verified }));
  const endMs = (ticks - 1) * 100;
  const fromMs = o.from ? Number(o.from) * 1000 : 0, gameMs = o.to ? Math.min(endMs, Number(o.to) * 1000) : endMs;
  const step = (1000 / fps) * speed;
  // The last frame lands on `to` (where fades end); at the end of the game, the final screen holds 4 s.
  const frames = Math.ceil((gameMs - fromMs) / step) + 1 + (gameMs === endMs ? fps * 4 : 0);
  console.log(`replay ${id}: ${ticks} ticks, verified ${verified}; ${frames} frames → ${out}`);

  const scale = Math.max(1, Math.round(Number(o.scale)));
  const ffmpeg = encodeMp4(["-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
    "-vf", `scale=iw*${scale}:ih*${scale}:flags=neighbor`], out);
  const cdp = await page.createCDPSession();
  const started = Date.now();
  for (let k = 0; k < frames; k++) {
    await page.evaluate((ms) => window.__record.frame(ms), Math.min(fromMs + k * step, gameMs));
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    if (!ffmpeg.stdin.write(Buffer.from(data, "base64"))) await new Promise((r) => ffmpeg.stdin.once("drain", r));
    if (k % 300 === 0) console.log(`  frame ${k}/${frames} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
  }
  ffmpeg.stdin.end();
  // The board's sounds, in seconds of this video (scripts in packages/video mix them).
  const sounds = await page.evaluate(() => window.__record.sounds);
  writeFileSync(out.replace(/\.mp4$/, ".sounds.json"), JSON.stringify(sounds.map((x) => ({ ...x, t: +((x.ms - fromMs) / 1000 / speed).toFixed(3) }))));
  await new Promise((r, j) => ffmpeg.on("close", (c) => (c === 0 ? r() : j(new Error(`ffmpeg exit ${c}`)))));
  console.log(`done: ${out}`);
} finally {
  await browser.close();
}
