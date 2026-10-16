// Re-simulates every saved replay and checks its hashes: engine changes must
// keep old matches reproducible.
//   npx tsx packages/engine/scripts/verify-replays.ts
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { replayArchive, type Outcome, type ReplayFile } from "@aoa/shared";
import { runReplay } from "../src";

const root = resolve(import.meta.dirname, "../../..");
const local = resolve(root, replayArchive.local), featured = resolve(root, replayArchive.featured);
const files = [
  ...readdirSync(local).filter((f) => f.endsWith(".json.gz")).map((f) => resolve(local, f)),
  ...readdirSync(featured).filter((f) => /^[0-9a-f]+\.json$/.test(f)).map((f) => resolve(featured, f)),
];
let bad = 0;
for (const f of files) {
  const raw = readFileSync(f);
  const replay = JSON.parse((f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8")) as ReplayFile;
  let last: Outcome | undefined;
  const check = await runReplay(replay, (v) => (last = v.outcome ?? last));
  const ok = check.verified && last?.winner === replay.outcome.winner && last?.reason === replay.outcome.reason;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${replay.id} ${JSON.stringify(check)} winner=${last?.winner}`);
}
console.log(`${files.length - bad}/${files.length} verified`);
process.exit(bad ? 1 : 0);
