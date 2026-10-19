// Snapshots every fight (a hit after 20 s without hits, 1–2 s before it) of the replays in the catalogue
// that the current engine reproduces, for the balance optimizer's recorded battles.
//   npx tsx src/extract-recent.mts > /tmp/castellan-opt/battles-recent.json
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { createMatch } from "@castellan/engine";
import type { ReplayFile } from "@castellan/shared";
import { assertBalanceReplay, replayContinuation, type Snapshot } from "./battles";
const dir = process.env.REPLAYS ?? resolve(import.meta.dirname, "../../../replays");
const out: Snapshot[] = [];
let games = 0, skipped = 0;
for (const f of readdirSync(dir).filter((f) => /^[0-9a-f]{8}\.json\.gz$/.test(f))) {
  const r: ReplayFile = JSON.parse(gunzipSync(readFileSync(`${dir}/${f}`)).toString());
  try { assertBalanceReplay(r); }
  catch (error) { skipped++; console.error(`${r.id} skipped: ${(error as Error).message}`); continue; }
  if (r.players.some((p) => "bot" in p && p.bot)) { skipped++; continue; }
  const config = { ruleset: r.ruleset, seed: r.seed, tickRate: r.tickRate, players: r.players };
  const m = await createMatch(config);
  const byTick = new Map<number, any[]>();
  for (const o of r.orders) (byTick.get(o.tick) ?? byTick.set(o.tick, []).get(o.tick)!).push(o);
  const kinds = Object.keys(r.ruleset.kinds);
  const history: any[] = [], found: any[] = [];
  const GAP = 20 * r.tickRate;
  let lastHit = -Infinity, desync = false;
  const owners = new Map<string, string>();
  while (m.tick < r.finalTick && !m.outcome) {
    const t = m.tick;
    // A full view once a second (cheap enough); the fight's snapshot is the one 1–2 s before its first hit.
    if (t % r.tickRate === 0) {
      const view = m.spectate();
      for (const e of view.entities) owners.set(e.id, e.owner);
      history.push({ tick: t, hash: m.hash(), view, scripts: Object.fromEntries(r.players.map((p) => [p.id, Object.fromEntries(kinds
        .map((k) => [k, m.scriptSource(p.id, k)] as const).filter(([, s]) => s?.custom).map(([k, s]) => [k, s!.code]))])) });
      if (history.length > 2) history.shift();
    }
    let hit = false;
    for (const e of m.step(byTick.get(t) ?? []).events) {
      if (e.type === "spawn") owners.set(e.id, e.owner);
      if (e.type === "attack" && e.dmg > 0 && e.to && owners.get(e.from) && owners.get(e.to) && owners.get(e.from) !== owners.get(e.to)) hit = true;
      if (e.type === "projectile_end" && e.target && e.dmg > 0 && owners.get(e.target)) hit = true;
    }
    if (r.hashes[t] !== undefined && m.hash() !== r.hashes[t]) desync = true;
    if (hit && t - lastHit >= GAP) found.push(history[0]);
    if (hit) lastHit = t;
  }
  // Only replays the engine reproduces exactly.
  const ok = !desync && m.tick === r.finalTick && r.hashes[m.tick] !== undefined && m.hash() === r.hashes[m.tick];
  m.dispose();
  if (!ok) { skipped++; console.error(`${r.id} skipped (does not reproduce)`); continue; }
  games++;
  console.error(`${r.id} ${r.ruleset.version}: ${found.length} fights`);
  found.forEach((snap, n) => out.push({
    format: "castellan-battle-v2",
    id: `${r.id}#${n}`, version: r.ruleset.version,
    continuation: replayContinuation(r, snap.tick, snap.hash),
    map: { name: r.ruleset.map.name, width: r.ruleset.map.width, height: r.ruleset.map.height, walls: r.ruleset.map.walls, seats: r.ruleset.map.seats ?? 2 },
    players: snap.view.players.map((p: any) => ({ id: p.id, team: p.team ?? r.players.findIndex((q: any) => q.id === p.id), upgrades: p.upgrades ?? {} })),
    entities: snap.view.entities.map((e: any) => ({ id: e.id, kind: e.kind, owner: e.owner, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, order: e.order })),
    scripts: snap.scripts,
  }));
}
console.error(`games ${games}, battles ${out.length}, skipped ${skipped}`);
console.log(JSON.stringify(out));
