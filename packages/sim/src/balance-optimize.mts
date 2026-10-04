// Searches combat values and costs so knights, rangers and turrets trade evenly (value destroyed per value lost)
// across every recorded battle and its variants, with the castle (economy, not defense) trading below all three
// but not far below,
// staying close to the current rules. (1+λ) evolution on the
// value grid: each candidate moves 1–3 values by 1–2 steps; candidates already fought are not fought again.
// Battles where nothing fights under the starting values are dropped. Racing: a candidate first fights a fixed
// third of the battles and only fights the rest if it is not clearly worse than the best there.
// Designed equal-cost battles (synthetic.ts) count half: each scenario's result (ln of A's loss ÷ B's loss, summed
// over sides and scripts) should hit its rock-paper-scissors target.
//   npx tsx src/balance-optimize.mts [generations] [hours]   → /tmp/aoa-opt/opt.log, /tmp/aoa-opt/best.json
//   BATTLES=file, VARIANTS=n (first n stagings: as recorded, open, jittered), FROM=values.json (search start),
//   STARTS=a.json,b.json,… (fight each, start from the most balanced; distance is then measured from it)
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { PARAMS, legal, start as snapped, type Values } from "./balance-params";
import { SCENARIOS, SYNTHETIC_COUNT, scenarioOf } from "./synthetic";

const WORKERS = 8, LAMBDA = 6, GENERATIONS = Number(process.argv[2] ?? 25), DEADLINE = Date.now() + Number(process.argv[3] ?? 1000) * 3_600_000,
  STAGINGS = Number(process.env.VARIANTS ?? 3), REG = 0.01;
const KINDS: [string, number][] = [["knight", 1], ["ranger", 1], ["turret", 0.5]];
/** The castle must trade below the weakest fighter (by CASTLE_MARGIN, log scale) but not under CASTLE_FLOOR of their
 *  average (v16: ~0.55), so the search can't meet it by weakening a fighter. */
const CASTLE_MARGIN = 0.05, CASTLE_FLOOR = 0.5, CASTLE_WEIGHT = 1;
const recordedIds: string[] = JSON.parse(readFileSync(process.env.BATTLES ?? "/tmp/aoa-opt/battles.json", "utf8")).map((b: { id: string }) => b.id);
const battles = recordedIds.length;
/** About 30% of recorded games are held out (all their battles): the search never sees them; the result is checked on them. */
const heldOut = (b: number) => { const g = recordedIds[b].split("#")[0]; let h = 0; for (const c of g) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 10 < 3; };
let jobs: [number, number][] = [];
for (let b = 0; b < battles; b++) for (let v = 0; v < STAGINGS; v++) jobs.push([b, v]);
const SYNTH = process.env.SYNTHETIC !== "0";
if (SYNTH) for (let i = 0; i < SYNTHETIC_COUNT; i++) jobs.push([battles + i, 0]);
const designed = (j: number) => jobs[j][0] >= battles;
const workers = Array.from({ length: WORKERS }, () => {
  const child = spawn(process.execPath, ["--import", "tsx", new URL("./balance-worker.mts", import.meta.url).pathname], { stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: child.stdout! })[Symbol.asyncIterator]();
  return { child, ask: async (msg: unknown) => { child.stdin!.write(JSON.stringify(msg) + "\n"); return JSON.parse(String((await lines.next()).value)); } };
});
const log = (s: string) => { console.log(s); appendFileSync("/tmp/aoa-opt/opt.log", s + "\n"); };

type Stats = { destroyed: Record<string, number>; lost: Record<string, number>; loss?: [number, number] };
/** Fights the given jobs on all workers, a few at a time so none sits idle; returns stats by job index. */
async function fight(values: Values, which: number[]): Promise<Map<number, Stats>> {
  const out = new Map<number, Stats>(), queue = [...which];
  await Promise.all(workers.map(async (w) => {
    while (queue.length) {
      const chunk = queue.splice(0, 3);
      const res: Stats[] = await w.ask({ values, jobs: chunk.map((j) => jobs[j]) });
      chunk.forEach((j, i) => out.set(j, res[i]));
    }
  }));
  return out;
}

