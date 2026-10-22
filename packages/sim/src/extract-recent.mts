// Snapshots every fight (a hit after 20 s without hits, 1–2 s before it) of the replays in the catalogue
// that the current engine reproduces, for the balance optimizer's recorded battles.
//   npx tsx src/extract-recent.mts > /tmp/castellan-opt/battles-recent.json
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { recordingOf, resimulate } from "@castellan/engine";
import type { ReplayFile, SpectatorView } from "@castellan/shared";
import { localReplays } from "@castellan/shared/local-data";
import { assertBalanceReplay, replayContinuation, type Snapshot } from "./battles";
const dir = process.env.REPLAYS ?? localReplays();
const out: Snapshot[] = [];
let games = 0, skipped = 0;
for (const f of readdirSync(dir).filter((f) => /^[0-9a-f]{8}\.json\.gz$/.test(f))) {
  const r: ReplayFile = JSON.parse(gunzipSync(readFileSync(`${dir}/${f}`)).toString());
  try { assertBalanceReplay(r); }
  catch (error) { skipped++; console.error(`${r.id} skipped: ${(error as Error).message}`); continue; }
  if (r.players.some((p) => "bot" in p && p.bot)) { skipped++; continue; }
  const kinds = Object.keys(r.ruleset.kinds);
  type Moment = { tick: number; hash: string; view: SpectatorView; scripts: Record<string, Record<string, string>> };
  const history: Moment[] = [], found: Moment[] = [];
  const GAP = 20 * r.tickRate;
  let lastHit = -Infinity;
  const owners = new Map<string, string>();
  const { match, check } = await resimulate(recordingOf(r), {
    // A full view once a second (cheap enough); the fight's snapshot is the one 1–2 s before its first hit.
    before: (m) => {
      if (m.tick % r.tickRate !== 0) return;
      const view = m.spectate();
      for (const e of view.entities) owners.set(e.id, e.owner);
      history.push({ tick: m.tick, hash: m.hash(), view, scripts: Object.fromEntries(r.players.map((p) => [p.id, Object.fromEntries(kinds
        .map((k) => [k, m.scriptSource(p.id, k)] as const).filter(([, s]) => s?.custom).map(([k, s]) => [k, s!.code]))])) });
      if (history.length > 2) history.shift();
    },
    after: (_m, { tick: t, events }) => {
      let hit = false;
      for (const e of events) {
        if (e.type === "spawn") owners.set(e.id, e.owner);
        if (e.type === "attack" && e.dmg > 0 && e.to && owners.get(e.from) && owners.get(e.to) && owners.get(e.from) !== owners.get(e.to)) hit = true;
        if (e.type === "projectile_end" && e.target && e.dmg > 0 && owners.get(e.target)) hit = true;
      }
      if (hit && t - lastHit >= GAP) found.push(history[0]);
      if (hit) lastHit = t;
    },
  });
  match.dispose();
  // Only replays the engine reproduces exactly, up to a recorded final state.
  const ok = check.verified && r.hashes[r.finalTick] !== undefined;
  if (!ok) { skipped++; console.error(`${r.id} skipped (does not reproduce)`); continue; }
  games++;
  console.error(`${r.id} ${r.ruleset.version}: ${found.length} fights`);
  found.forEach((snap, n) => out.push({
    format: "castellan-battle-v2",
    id: `${r.id}#${n}`, version: r.ruleset.version,
    continuation: replayContinuation(r, snap.tick, snap.hash),
    map: { name: r.ruleset.map.name, width: r.ruleset.map.width, height: r.ruleset.map.height, walls: r.ruleset.map.walls, seats: r.ruleset.map.seats ?? 2 },
    players: snap.view.players.map((p) => ({ id: p.id, team: p.team ?? r.players.findIndex((q) => q.id === p.id), upgrades: p.upgrades ?? {} })),
    entities: snap.view.entities.map((e) => ({ id: e.id, kind: e.kind, owner: e.owner, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, order: e.order })),
    scripts: snap.scripts,
  }));
}
console.error(`games ${games}, battles ${out.length}, skipped ${skipped}`);
console.log(JSON.stringify(out));
