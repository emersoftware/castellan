// The story of a replay for the highlights video (packages/video): players, winner, the fights worth showing,
// scripts uploaded and chat, all in game milliseconds; plus what the web's HUD components need (spectator
// player stats once a second, the events their feed shows, and the outcome).
//   npx tsx src/video-timeline.mts <replayId> [out.json]
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { recordingWithShutdowns, resimulate } from "@castellan/engine";
import type { GameEvent, RecordedKind, ReplayFile } from "@castellan/shared";

const id = process.argv[2];
if (!id) throw new Error("usage: video-timeline.mts <replayId> [out.json]");
const out = process.argv[3] ?? `../video/public/${id}.json`;
const r: ReplayFile = JSON.parse(gunzipSync(readFileSync(new URL(`../../../replays/${id}.json.gz`, import.meta.url))).toString());
const tickMs = 1000 / r.tickRate;

const hits: number[] = [], deaths: { ms: number; owner: string; kind: RecordedKind }[] = [], chat: { ms: number; from: string; text: string; to?: string }[] = [];
const built: Record<string, Record<string, number>> = Object.fromEntries(r.players.map((p) => [p.id, {}]));
const stats: { timeMs: number; players: unknown[] }[] = [], feed: GameEvent[] = [];
/** Uploads the engine installed; rejected ones never ran. */
const scripts: { ms: number; player: string; kind: string; code: string | null }[] = [];
const { match, check } = await resimulate(recordingWithShutdowns(r), {
  before: (m) => { if (m.tick % r.tickRate === 0) stats.push({ timeMs: m.tick * tickMs, players: m.spectate().players }); },
  after: (_m, { tick: t, input, results, events }) => {
    input.forEach(({ player, order }, i) => { if (order.type === "script" && results[i].ok) scripts.push({ ms: t * tickMs, player, kind: order.kind, code: order.code }); });
    for (const e of events) {
      if (e.type !== "attack" && e.type !== "projectile_end") feed.push(e);
      const s = Math.floor((t * tickMs) / 1000);
      if ((e.type === "attack" || e.type === "projectile_end") && e.dmg) hits[s] = (hits[s] ?? 0) + 1;
      else if (e.type === "death") deaths.push({ ms: t * tickMs, owner: e.owner, kind: e.kind });
      else if (e.type === "spawn" && t > 0) built[e.owner][e.kind] = (built[e.owner][e.kind] ?? 0) + 1;
      else if (e.type === "chat") chat.push({ ms: t * tickMs, from: e.owner, text: e.text, ...(e.to ? { to: e.to } : {}) });
    }
  },
});
match.dispose();
if (!check.verified) throw new Error(`replay ${id} does not reproduce from tick ${check.desyncAt}; its timeline would show a different match`);

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
  const lost = Object.fromEntries(r.players.map((p) => [p.id, deaths.filter((d) => d.owner === p.id && d.kind !== "worker" && d.ms >= fromMs && d.ms <= toMs).length]));
  return { fromMs, toMs, lost, final: f === final };
});

const winners: string[] = r.outcome.winners ?? [];
const lostTotal = Object.fromEntries(r.players.map((p) => [p.id, deaths.filter((d) => d.owner === p.id && d.kind !== "worker").length]));
const timeline = {
  id, version: r.ruleset.version, map: r.ruleset.map.name, endMs,
  players: r.players.map((p, i) => ({ id: p.id, name: p.name, side: i, built: built[p.id], lost: lostTotal[p.id],
    orders: r.orders.filter((o) => o.player === p.id).length })),
  winners, reason: r.outcome.reason,
  kingDeathMs: deaths.find((d) => d.kind === "king")?.ms ?? null,
  highlights,
  scripts,
  chat,
  deaths: deaths.filter((d) => d.kind !== "worker"),
  matchMs: (r.ruleset.map.seats === 4 ? r.ruleset.fourSeatMatchMs : r.ruleset.matchMs) ?? r.ruleset.matchMs,
  tickMs, outcome: r.outcome, stats, feed,
};
writeFileSync(out, JSON.stringify(timeline, null, 1));
console.log(`${out}: ${highlights.length} highlights (${highlights.map((h) => `${Math.round(h.fromMs / 1000)}–${Math.round(h.toMs / 1000)}s`).join(", ")}), ${timeline.scripts.length} scripts, ${chat.length} chat`);