/** Reads saved values; older files lack newer keys (those come from the current rules) or share one aim time. */
const load = (file: string): Values => {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const v = raw.values ?? raw;
  if (v.aimMs !== undefined) { v["knight.aimMs"] ??= v.aimMs; v["ranger.aimMs"] ??= v.aimMs; }
  return legal({ ...snapped(), ...v });
};
let start = snapped();
let from: Values = process.env.FROM ? load(process.env.FROM) : start;
function trades(stats: Stats[]) {
  const tot: Stats = { destroyed: {}, lost: {} };
  for (const st of stats) for (const f of ["destroyed", "lost"] as const) for (const [k, v] of Object.entries(st[f])) tot[f][k] = (tot[f][k] ?? 0) + v;
  return Object.fromEntries([...KINDS, ["castle"]].map(([k]) => [k, (tot.destroyed[k] ?? 0) / Math.max(1, tot.lost[k] ?? 0)]));
}
function parity(trade: Record<string, number>) {
  const logs = KINDS.map(([k]) => Math.log(Math.max(0.05, trade[k])));
  const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
  return { logs, mean, balance: KINDS.reduce((a, [, w], i) => a + w * (logs[i] - mean) ** 2, 0) };
}
function score(values: Values, stats: Map<number, Stats>, which: number[]) {
  const trade = trades(which.filter((j) => !designed(j)).map((j) => stats.get(j)!));
  const { logs, mean, balance: recorded } = parity(trade);
  const c = Math.log(Math.max(0.05, trade.castle));
  const castle = Math.max(0, c - Math.min(...logs) + CASTLE_MARGIN, Math.log(CASTLE_FLOOR) - (c - mean));
  const losses = new Map<number, [number, number]>();
  for (const j of which.filter(designed)) {
    const sc = scenarioOf(jobs[j][0] - battles), l = stats.get(j)!.loss!, acc = losses.get(sc) ?? [0, 0];
    if (l[0] + l[1] === 0) continue; // no contact (e.g. both sides hold): says nothing about the matchup
    losses.set(sc, [acc[0] + l[0], acc[1] + l[1]]);
  }
  const designedResult: Record<string, number> = {};
  let miss = 0, scored = 0;
  for (const [sc, [a, b]] of losses) {
    const t = SCENARIOS[sc].target;
    designedResult[SCENARIOS[sc].name] = Math.log((a + 50) / (b + 50));
    if (t !== undefined) { miss += (designedResult[SCENARIOS[sc].name] - t) ** 2; scored++; }
  }
  const rps = scored ? miss / scored : undefined;
  const balance = (rps !== undefined ? (recorded + rps) / 2 : recorded) + CASTLE_WEIGHT * castle ** 2;
  const drift = PARAMS.reduce((a, { key, min, max }) => a + ((values[key] - start[key]) / (max - min)) ** 2, 0);
  return { score: balance + REG * drift, balance, drift, trade, rps, designedResult };
}

const fmt = (v: Values) => PARAMS.map(({ key }) => `${key}=${v[key]}`).join(" ");
const fmtT = (t: Record<string, number>, rps?: number) => Object.entries(t).map(([k, x]) => `${k} ${x.toFixed(2)}`).join(" · ")
  + (rps !== undefined ? ` | rps miss ${rps.toFixed(3)}` : "");

// Drop battles where nothing fights, then fix the racing subset (every third active battle).
const first = await fight(from, jobs.map((_, j) => j));
let active = jobs.map((_, j) => j).filter((j) => designed(j) || Object.values(first.get(j)!.destroyed).some((v) => v > 0) || Object.values(first.get(j)!.lost).some((v) => v > 0));
const test = active.filter((j) => !designed(j) && heldOut(jobs[j][0]));
active = active.filter((j) => !test.includes(j));
const head = active.filter((_, i) => i % 3 === 0), tail = active.filter((_, i) => i % 3 !== 0);
const RACE = 1.25;
log(`battles ${jobs.length}, searching on ${active.length} (racing on ${head.length}), held out ${test.length}`);
const seen = new Set<string>();

