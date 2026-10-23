// Re-simulates every saved replay and checks its hashes: engine changes must
// keep old matches reproducible. Recordings with a sandbox operational failure
// depended on the wall clock, so they are reported as refused, never verified.
//   npx tsx packages/engine/scripts/verify-replays.ts
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import type { Outcome, ReplayFile } from "@castellan/shared";
import { localReplays } from "@castellan/shared/local-data";
import { runReplay } from "../src";

const local = localReplays();
const files = readdirSync(local).filter((f) => f.endsWith(".json.gz")).map((f) => resolve(local, f));
let bad = 0, refused = 0;
for (const f of files) {
  const replay = JSON.parse(gunzipSync(readFileSync(f)).toString("utf8")) as ReplayFile;
  if (replay.experiment?.operationalFailures?.length) {
    refused++;
    console.log(`skip ${replay.id} recorded sandbox operational failure`);
    continue;
  }
  let last: Outcome | undefined;
  const check = await runReplay(replay, (v) => (last = v.outcome ?? last));
  const ok = check.verified && last?.winner === replay.outcome.winner && last?.reason === replay.outcome.reason;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${replay.id} ${JSON.stringify(check)} winner=${last?.winner}`);
}
console.log(`${files.length - refused - bad}/${files.length - refused} verified, ${refused} refused (operational failures)`);
process.exit(bad ? 1 : 0);
