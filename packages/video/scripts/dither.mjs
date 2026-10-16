// Puts a rendered video through the game's dither, frame by frame, so every overlay (titles, HUD, chat,
// transitions) gets the look of the board: each colour group is a three-tone ramp (packages/web/src/render/
// palette.ts) and brightness is ordered-dithered along it with the same 4×4 Bayer pattern as the shader, at
// game pixels (2×2 video pixels). Pixels already on the palette (the footage) are only snapped back to it.
// Scaling happens in RGB: nearest-neighbour scaling of YUV frames loses their colour.
//   node scripts/dither.mjs in.mp4 out.mp4
import { encodeMp4, ffStream, probe } from "../../web/scripts/ffmpeg.mjs";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("usage: node scripts/dither.mjs in.mp4 out.mp4");
const PIXEL = 2;

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
// Same steps as palette.ts (dark, middle, light).
const RAMPS = [
  ["#000000", "#2d63c8", "#b4dcff"], ["#000000", "#d24a1c", "#ffcaa0"], ["#000000", "#23a19a", "#b0fff4"], ["#000000", "#8e3fc4", "#eec4ff"],
  ["#000000", "#3f8a33", "#8fcf5a"], ["#000000", "#b88a12", "#ffe98a"], ["#1e1e1e", "#a4a4a4", "#ffffff"], ["#000000", "#8c8c8c", "#ffffff"],
].map((r) => r.map(hex));
const NEUTRAL = RAMPS[7];
const PALETTE = RAMPS.flat();
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
// Hue of each coloured ramp: its light step, normalized.
const HUES = RAMPS.slice(0, 6).map((r) => { const [a, b, c] = r[2], n = Math.hypot(a, b, c); return [a / n, b / n, c / n]; });

function quantize(d, w, h) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3, r = d[i], g = d[i + 1], b = d[i + 2];
    // Already a palette colour (the footage, shifted a little by encoding and colour conversion): snap to it.
    let near = PALETTE[0], dist = Infinity;
    for (const p of PALETTE) { const e = Math.abs(p[0] - r) + Math.abs(p[1] - g) + Math.abs(p[2] - b); if (e < dist) { dist = e; near = p; } }
    if (dist < 48) { d[i] = near[0]; d[i + 1] = near[1]; d[i + 2] = near[2]; continue; }
    const L = Math.max(r, g, b) / 255, n = Math.hypot(r, g, b) || 1, sat = L - Math.min(r, g, b) / 255;
    let ramp = NEUTRAL;
    if (sat > 0.18) {
      let best = -1;
      HUES.forEach((u, k) => { const c = (u[0] * r + u[1] * g + u[2] * b) / n; if (c > best) { best = c; ramp = RAMPS[k]; } });
    }
    const scaled = Math.min(1, L) * 2, level = Math.min(2, Math.floor(scaled) + ((scaled % 1) > BAYER[(y & 3) * 4 + (x & 3)] ? 1 : 0));
    const c = ramp[level];
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
  }
}

const { width: W, height: H, rate } = probe(input);
const w = W / PIXEL, h = H / PIXEL, frameBytes = w * h * 3;
const dec = ffStream("-i", input, "-vf", `format=rgb24,scale=${w}:${h}:flags=neighbor`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-");
const enc = encodeMp4(["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${w}x${h}`, "-framerate", rate, "-i", "-",
  "-i", input, "-map", "0:v", "-map", "1:a?", "-c:a", "copy", "-vf", `scale=${W}:${H}:flags=neighbor,format=yuv420p`], output);
let buf = Buffer.alloc(0), frames = 0;
dec.stdout.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= frameBytes) {
    const frame = buf.subarray(0, frameBytes);
    quantize(frame, w, h);
    if (!enc.stdin.write(Buffer.from(frame))) dec.stdout.pause(), enc.stdin.once("drain", () => dec.stdout.resume());
    buf = buf.subarray(frameBytes);
    if (++frames % 300 === 0) console.log(`  ${frames} frames`);
  }
});
dec.on("close", () => enc.stdin.end());
await new Promise((res) => enc.on("close", res));
console.log(`done: ${output} (${frames} frames)`);
