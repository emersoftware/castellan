// Finds the 200-tick window and 18x18 area of a replay where the most different things happen at once.
//   npx tsx talks/devday-concepcion-2026/tools/score-moments.mts <id>
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { playRecordedReplay } from '../../../packages/web/src/replayPlayback';
const [id] = process.argv.slice(2);
const replay = JSON.parse(gunzipSync(readFileSync(new URL(`../research/replays/${id}.json.gz`, import.meta.url))).toString('utf8'));
const W = 200, S = 18, step = 4;
type Cell = { kinds: Set<string>; doing: Set<string>; owners: Set<string>; proj: number; events: Map<string, number> };
const buckets = new Map<string, Cell>();
const cell = (b: number, x0: number, y0: number) => { const k = `${b}:${x0}:${y0}`; let c = buckets.get(k); if (!c) buckets.set(k, c = { kinds: new Set(), doing: new Set(), owners: new Set(), proj: 0, events: new Map() }); return c; };
let size = 44, eventKeys = new Set<string>();
const check = await playRecordedReplay(replay, (v: any) => {
  if (v.tick % 5) return;
  const b = Math.floor(v.tick / 100); // windows start every 100 ticks, span 200
  for (const bb of [b, b - 1]) {
    if (bb < 0) continue;
    for (let x0 = 0; x0 + S <= size; x0 += step) for (let y0 = 0; y0 + S <= size; y0 += step) {
      const inn = (x: number, y: number) => x >= x0 && x < x0 + S && y >= y0 && y < y0 + S;
      const c = cell(bb, x0, y0);
      for (const e of v.entities ?? []) if (inn(e.x, e.y)) { c.kinds.add(e.kind); if (e.doing) c.doing.add(e.kind + ':' + e.doing); if (e.owner) c.owners.add(e.owner); }
      for (const p of v.projectiles ?? []) if (inn(p.x, p.y)) c.proj++;
      for (const ev of v.events ?? []) { const t = ev.type ?? ev.kind ?? '?'; eventKeys.add(t); if (ev.x == null || inn(ev.x, ev.y)) c.events.set(t, (c.events.get(t) ?? 0) + 1); }
    }
  }
});
console.log(id, 'verified', check.verified, 'final', replay.finalTick, 'event types', [...eventKeys].join(','));
const rows = [...buckets.entries()].map(([k, c]) => {
  const [b, x0, y0] = k.split(':').map(Number);
  const score = c.kinds.size * 3 + c.doing.size * 2 + c.owners.size * 2 + Math.min(10, c.proj / 20) + [...c.events.keys()].length * 2 + Math.min(10, [...c.events.values()].reduce((a, n) => a + n, 0) / 10);
  return { score: Math.round(score), start: b * 100, focus: `${x0},${y0},${x0 + S},${y0 + S}`, kinds: [...c.kinds].join(' '), doing: [...c.doing].length, owners: c.owners.size, proj: c.proj, events: JSON.stringify(Object.fromEntries(c.events)) };
}).sort((a, b) => b.score - a.score);
for (const r of rows.slice(0, 6)) console.log(JSON.stringify(r));
