// One optimizer worker: reads {values, jobs} lines, fights those battles, writes per-battle stats
// (damage value dealt by each kind, and damage value taken scaled by what numbers predicted).
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { runBattle, type Snapshot, type Variant } from "./battles";
import { rulesWith, type Values } from "./balance-params";
import { scenario } from "./synthetic";
const battles: Snapshot[] = JSON.parse(readFileSync(process.env.BATTLES ?? "/tmp/aoa-opt/battles.json", "utf8"));
export const VARIANTS: Variant[] = [{}, { open: true }, { jitter: 2, seed: 7 }];
const add = (into: Record<string, number>, from: Record<string, number>, w = 1) => { for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + w * v; };
for await (const line of createInterface({ input: process.stdin })) {
  const { values, jobs } = JSON.parse(line) as { values: Values; jobs: [number, number][] };
  const ruleset = rulesWith(values);
  const results = [];
  for (const [b, v] of jobs) {
    const destroyed: Record<string, number> = {}, lost: Record<string, number> = {};
    // Indexes past the recorded battles are designed ones, built for these costs.
    const fixture = b < battles.length ? battles[b] : scenario(b - battles.length, ruleset);
    const res = await runBattle(fixture, ruleset, VARIANTS[v]);
    if (res.errors || res.rejectedOrders) throw new Error(`Battle ${fixture.id} is not a valid balance sample: ${res.errors} script errors, ${res.rejectedOrders} rejected setup orders`);
    // Numbers decide part of a fight: a side with r times the enemy's army is expected to deal r times the
    // damage value it takes (Lanchester). So each kind's damage taken is scaled by r, and destroyed ÷ lost
    // reads as performance against what its side's numbers predicted (1 = as expected).
    const sides = Object.values(res.sides), total = sides.reduce((a, x) => a + x.army, 0);
    for (const x of sides) {
      if (total === 0) break;
      const r = Math.min(10, Math.max(0.1, x.army / Math.max(1, total - x.army)));
      add(destroyed, x.dealt);
      add(lost, x.taken, r);
    }
    // Designed battles also report what each side lost in fighters (castles aside): A is team 0, B team 1.
    const loss = (team: string) => Object.entries(res.sides[team]?.taken ?? {}).reduce((a, [k, v]) => a + (k === "castle" ? 0 : v), 0);
    results.push(b < battles.length ? { destroyed, lost } : { destroyed, lost, loss: [loss("0"), loss("1")] });
  }
  process.stdout.write(JSON.stringify(results) + "\n");
}
