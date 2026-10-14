// Build-time only: publish verified board frames instead of running QuickJS in
// every visitor's browser. The original replay stays the source of truth.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import type { ReplayFile, SpectatorView } from "@aoa/shared";
import { playRecordedReplay } from "../src/replayPlayback";
import { cameraActivity, planShowcaseCamera, type CameraActivity } from "../src/showcaseCamera";
import { decodeShowcaseChunk, encodeShowcaseChunk, parseShowcaseManifest, type ShowcaseManifest } from "../src/showcaseRecording";

const web = resolve(import.meta.dirname, "..");
const root = resolve(web, "../..");
const replayPath = resolve(process.argv[2] ?? join(web, "public/showcase/02eb6795.json"));
const replay: ReplayFile = JSON.parse(await readFile(replayPath, "utf8"));
if (replay.format !== 1 || !/^[a-zA-Z0-9-]+$/.test(replay.id)
  || !Number.isSafeInteger(replay.tickRate) || replay.tickRate <= 0) throw new Error("Unsupported showcase replay.");
const destination = join(web, "public/showcase", replay.id);
const manifestPath = join(destination, "manifest.json");
const signaturePath = join(destination, "build.json");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : [file];
  }).sort();
}
function signature(): string {
  const hash = createHash("sha256");
  const files = [replayPath, ...["engine", "shared", "sandbox"].flatMap(name => sourceFiles(join(root, "packages", name, "src"))),
    join(web, "src/replayPlayback.ts"), join(web, "src/showcaseRecording.ts"), join(web, "src/showcaseCamera.ts"), fileURLToPath(import.meta.url),
    join(root, "pnpm-lock.yaml")].sort();
  for (const file of files) hash.update(relative(root, file)).update("\0").update(readFileSync(file)).update("\0");
  return hash.digest("hex");
}
const sourceSignature = signature();
let cached = false;
try {
  const build = JSON.parse(readFileSync(signaturePath, "utf8"));
  const manifestBytes = readFileSync(manifestPath);
  const manifest = parseShowcaseManifest(JSON.parse(manifestBytes.toString("utf8")));
  cached = build.signature === sourceSignature && manifest.id === replay.id
    && build.manifestHash === createHash("sha256").update(manifestBytes).digest("hex")
    && manifest.chunks.every(chunk => {
      const digest = createHash("sha256").update(readFileSync(join(destination, chunk.url))).digest("hex").slice(0, 16);
      return chunk.url === `${chunk.firstTick}-${digest}.json.gz`;
    });
} catch { /* Missing or obsolete generated data must be rebuilt. */ }
if (cached) {
  console.log(`Showcase ${replay.id} up to date`);
} else {
  const stage = mkdtempSync(join(tmpdir(), `aoa-showcase-${replay.id}-`));
  const started = performance.now();
  const lookback = replay.tickRate * 8;
  const openingFrames = replay.tickRate * 10;
  const laterFrames = replay.tickRate * 30;
  const beforeDeath: SpectatorView[] = [];
  let pending: SpectatorView[] = [];
  let seenDeath = false;
  let seenFrames = 0;
  let lastTick = -1;
  let compressedBytes = 0;
  const chunks: ShowcaseManifest["chunks"] = [];
  let activityIndex = 0;
  const activity = replay.experiment?.agentActivity ?? [];
  const currentActivity = new Map();
  const combat: CameraActivity[] = [];

  const flush = () => {
    if (!pending.length) return;
    const encoded = encodeShowcaseChunk(pending);
    const json = JSON.stringify(encoded);
    // Validate the exact serialized frames we publish, not only engine hashes.
    const decoded = decodeShowcaseChunk(JSON.parse(json));
    for (let i = 0; i < pending.length; i++) if (!isDeepStrictEqual(decoded[i], JSON.parse(JSON.stringify(pending[i])))) {
      throw new Error(`Showcase codec changed frame ${pending[i].tick}.`);
    }
    const bytes = gzipSync(json, { level: 9 });
    const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const url = `${pending[0].tick}-${digest}.json.gz`;
    writeFileSync(join(stage, url), bytes);
    compressedBytes += bytes.length;
    chunks.push({ url, firstTick: pending[0].tick, lastTick: pending[pending.length - 1].tick });
    pending = [];
  };

  try {
    const check = await playRecordedReplay(replay, frame => {
      seenFrames++;
      lastTick = frame.tick;
      const fighting = cameraActivity(frame);
      if (fighting.points.length) combat.push(fighting);
      while (activityIndex < activity.length && activity[activityIndex].tick <= frame.tick) {
        const entry = activity[activityIndex++];
        currentActivity.set(entry.player, entry.activity);
      }
      for (const player of frame.players) if (currentActivity.has(player.id)) player.agentActivity = currentActivity.get(player.id);
      if (!seenDeath) {
        beforeDeath.push(frame);
        if (beforeDeath.length > lookback + 1) beforeDeath.shift();
        if (!frame.events.some(event => event.type === "death")) return;
        seenDeath = true;
        pending.push(...beforeDeath);
        beforeDeath.length = 0;
      } else pending.push(frame);
      if (pending.length >= (chunks.length ? laterFrames : openingFrames)) flush();
    }, { includePerspectives: false });
    if (!check.verified || seenFrames !== replay.finalTick + 1 || lastTick !== replay.finalTick) {
      throw new Error(`Showcase replay did not verify: ${JSON.stringify({ ...check, seenFrames, lastTick })}`);
    }
    if (!seenDeath) throw new Error("Choose a showcase with a casualty: the hero opens eight seconds before the first death.");
    flush();
    const manifest: ShowcaseManifest = { format: 1, id: replay.id, tickRate: replay.tickRate,
      ruleset: replay.ruleset, players: replay.players, startTick: chunks[0].firstTick,
      finalTick: replay.finalTick, chunks,
      camera: planShowcaseCamera(combat, chunks[0].firstTick, replay.finalTick, replay.tickRate) };
    parseShowcaseManifest(manifest);
    if (signature() !== sourceSignature) throw new Error("Showcase sources changed while recording; run the build again.");
    mkdirSync(destination, { recursive: true });
    for (const chunk of chunks) {
      const temporaryChunk = join(destination, `${chunk.url}.tmp.${process.pid}`);
      // The temporary directory may be on a different filesystem from the repo.
      copyFileSync(join(stage, chunk.url), temporaryChunk);
      renameSync(temporaryChunk, join(destination, chunk.url));
    }
    // Publish metadata only after the entire deterministic recording verifies.
    const temporaryManifest = join(destination, `manifest.json.tmp.${process.pid}`);
    const manifestJson = JSON.stringify(manifest);
    writeFileSync(temporaryManifest, manifestJson);
    renameSync(temporaryManifest, manifestPath);
    const manifestHash = createHash("sha256").update(manifestJson).digest("hex");
    const temporarySignature = `${signaturePath}.tmp.${process.pid}`;
    writeFileSync(temporarySignature, JSON.stringify({ signature: sourceSignature, manifestHash, frames: seenFrames, verified: true, compressedBytes }));
    renameSync(temporarySignature, signaturePath);
    console.log(JSON.stringify({ id: replay.id, source: basename(replayPath), startTick: manifest.startTick,
      finalTick: manifest.finalTick, chunks: chunks.length, shots: manifest.camera!.length, firstChunkBytes: readFileSync(join(destination, chunks[0].url)).length,
      compressedBytes, durationMs: Math.round(performance.now() - started), verified: true }));
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
