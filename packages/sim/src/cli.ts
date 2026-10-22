/**
 * Headless balance runs.
 *   pnpm sim --a rush --b eco --n 20 --latency-a 3000 --latency-b 3000
 *   pnpm sim --matrix            every bot against every bot
 *   pnpm sim --latency-curve     the same bot with different decision delays
 */
import { BOTS } from "@castellan/bots";
import type { BotName } from "@castellan/shared";
import { simulate } from "./index";
import { MAPS, rules, playerResult } from "@castellan/shared";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i].replace(/^--/, "");
  const v = process.argv[i + 1]?.startsWith("--") || process.argv[i + 1] === undefined ? "1" : process.argv[++i];
  args.set(k, v);
}
const n = Number(args.get("n") ?? 10);
const defaults: Record<"a" | "b" | "bot", BotName> = { a: "rush", b: "eco", bot: "eco" };

async function series(a: string, b: string, la: number, lb: number) {
  let wa = 0, wb = 0, lossesA = 0, lossesB = 0, draws = 0, allDefeated = 0, ticks = 0, timeouts = 0, rejected = 0;
  const reasons: Record<string, number> = {};
  const ruleset = args.has("map") ? { ...rules, map: MAPS[args.get("map")!] } : rules;
  for (let i = 0; i < n; i++) {
    // Alternate sides so the map position doesn't bias the result.
    const swap = i % 2 === 1;
    const A = { bot: BOTS[a](ruleset), latencyMs: la };
    const B = { bot: BOTS[b](ruleset), latencyMs: lb };
    const r = await simulate(swap ? B : A, swap ? A : B, { seed: 1000 + i, map: args.get("map") });
    ticks += r.ticks;
    rejected += r.rejectedOrders.length;
    for (const { result } of r.rejectedOrders) if (!result.ok) reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
    if (r.outcome.reason === "timeout") timeouts++;
    const ra = playerResult(r.outcome, swap ? "p2" : "p1");
    const rb = playerResult(r.outcome, swap ? "p1" : "p2");
    if (ra === "win") wa++;
    if (rb === "win") wb++;
    if (ra === "loss") lossesA++;
    if (rb === "loss") lossesB++;
    if (ra === "draw") draws++;
    if (r.outcome.allDefeated) allDefeated++;
  }
  const pct = (x: number) => `${Math.round((100 * x) / n)}%`.padStart(4);
  console.log(`${a}@${la}ms vs ${b}@${lb}ms  ${pct(wa)} / ${pct(wb)}  losses ${lossesA} / ${lossesB}  all defeated ${allDefeated}  draws ${draws}  avg ${(ticks / n / 10 / 60).toFixed(1)} min  timeouts ${timeouts}  rejected ${rejected}`);
  if (rejected) console.log(JSON.stringify({ rejectedReasons: reasons }));
}

if (args.has("matrix")) {
  const names = Object.keys(BOTS);
  for (let i = 0; i < names.length; i++) for (let j = i; j < names.length; j++) await series(names[i], names[j], 3000, 3000);
} else if (args.has("latency-curve")) {
  const bot = args.get("bot") ?? defaults.bot;
  for (const l of [1000, 5000, 10000, 15000]) await series(bot, bot, 3000, l);
} else {
  await series(args.get("a") ?? defaults.a, args.get("b") ?? defaults.b, Number(args.get("latency-a") ?? 3000), Number(args.get("latency-b") ?? 3000));
}
