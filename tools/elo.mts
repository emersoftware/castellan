/**
 * ELO over saved battles, by declared agent identity.
 *   npx tsx tools/elo.mts [--json] [--rules <version prefix>] [--since <ISO date>]
 *
 * Without filters it rates the whole archive (historical reference). A fresh
 * ladder is a filtered run: --ids <queue rooms.txt[,more]> rates only those
 * battles, from 1500, ignoring the ad-hoc history.
 *
 * An entity is the triple the experiment manifest declares: connector (harness) +
 * model + effort. Players without all three (older recordings, bots) are unrated;
 * a pair is scored only when both sides are rated. Matches are replayed in
 * creation order. Duels and free-for-alls: the winner scores against every other
 * rated player (relative order among losers is unknown, so those pairs are not
 * scored). Team matches: a team counts only when both teammates are the same
 * entity, and the winning team scores once against each losing homogeneous team.
 * Matches without a winner (timeouts) are skipped. Classic ELO: the points moved
 * depend on the opponent's rating (start 1500, K=32).
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
type Config = { connector?: string | null; model?: string | null; effort?: string | null };
type Replay = {
  id: string; createdAt: string;
  ruleset: { version?: string };
  players: { id: string; name: string; bot?: string; team?: number }[];
  outcome: { winner?: string | null; winners?: string[] };
  experiment?: { players?: Record<string, { configuration?: Config }> };
};

const files = [
  ...readdirSync(resolve(root, "replays")).filter(f => f.endsWith(".json.gz")).map(f => resolve(root, "replays", f)),
  ...readdirSync(resolve(root, "packages/web/public/featured")).filter(f => /^[0-9a-f]+\.json$/.test(f)).map(f => resolve(root, "packages/web/public/featured", f)),
];
const replays: Replay[] = [];
for (const f of files) {
  try {
    const raw = readFileSync(f);
    replays.push(JSON.parse((f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8")));
  } catch { /* unreadable file: not a battle */ }
}
const flag = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const rulesPrefix = flag("--rules"), since = flag("--since");
// --ids a,b: files whose lines name room ids (a queue's rooms.txt); only those battles rate.
const idFiles = flag("--ids")?.split(",") ?? [];
const onlyIds = idFiles.length ? new Set(idFiles.flatMap(f => { try { return [...readFileSync(f, "utf8").matchAll(/\b[0-9a-f]{8}\b/g)].map(m => m[0]); } catch { return []; } })) : null;
const seen = new Set<string>();
const ordered = replays
  .filter(r => (seen.has(r.id) ? false : seen.add(r.id)))
  .filter(r => (!rulesPrefix || (r.ruleset.version ?? "").startsWith(rulesPrefix)) && (!since || r.createdAt >= since) && (!onlyIds || onlyIds.has(r.id)))
  .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

const entityOf = (r: Replay, pid: string): string | null => {
  const c = r.experiment?.players?.[pid]?.configuration;
  if (!c?.connector || !c.model || !c.effort) return null;
  if (c.connector === "jev") return null; // a planner+chooser hybrid, not a model identity: unrated
  return `${c.connector} · ${c.model} @ ${c.effort}`;
};

const rating = new Map<string, number>();
const record = new Map<string, { games: number; wins: number; losses: number; matches: Set<string> }>();
const of = (e: string) => rating.get(e) ?? 1500;
const stat = (e: string) => record.get(e) ?? record.set(e, { games: 0, wins: 0, losses: 0, matches: new Set() }).get(e)!;
const K = 32;

const score = (winner: string, loser: string) => {
  const [ra, rb] = [of(winner), of(loser)];
  const expected = 1 / (1 + 10 ** ((rb - ra) / 400));
  rating.set(winner, ra + K * (1 - expected));
  rating.set(loser, rb - K * (1 - expected));
  stat(winner).wins++; stat(loser).losses++;
};

let usable = 0, noWinner = 0, unrated = 0;
for (const r of ordered) {
  const winners = new Set(r.outcome?.winners ?? (r.outcome?.winner ? [r.outcome.winner] : []));
  const rated = r.players.filter(p => !p.bot).map(p => ({ pid: p.id, team: p.team, entity: entityOf(r, p.id) }))
    .filter((p): p is { pid: string; team: number | undefined; entity: string } => p.entity !== null);
  if (!winners.size) { if (rated.length >= 2) noWinner++; continue; }
  const sides = new Map<number | string, typeof rated>();
  for (const p of r.players.filter(p => !p.bot)) sides.set(p.team ?? p.id, [...(sides.get(p.team ?? p.id) ?? []), ...rated.filter(x => x.pid === p.id)]);
  const teamMatch = [...sides.values()].some(side => side.length > 1) || r.players.filter(p => !p.bot).length > [...new Set(r.players.filter(p => !p.bot).map(p => p.team ?? p.id))].size;
  let scored = false;
  if (teamMatch) {
    // A team is rateable only when every member is the same entity: the pairing is then entity vs entity.
    const homogeneous = [...sides.values()]
      .filter(side => side.length >= 2 && new Set(side.map(p => p.entity)).size === 1)
      .map(side => ({ entity: side[0].entity, won: side.every(p => winners.has(p.pid)) }));
    for (const win of homogeneous.filter(t => t.won)) for (const loss of homogeneous.filter(t => !t.won)) {
      if (win.entity === loss.entity) continue;
      score(win.entity, loss.entity); scored = true;
    }
  } else {
    const winner = rated.find(p => winners.has(p.pid));
    for (const loser of rated.filter(p => !winners.has(p.pid))) {
      if (!winner || loser.entity === winner.entity) continue;
      score(winner.entity, loser.entity); scored = true;
    }
  }
  if (!scored) { unrated++; continue; }
  usable++;
  for (const p of rated) { stat(p.entity).games++; stat(p.entity).matches.add(r.id); }
}

const table = [...record.entries()]
  .map(([entity, s]) => ({ entity, rating: Math.round(of(entity)), ...s, matches: s.matches.size }))
  .sort((a, b) => b.rating - a.rating);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), replays: ordered.length, usable, noWinner, skippedWithoutRatedPair: unrated, table }, null, 2));
} else {
  console.log(`replays ${ordered.length} · scored ${usable} · no winner ${noWinner} · without a rated pair ${unrated}\n`);
  console.log("ELO   matches W-L     entity");
  for (const row of table) console.log(`${String(row.rating).padEnd(5)} ${String(row.matches).padEnd(7)} ${`${row.wins}-${row.losses}`.padEnd(7)} ${row.entity}`);
}
