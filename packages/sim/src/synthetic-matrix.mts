// Who beats whom for the same money: every designed battle under the given values (default: current rules).
//   npx tsx src/synthetic-matrix.mts [values.json] [script pair, default 0: standard]
import { readFileSync } from "node:fs";
import { fighterLoss, runBattle } from "./battles";
import { rulesWith, start } from "./balance-params";
import { SCENARIOS, designedIndex, scenario } from "./synthetic";
const values = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], "utf8")) : start();
const r = rulesWith(values);
const pair = Number(process.argv[3] ?? 0);
for (let i = 0; i < SCENARIOS.length * 2; i++) {
  const s = scenario(designedIndex(Math.floor(i / 2), i % 2, pair), r);
  const count = (o: string) => Object.entries(s.entities.filter((e) => e.owner === o && e.kind !== "wall" && e.kind !== "castle").reduce((a, e) => ({ ...a, [e.kind]: (a[e.kind] ?? 0) + 1 }), {} as Record<string, number>)).map(([k, n]) => `${n} ${k}`).join(" + ");
  const res = await runBattle(s, r);
  const left = (o: string) => Math.round(fighterLoss(res.sides[o === "p1" ? "0" : "1"]));
  const target = SCENARIOS[Math.floor(i / 2)].target;
  const want = target === undefined ? "—" : target > 0.01 ? "B" : target < -0.01 ? "A" : "=";
  console.log(`${s.id.replace(/^synthetic:| \[scripts.*$/g, "").padEnd(60)} ${count("p1").padEnd(22)} lost ${String(left("p1")).padStart(5)} | ${count("p2").padEnd(28)} lost ${String(left("p2")).padStart(5)} | want ${want} | errors ${res.errors}`);
}
