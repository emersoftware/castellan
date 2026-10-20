// Re-simulate selected research replays with the current engine and the real QuickJS sandbox,
// checking every recorded hash. Prints verified/desync per replay. No code runs on the host.
//   npx tsx tools/verify-replays.mts [id...]
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { playRecordedReplay } from '../../../packages/web/src/replayPlayback';
const dir = new URL('../research/replays/', import.meta.url);
const ids = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(dir).filter(f => f.endsWith('.json.gz')).map(f => f.slice(0, 8));
for (const id of ids) {
  const replay = JSON.parse(gunzipSync(readFileSync(new URL(`${id}.json.gz`, dir))).toString('utf8'));
  const t0 = Date.now();
  let frames = 0, last: any;
  try {
    const check = await playRecordedReplay(replay, v => { frames++; last = v.outcome ?? last; });
    const outcomeOk = (last?.winner ?? null) === (replay.outcome.winner ?? null) && last?.reason === replay.outcome.reason;
    console.log(`${check.verified && outcomeOk ? 'ok  ' : 'FAIL'} ${id} ${replay.ruleset.version} hashes=${Object.keys(replay.hashes).length} ${JSON.stringify(check)} outcome=${last?.reason}/${last?.winner} expected=${replay.outcome.reason}/${replay.outcome.winner} frames=${frames} ${(Date.now() - t0) / 1000}s`);
  } catch (e) {
    console.log(`ERR  ${id} ${replay.ruleset?.version} ${(e as Error).message}`);
  }
}
