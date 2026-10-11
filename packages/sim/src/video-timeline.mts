// The story of a replay for the highlights video (packages/video): players, winner, the fights worth showing,
// scripts uploaded and chat, all in game milliseconds; plus what the web's HUD components need (spectator
// player stats once a second, the events their feed shows, and the outcome).
//   npx tsx src/video-timeline.mts <replayId> [out.json]
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createMatch } from "@aoa/engine";

const id = process.argv[2];
if (!id) throw new Error("usage: video-timeline.mts <replayId> [out.json]");
const out = process.argv[3] ?? `../video/public/${id}.json`;
const r = JSON.parse(gunzipSync(readFileSync(new URL(`../../../replays/${id}.json.gz`, import.meta.url))).toString());
const tickMs = 1000 / r.tickRate;
const m = await createMatch({ ruleset: r.ruleset, seed: r.seed, tickRate: r.tickRate, players: r.players });
const byTick = new Map<number, any[]>();
for (const o of r.orders) (byTick.get(o.tick) ?? byTick.set(o.tick, []).get(o.tick)!).push(o);

const hits: number[] = [], deaths: { ms: number; owner: string; kind: string }[] = [], chat: { ms: number; from: string; text: string; to?: string }[] = [];
const built: Record<string, Record<string, number>> = Object.fromEntries(r.players.map((p: any) => [p.id, {}]));
const stats: { timeMs: number; players: unknown[] }[] = [], feed: any[] = [];
while (m.tick < r.finalTick) {
  const t = m.tick;
  if (t % r.tickRate === 0) stats.push({ timeMs: t * tickMs, players: m.spectate().players });
  for (const e of m.step(byTick.get(t) ?? []).events as any[]) {
    if (e.type !== "attack" && e.type !== "projectile" && e.type !== "projectile_end" && e.type !== "move") feed.push(e);
    const s = Math.floor((t * tickMs) / 1000);
    if ((e.type === "attack" || e.type === "projectile_end") && e.dmg) hits[s] = (hits[s] ?? 0) + 1;
    else if (e.type === "death") deaths.push({ ms: t * tickMs, owner: e.owner, kind: e.kind });
    else if (e.type === "spawn" && t > 0) built[e.owner][e.kind] = (built[e.owner][e.kind] ?? 0) + 1;
    else if (e.type === "chat") chat.push({ ms: t * tickMs, from: e.owner, text: e.text, ...(e.to ? { to: e.to } : {}) });
  }
}
m.dispose();

// Fights: runs of seconds with 3+ hits, merged across gaps under 8 s; scored by hits and fighting deaths.
const fights: { from: number; to: number; score: number }[] = [];
for (let s = 0; s < hits.length; s++) {
  if ((hits[s] ?? 0) < 3) continue;
  const last = fights.at(-1);
  if (last && s - last.to < 8) { last.to = s; last.score += hits[s]; } else fights.push({ from: s, to: s, score: hits[s] });
}
for (const f of fights) f.score += 15 * deaths.filter((d) => d.kind !== "worker" && d.ms >= f.from * 1000 && d.ms <= (f.to + 1) * 1000).length;
const endMs = r.finalTick * tickMs;
// The last fight (usually the decisive one) plus the two biggest before it, in order; padded for context.
const final = fights.at(-1);
const picked = fights.filter((f) => f !== final).sort((a, b) => b.score - a.score).slice(0, 2).concat(final ? [final] : []).sort((a, b) => a.from - b.from);
const highlights = picked.map((f) => {
  const fromMs = Math.max(0, (f.from - 5) * 1000), toMs = f === final ? endMs : Math.min(endMs, (f.to + 3) * 1000);
  const lost = Object.fromEntries(r.players.map((p: any) => [p.id, deaths.filter((d) => d.owner === p.id && d.kind !== "worker" && d.ms >= fromMs && d.ms <= toMs).length]));
  return { fromMs, toMs, lost, final: f === final };
});

const winners: string[] = r.outcome.winners ?? [];
const lostTotal = Object.fromEntries(r.players.map((p: any) => [p.id, deaths.filter((d) => d.owner === p.id && d.kind !== "worker").length]));
const timeline = {
  id, version: r.ruleset.version, map: r.ruleset.map.name, endMs,
  players: r.players.map((p: any, i: number) => ({ id: p.id, name: p.name, side: i, built: built[p.id], lost: lostTotal[p.id],
    orders: r.orders.filter((o: any) => o.player === p.id).length })),
  winners, reason: r.outcome.reason,
  kingDeathMs: deaths.find((d) => d.kind === "king")?.ms ?? null,
  highlights,
  scripts: r.orders.filter((o: any) => o.order.type === "script").map((o: any) => ({ ms: o.tick * tickMs, player: o.player, kind: o.order.kind, code: o.order.code })),
  chat,
  deaths: deaths.filter((d) => d.kind !== "worker"),
  matchMs: (r.ruleset.map.seats === 4 ? r.ruleset.fourSeatMatchMs : r.ruleset.matchMs) ?? r.ruleset.matchMs,
  tickMs, outcome: r.outcome, stats, feed,
};
writeFileSync(out, JSON.stringify(timeline, null, 1));
console.log(`${out}: ${highlights.length} highlights (${highlights.map((h) => `${Math.round(h.fromMs / 1000)}–${Math.round(h.toMs / 1000)}s`).join(", ")}), ${timeline.scripts.length} scripts, ${chat.length} chat`);
