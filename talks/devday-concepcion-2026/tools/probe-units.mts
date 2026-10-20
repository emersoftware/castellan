// Re-simulates a replay and prints where one player's units of a kind are at given ticks (for clip focus).
//   npx tsx talks/devday-concepcion-2026/tools/probe-units.mts <id> <player> <kind> <tick...>
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { playRecordedReplay } from '../../../packages/web/src/replayPlayback';
const [id, player, kind, ...ticks] = process.argv.slice(2);
const want = new Set(ticks.map(Number));
const replay = JSON.parse(gunzipSync(readFileSync(new URL(`../research/replays/${id}.json.gz`, import.meta.url))).toString('utf8'));
console.log(id, replay.ruleset ?? replay.rulesVersion, 'final', replay.finalTick, replay.players.map((p: any) => `${p.id}:${p.name}`).join(' '));
const check = await playRecordedReplay(replay, (v: any) => {
  if (!want.has(v.tick)) return;
  const es = (v.entities ?? []).filter((e: any) => e.owner === player && (kind === '*' || e.kind === kind));
  console.log(v.tick, es.map((e: any) => `${e.id}@${e.x},${e.y}${e.hp != null ? ' hp' + e.hp : ''}`).join('  '));
});
console.log('verified', check.verified, JSON.stringify(check).slice(0, 200));
