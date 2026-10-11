// Baseline: every recorded battle under the current rules, as recorded and without walls.
import { readFileSync } from "node:fs";
import { runBattle, type Snapshot } from "./battles";
const battles: Snapshot[] = JSON.parse(readFileSync(process.argv[2] ?? "/tmp/aoa-opt/battles.json", "utf8"));
const t0 = Date.now();
const sum = (into: Record<string, number>, from: Record<string, number>) => { for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v; };
const destroyed: Record<string, number> = {}, lost: Record<string, number> = {}, engaged: Record<string, number> = {};
let ticks = 0, n = 0;
for (const b of battles) for (const variant of [{}, { open: true }]) {
  const res = await runBattle(b, undefined, variant);
  ticks += res.ticks; n++;
  sum(destroyed, res.destroyedBy); sum(lost, res.lostKind); sum(engaged, res.engaged);
}
console.log(`${n} battles in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${ticks} ticks`);
for (const k of ["knight", "archer", "tower", "castle", "worker", "king", "wall"]) console.log(k.padEnd(8), "engaged", String(engaged[k] ?? 0).padStart(7), "destroyed", String(destroyed[k] ?? 0).padStart(7), "lost", String(lost[k] ?? 0).padStart(7), "trade", ((destroyed[k] ?? 0) / Math.max(1, lost[k] ?? 0)).toFixed(2));
