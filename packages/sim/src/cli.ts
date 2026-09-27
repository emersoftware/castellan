/**
 * Headless balance runs.
 *   pnpm sim --a rush --b eco --n 20 --latency-a 3000 --latency-b 3000
 *   pnpm sim --matrix            every bot against every bot
 *   pnpm sim --latency-curve     the same bot with different decision delays
 */
import { BOTS, simulate } from "./index";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i].replace(/^--/, "");
  const v = process.argv[i + 1]?.startsWith("--") || process.argv[i + 1] === undefined ? "1" : process.argv[++i];
  args.set(k, v);
}
const n = Number(args.get("n") ?? 10);

async function series(a: string, b: string, la: number, lb: number) {
  let wa = 0, wb = 0, draws = 0, ticks = 0, timeouts = 0;
  for (let i = 0; i < n; i++) {
    // Alternate sides so the map position doesn't bias the result.
    const swap = i % 2 === 1;
    const A = { bot: BOTS[a](), latencyMs: la };
    const B = { bot: BOTS[b](), latencyMs: lb };
    const r = await simulate(swap ? B : A, swap ? A : B, { seed: 1000 + i, map: args.get("map") });
    ticks += r.ticks;
    if (r.outcome.reason === "timeout") timeouts++;
    const w = r.outcome.winner;
    if (w === null) draws++;
    else if ((w === "p1") !== swap) wa++;
    else wb++;
  }
  const pct = (x: number) => `${Math.round((100 * x) / n)}%`.padStart(4);
  console.log(`${a}@${la}ms vs ${b}@${lb}ms  ${pct(wa)} / ${pct(wb)}  draws ${draws}  avg ${(ticks / n / 10 / 60).toFixed(1)} min  timeouts ${timeouts}`);
}

if (args.has("matrix")) {
  const names = Object.keys(BOTS);
  for (let i = 0; i < names.length; i++) for (let j = i; j < names.length; j++) await series(names[i], names[j], 3000, 3000);
} else if (args.has("latency-curve")) {
  const bot = args.get("bot") ?? "eco";
  for (const l of [1000, 5000, 10000, 15000]) await series(bot, bot, 3000, l);
} else {
  await series(args.get("a") ?? "rush", args.get("b") ?? "eco", Number(args.get("latency-a") ?? 3000), Number(args.get("latency-b") ?? 3000));
}
