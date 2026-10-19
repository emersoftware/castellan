// No models or server needed. Run against the same file before/after a change:
// pnpm exec tsx packages/engine/scripts/benchmark-replay.ts <replay.json[.gz]> [--board-only]
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { ReplayFile } from "@castellan/shared";
import { runReplay } from "../src";

const file = process.argv[2];
if (!file || file.startsWith("--")) throw new Error("Pass a replay.json or replay.json.gz path, optionally followed by --board-only");
const bytes = readFileSync(file);
const replay: ReplayFile = JSON.parse((file.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8"));
const includePerspectives = !process.argv.includes("--board-only");
const started = performance.now();
let firstFrameMs: number | undefined, firstDeathMs: number | undefined, frames = 0;
const check = await runReplay(replay, frame => {
  firstFrameMs ??= performance.now() - started;
  if (firstDeathMs === undefined && frame.events.some(e => e.type === "death")) firstDeathMs = performance.now() - started;
  frames++;
}, { includePerspectives });
console.log(JSON.stringify({ replay: replay.id, version: replay.ruleset.version, includePerspectives,
  frames, firstFrameMs, firstDeathMs, totalMs: performance.now() - started, ...check }, null, 2));
if (!check.verified || frames !== replay.finalTick + 1) process.exitCode = 1;
