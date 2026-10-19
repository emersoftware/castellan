/**
 * Headless benchmark against the reference bots (no server, no real time):
 *   pnpm --filter @castellan/castellan-bot bench [--bots rush,eco] [--maps open,fortress] [--n 2] [--json out.json]
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { playerResult, type RoomMode } from "@castellan/shared";
import { BOTS } from "@castellan/sim";
import { playHeadless } from "../test/harness";

const { values } = parseArgs({ args: process.argv.slice(2), options: {
  bots: { type: "string", default: Object.keys(BOTS).join(",") }, maps: { type: "string", default: "open,fortress" }, n: { type: "string", default: "2" }, json: { type: "string" }, every: { type: "string", default: "10" }, verbose: { type: "boolean", default: false }, seats: { type: "string" }, mode: { type: "string" }, seed: { type: "string" },
} });
const rows: ({ result: ReturnType<typeof playerResult> } & Record<string, unknown>)[] = [];
const QUIET = new Set(["workers_assigned", "order_rejected", "build_planned"]);
const verbose = values.verbose ? (p: string, e: { tick: number; type: string; [k: string]: unknown }) => { if (!QUIET.has(e.type)) { const { t, tick, type, ...rest } = e; console.log(`${p} [${(tick / 10).toFixed(0)}s] ${type} ${JSON.stringify(rest).slice(0, 200)}`); } } : undefined;
if (values.seats) {
  // One match with explicit seats, e.g. --seats castellan,castellan,eco,rush --map quad --mode teams
  const seats = values.seats.split(",").map((k) => (k === "castellan" ? { kind: "castellan" as const } : { kind: "bot" as const, bot: k }));
  const map = values.maps!.split(",")[0];
  const r = await playHeadless({ seats, map, seed: Number(values.seed ?? 100), everyTicks: Number(values.every), chat: true, mode: values.mode as RoomMode | undefined, onEntry: verbose });
  for (const [pid, p] of Object.entries(r.players)) {
    if (!p.core) continue;
    const w = p.core.world!;
    console.log(JSON.stringify({ player: pid, result: playerResult(r.outcome, pid), reason: r.outcome.reason, minutes: +(r.ticks / 600).toFixed(1),
      castles: w.castles.length, towers: w.towers.length, walls: (w.byKind.wall ?? []).length, doors: (w.byKind.door ?? []).length, army: w.army.length, workers: w.workers.length,
      expansion: p.core.plan.expansion?.status ?? "none", keep: p.core.plan.keep.status, truces: Object.keys(p.core.plan.truces), chatSent: p.core.stats.chatSent, chatReceived: p.core.stats.chatReceived,
      rejected: p.rejected, scriptErrors: p.core.stats.scriptErrors, episodes: p.core.episodes.map((e) => `${e.kind}:${e.status}`).join(" ") }));
  }
  console.log("chat:", r.players.p1.chat.slice(0, 12).map((c) => `[${c.tick}] ${c.from}${c.channel ? ` (${c.channel}${c.to ? ` to ${c.to}` : ""})` : ""}: ${c.text}`).join("\n"));
  process.exit(0);
}
for (const map of values.maps!.split(",")) for (const bot of values.bots!.split(",")) for (let i = 0; i < Number(values.n); i++) {
  const seed = 100 + i;
  const flip = i % 2 === 1;
  const started = Date.now();
  const r = await playHeadless({ seats: flip ? [{ kind: "bot", bot }, { kind: "castellan" }] : [{ kind: "castellan" }, { kind: "bot", bot }], map, seed, everyTicks: Number(values.every), onEntry: verbose });
  const me = flip ? "p2" : "p1";
  const core = r.players[me].core!;
  const w = core.world!;
  const won = playerResult(r.outcome, me);
  const deaths = (owner: string) => r.events.filter((e) => e.type === "death" && e.owner === owner).reduce((m: Record<string, number>, e) => ((m[(e as { kind: string }).kind] = (m[(e as { kind: string }).kind] ?? 0) + 1), m), {});
  const row = { map, bot, seed, side: flip ? 1 : 0, result: won, reason: r.outcome.reason, minutes: +(r.ticks / 600).toFixed(1),
    castles: w.castles.length, towers: w.towers.length, walls: (w.byKind.wall ?? []).length, doors: (w.byKind.door ?? []).length, army: w.army.length, workers: w.workers.length,
    expansion: core.plan.expansion?.status ?? "none", keep: core.plan.keep.status, rejected: r.players[me].rejected, orders: r.players[me].orders, scriptErrors: core.stats.scriptErrors,
    lost: deaths(me), killed: deaths(me === "p1" ? "p2" : "p1"), episodes: core.episodes.map((e) => `${e.kind}:${e.status}`).join(" "), wallMs: Date.now() - started };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const wins = rows.filter((r) => r.result === "win").length;
console.log(`castellan: ${wins}/${rows.length} wins, ${rows.filter((r) => r.result === "loss").length} losses, ${rows.filter((r) => r.result === "draw").length} draws`);
if (values.json) writeFileSync(values.json, JSON.stringify(rows, null, 1));