let rnd = 12345;

let firstStats = first;
// Several starting points: fight each in full and keep the most balanced.
if (process.env.STARTS) {
  let top = { file: "current rules", values: from, stats: first, balance: score(from, first, active).balance };
  log(`start candidate current rules: balance ${top.balance.toFixed(4)}`);
  for (const file of process.env.STARTS.split(",")) {
    const values = load(file), stats = await fight(values, active), res = score(values, stats, active);
    log(`start candidate ${file}: balance ${res.balance.toFixed(4)} ${fmtT(res.trade, res.rps)}`);
    if (res.balance < top.balance) top = { file, values, stats, balance: res.balance };
  }
  log(`starting from ${top.file}`);
  from = start = top.values; firstStats = top.stats;
}
let best = { values: from, head: score(from, firstStats, head).score, ...score(from, firstStats, active) };
log(`start score ${best.score.toFixed(4)} (balance ${best.balance.toFixed(4)}) trades ${fmtT(best.trade, best.rps)}\n  ${fmt(best.values)}`);
const uniform = () => (rnd = (Math.imul(rnd, 1103515245) + 12345) >>> 0) / 2 ** 32;
seen.add(JSON.stringify(best.values));
// Stops early after 10 generations without improvement.
for (let g = 1, stale = 0; g <= GENERATIONS && Date.now() < DEADLINE && stale < 10; g++) {
  const before = best.score;
  for (let i = 0; i < LAMBDA && Date.now() < DEADLINE; i++) {
    let values = best.values;
    for (let tries = 0; tries < 50 && seen.has(JSON.stringify(values)); tries++) {
      const next = { ...best.values };
      for (let n = 1 + Math.floor(uniform() * 3); n > 0; n--) {
        const { key, step } = PARAMS[Math.floor(uniform() * PARAMS.length)];
        next[key] += (uniform() < 0.5 ? -1 : 1) * step * (uniform() < 0.7 ? 1 : 2);
      }
      values = legal(next);
    }
    if (seen.has(JSON.stringify(values))) continue;
    seen.add(JSON.stringify(values));
    const changed = PARAMS.filter(({ key }) => values[key] !== best.values[key]).map(({ key }) => `${key} ${best.values[key]}→${values[key]}`).join(", ");
    const early = await fight(values, head);
    const headScore = score(values, early, head).score;
    if (headScore > best.head * RACE) { log(`  try ${changed}: dropped after racing (${headScore.toFixed(4)} vs ${best.head.toFixed(4)})`); continue; }
    for (const [j, st] of await fight(values, tail)) early.set(j, st);
    const res = score(values, early, active);
    log(`  try ${changed}: ${res.score.toFixed(4)} (balance ${res.balance.toFixed(4)}) ${fmtT(res.trade, res.rps)}`);
    if (res.score < best.score) best = { values, head: headScore, ...res };
  }
  log(`gen ${g}: best ${best.score.toFixed(4)} (balance ${best.balance.toFixed(4)}, drift ${best.drift.toFixed(3)}) trades ${fmtT(best.trade, best.rps)}\n  ${fmt(best.values)}`);
  writeFileSync("/tmp/aoa-opt/best.json", JSON.stringify(best, null, 1));
  stale = best.score < before ? 0 : stale + 1;
}
// The result on the held-out games, against where the search started.
const check = async (label: string, values: Values) => {
  const res = score(values, await fight(values, test), test);
  log(`held out, ${label}: balance ${res.balance.toFixed(4)} ${fmtT(res.trade)}`);
};
await check("start", from);
await check("best", best.values);
for (const w of workers) w.child.kill();
