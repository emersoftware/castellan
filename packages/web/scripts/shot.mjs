// Screenshots for visual checks: node scripts/shot.mjs <url> <out.png> [gameMs for /record pages] [width] [height]
import puppeteer from "puppeteer-core";
const [url, out, gameMs, w = "1440", h = "900"] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"], defaultViewport: { width: Number(w), height: Number(h), deviceScaleFactor: Number(process.env.DPR ?? 1) } });
const p = await b.newPage();
p.on("pageerror", (e) => console.log("pageerror:", e.message));
p.on("console", (m) => m.type() === "error" && console.log("console:", m.text()));
await p.goto(url, { waitUntil: "networkidle0" });
if (gameMs) {
  await p.waitForFunction(() => window.__record?.ready, { timeout: 300000 });
  await p.evaluate((ms) => window.__record.frame(ms), Number(gameMs));
} else await new Promise((r) => setTimeout(r, 4000));
await p.screenshot({ path: out, fullPage: process.env.FULL === "1" });
await b.close();
