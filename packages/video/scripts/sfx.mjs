// Mixes a shot's board sounds (<clip>.sounds.json, written by packages/web/scripts/record.mjs) into a WAV with the
// game's own samples and rules (packages/web/src/audio/sfx.ts): rate limits per sound, a voice cap, quieter when
// repeated, blows of a tick spread a little, slight pitch jitter on noises; the wind loop underneath.
// The king's horn and the end fanfare are left out: too loud for a reel.
//   node scripts/sfx.mjs public/promo/s1-pov.mp4 [--wind-in s] [--wind-out s]
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { probeDuration } from "../../web/scripts/ffmpeg.mjs";

const { positionals, values: o } = parseArgs({ allowPositionals: true, options: { "wind-in": { type: "string" }, "wind-out": { type: "string" } } });
const clip = positionals[0];
const RATE = 48000;
const SOUNDS = new URL("../../web/public/sounds/", import.meta.url).pathname;
const SKIP = new Set(["horn", "fanfare"]);
const MIN_GAP_MS = { sword: 90, hit: 160, arrow: 200, tower: 250, death: 90, spawn: 120, pick: 110, footstep: 180 };
const MAX_PER_SOUND = { sword: 3, hit: 2, arrow: 2, tower: 2, death: 3, pick: 2, footstep: 2 };
const MAX_VOICES = 12, SPREAD_S = 0.06, DENSITY_WINDOW_MS = 800, AMBIENT_GAIN = 0.22, MASTER = 0.7;
/** The game plays effects quietly under the music; the reel brings them forward (+7 dB). */
const REEL_GAIN = 2.2;
const PITCHED = new Set(["sword", "spawn", "horn", "fanfare"]);
const MIX = { arrow: [{ sample: "whoosh" }], tower: [{ sample: "whoosh", rate: 0.75 }] };

const decode = (file) => {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "f32le", "-ac", "1", "-ar", String(RATE), "-"], { maxBuffer: 1 << 30 });
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4);
};
const manifest = JSON.parse(readFileSync(`${SOUNDS}manifest.json`, "utf8"));
const buffers = Object.fromEntries(Object.entries(manifest.files).map(([k, files]) => [k, files.map((f) => decode(SOUNDS + f))]));
const duration = probeDuration(clip);
const n = Math.ceil(duration * RATE);
const L = new Float32Array(n), R = new Float32Array(n);

// A seeded random, so a re-render sounds the same.
let seed = 7;
const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

const add = (buf, at, rate, gain, pan) => {
  // Equal-power panning, as a StereoPanner does with a mono source.
  const x = ((pan * 0.8) + 1) / 2, gl = Math.cos((x * Math.PI) / 2) * gain, gr = Math.sin((x * Math.PI) / 2) * gain;
  const start = Math.round(at * RATE);
  for (let i = 0; ; i++) {
    const p = i * rate, k = Math.floor(p);
    if (k + 1 >= buf.length || start + i >= n) break;
    if (start + i < 0) continue;
    const v = buf[k] + (buf[k + 1] - buf[k]) * (p - k);
    L[start + i] += v * gl; R[start + i] += v * gr;
  }
};

const last = new Map(), recent = new Map();
let busy = [];
const sounds = JSON.parse(readFileSync(clip.replace(/\.mp4$/, ".sounds.json"), "utf8"));
let played = 0;
for (const s of sounds) {
  if (SKIP.has(s.name) || s.volume <= 0.01 || s.t < 0) continue;
  const nowMs = s.t * 1000;
  const layers = MIX[s.name] ?? [{ sample: s.name }];
  if (!buffers[layers[0].sample]) continue;
  if (nowMs - (last.get(s.name) ?? -1e9) < (MIN_GAP_MS[s.name] ?? 40)) continue;
  busy = busy.filter((v) => v.until > nowMs);
  if (busy.length >= MAX_VOICES) continue;
  if (busy.filter((v) => v.name === s.name).length >= (MAX_PER_SOUND[s.name] ?? MAX_VOICES)) continue;
  last.set(s.name, nowMs);
  const r = (recent.get(s.name) ?? []).filter((t) => t > nowMs - DENSITY_WINDOW_MS);
  r.push(nowMs);
  recent.set(s.name, r);
  const gain = (s.volume / Math.sqrt(r.length)) * MASTER;
  const jitter = 0.95 + random() * 0.1;
  const spread = MIN_GAP_MS[s.name] ? random() * SPREAD_S : 0;
  let dur = 0;
  for (const { sample, gain: g = 1, delay = 0, rate = 1 } of layers) {
    const variants = buffers[sample];
    const buf = variants[Math.floor(random() * variants.length)];
    const pitch = PITCHED.has(sample) ? rate : rate * jitter;
    add(buf, s.t + spread + delay, pitch, gain * g, s.pan);
    dur = Math.max(dur, spread + delay + buf.length / RATE / pitch);
  }
  busy.push({ name: s.name, until: nowMs + dur * 1000 });
  played++;
}

// The wind, looped inside its padding, fading with the board.
const wind = buffers.ambient[0], pad = Math.round(manifest.pad * RATE), loop = Math.round(manifest.loop * RATE);
const windIn = Number(o["wind-in"] ?? 0.5), windOut = Number(o["wind-out"] ?? 0.5);
for (let i = 0; i < n; i++) {
  const t = i / RATE, env = Math.min(1, windIn ? t / windIn : 1, windOut ? (duration - t) / windOut : 1);
  const v = wind[pad + (i % loop)] * AMBIENT_GAIN * MASTER * Math.max(0, env);
  L[i] += v; R[i] += v;
}

// 16-bit WAV, soft-clipped.
const out = Buffer.alloc(44 + n * 4);
out.write("RIFF", 0); out.writeUInt32LE(36 + n * 4, 4); out.write("WAVEfmt ", 8); out.writeUInt32LE(16, 16);
out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22); out.writeUInt32LE(RATE, 24); out.writeUInt32LE(RATE * 4, 28);
out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(n * 4, 40);
for (let i = 0; i < n; i++) {
  out.writeInt16LE(Math.round(Math.tanh(L[i] * REEL_GAIN) * 32767), 44 + i * 4);
  out.writeInt16LE(Math.round(Math.tanh(R[i] * REEL_GAIN) * 32767), 46 + i * 4);
}
const wav = clip.replace(/\.mp4$/, ".sfx.wav");
writeFileSync(wav, out);
console.log(`${wav}: ${played}/${sounds.length} sounds, ${duration.toFixed(2)} s`);
