// Gives a recording (scripts/record.mjs) the board's own sound: its effects, from <clip>.sounds.json, with the
// game's samples and mixing rules (src/audio/mix.ts), over the wind loop. No music. Writes <clip>.sfx.wav and
// <clip>-sound.mp4 (the video stream copied, AAC at −14 LUFS, the usual level for social video).
//   node scripts/sfx.mjs <clip.mp4>
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ff, probe } from "./ffmpeg.mjs";
import { AMBIENT_GAIN, Mix } from "../src/audio/mix.ts";

const { positionals } = parseArgs({ allowPositionals: true });
const clip = positionals[0];
if (!clip?.endsWith(".mp4")) throw new Error("usage: node scripts/sfx.mjs <clip.mp4>");
const RATE = 48000;
const SOUNDS = new URL("../public/sounds/", import.meta.url).pathname;
/** The king's horn and the end fanfare are mixed for the music they play over; alone they would jump out. */
const CUE_GAIN = { horn: 0.4, fanfare: 0.25 };

const decode = (file) => {
  const pcm = ff("-i", file, "-f", "f32le", "-ac", "1", "-ar", String(RATE), "-");
  return new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
};
const manifest = JSON.parse(readFileSync(`${SOUNDS}manifest.json`, "utf8"));
const buffers = Object.fromEntries(Object.entries(manifest.files).map(([k, files]) => [k, files.map((f) => decode(SOUNDS + f))]));
const { duration } = probe(clip);
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

const mix = new Mix(random);
const lengths = (sample) => buffers[sample]?.map((buf) => buf.length / RATE);
const sounds = JSON.parse(readFileSync(clip.replace(/\.mp4$/, ".sounds.json"), "utf8"));
let played = 0;
for (const s of sounds) {
  if (s.t < 0) continue;
  const sound = mix.play(s.name, s.t * 1000, s.volume, lengths);
  if (!sound) continue;
  const cue = CUE_GAIN[s.name] ?? 1;
  for (const { sample, variant, delay, rate, gain } of sound.voices) add(buffers[sample][variant], s.t + sound.spread + delay, rate, sound.gain * gain * cue, s.pan);
  played++;
}

// The wind, looped inside its padding, fading in and out over half a second.
const wind = buffers.ambient[0], pad = Math.round(manifest.pad * RATE), loop = Math.round(manifest.loop * RATE);
for (let i = 0; i < n; i++) {
  const t = i / RATE, env = Math.max(0, Math.min(1, t / 0.5, (duration - t) / 0.5));
  const v = wind[pad + (i % loop)] * AMBIENT_GAIN * env;
  L[i] += v; R[i] += v;
}

// 16-bit WAV, soft-clipped.
const out = Buffer.alloc(44 + n * 4);
out.write("RIFF", 0); out.writeUInt32LE(36 + n * 4, 4); out.write("WAVEfmt ", 8); out.writeUInt32LE(16, 16);
out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22); out.writeUInt32LE(RATE, 24); out.writeUInt32LE(RATE * 4, 28);
out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(n * 4, 40);
for (let i = 0; i < n; i++) {
  out.writeInt16LE(Math.round(Math.tanh(L[i]) * 32767), 44 + i * 4);
  out.writeInt16LE(Math.round(Math.tanh(R[i]) * 32767), 46 + i * 4);
}
const wav = clip.replace(/\.mp4$/, ".sfx.wav"), video = clip.replace(/\.mp4$/, "-sound.mp4");
writeFileSync(wav, out);
ff("-i", clip, "-i", wav, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "192k", "-ar", String(RATE), "-movflags", "+faststart", "-shortest", video);
console.log(`${video}: ${played}/${sounds.length} sounds, ${duration.toFixed(2)} s`);
