// Picks script sets players wrote (knight, archer, tower; one per player and game, newest rules first) that
// run without errors and fight in a designed battle, for synthetic.ts.
//   npx tsx src/script-sets.mts [count]   → /tmp/castellan-opt/script-sets.json
import { readFileSync, writeFileSync } from "node:fs";
import type { EntityKind } from "@castellan/shared";
import { runBattle, type Snapshot } from "./battles";
import { rulesWith, start } from "./balance-params";
import { SCENARIOS, designedIndex, scenario } from "./synthetic";
const want = Number(process.argv[2] ?? 8);
const SCRIPTED: EntityKind[] = ["knight", "archer", "tower"];
const battles: Snapshot[] = JSON.parse(readFileSync(process.env.BATTLES ?? "/tmp/castellan-opt/battles-all.json", "utf8"));
const version = (v: string) => Number(v.match(/^v(\d+)/)?.[1] ?? 0);
const seen = new Set<string>(), candidates: { set: Record<string, string>; version: number }[] = [];
for (const b of battles) for (const kinds of Object.values(b.scripts)) {
  const set = Object.fromEntries(Object.entries(kinds).filter(([k]) => SCRIPTED.some((s) => s === k)));
  const key = JSON.stringify(set);
  if ((set.knight || set.archer) && !seen.has(key)) { seen.add(key); candidates.push({ set, version: version(b.version) }); }
}
candidates.sort((a, b) => b.version - a.version);
const r = rulesWith(start());
const base = scenario(designedIndex(SCENARIOS.findIndex((s) => s.name === "knights vs mixed")), r);
const picked: Record<string, string>[] = [];
// Both sides run the set in "knights vs mixed"; keep sets without errors whose units deal real damage.
for (const c of candidates) {
  if (picked.length >= want) break;
  const res = await runBattle({ ...base, scripts: { p1: c.set, p2: c.set } }, r);
  const dealt = Object.values(res.sides).reduce((a, x) => a + Object.values(x.dealt).reduce((p, q) => p + q, 0), 0);
  if (res.errors === 0 && res.rejectedOrders === 0 && dealt > 200) picked.push(c.set);
}
writeFileSync("/tmp/castellan-opt/script-sets.json", JSON.stringify(picked));
console.log(`candidates ${candidates.length}, picked ${picked.length}`);
