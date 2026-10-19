import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { ReplayFile, SeriesSummary } from "../packages/shared/src/protocol";
import { playerResult } from "../packages/shared/src/outcome";
import { replayPlayerSummaries, type ReplayPlayerSummary } from "../packages/shared/src/replayMetadata";
import { replayArchive } from "../packages/shared/src/replayArchive";
import { hasScriptedBot } from "../packages/web/src/replayCatalog";

interface Entry {
  id: string;
  title?: string;
  createdAt: string;
  savedAt: string;
  players: ReplayPlayerSummary[];
  outcome: ReplayFile["outcome"];
  finalTick: number;
  tickRate: number;
  map?: string;
  rulesVersion?: string;
}
export interface Publication {
  replays: { replay: ReplayFile; summary: Entry }[];
  series: { summary: SeriesSummary; savedAt: string }[];
  excluded: number;
}

async function optionalIndex(path: string): Promise<Entry[]> {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
}

/** Select the portable replay fields; never publish room/series checkpoints or player tokens. */
export function publicReplay(value: ReplayFile): ReplayFile {
  if (value.format !== 1 || !/^[a-zA-Z0-9_-]+$/.test(value.id) || !Array.isArray(value.orders)
    || !value.outcome || !value.ruleset || !value.hashes || !Array.isArray(value.players) || value.players.length < 2
    || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isInteger(value.finalTick) || value.finalTick < 0
    || !Number.isFinite(value.tickRate) || value.tickRate <= 0) throw new Error(`Invalid finished replay: ${value.id ?? "unknown"}`);
  return {
    format: 1, id: value.id, createdAt: value.createdAt, ruleset: value.ruleset, seed: value.seed,
    tickRate: value.tickRate, players: value.players.map(({ id, name, side, team }) => ({ id, name, side, team })),
    orders: value.orders, hashes: value.hashes, finalTick: value.finalTick, outcome: value.outcome,
    ...(value.timing ? { timing: value.timing } : {}), ...(value.chat !== undefined ? { chat: value.chat } : {}),
    ...(value.series ? { series: { id: value.series.id, gameNumber: value.series.gameNumber, totalGames: 3 } } : {}),
    // The viewer needs recorded sandbox interruptions to re-simulate the match; nothing else of the manifest is public.
    ...(value.experiment?.operationalFailures?.length ? { experiment: { operationalFailures: value.experiment.operationalFailures } as ReplayFile["experiment"] } : {}),
  };
}

export function completeSeries(entries: Publication["replays"], titles: Record<string, string> = {}): Publication["series"] {
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const id = entry.replay.series?.id;
    if (id) groups.set(id, [...(groups.get(id) ?? []), entry]);
  }
  const series: Publication["series"] = [];
  for (const [id, entries] of groups) {
    const games = [...entries].sort((a, b) => a.replay.series!.gameNumber - b.replay.series!.gameNumber);
    if (games.length !== 3 || games.some((g, i) => g.replay.series!.gameNumber !== i + 1)) continue;
    const players = games[0].replay.players.map(({ id, name, team }, i) => ({ id, name, team: team ?? i }));
    if (games.some((g) => JSON.stringify(g.replay.players.map(({ id, name, team }, i) => ({ id, name, team: team ?? i }))) !== JSON.stringify(players))) {
      throw new Error(`Series ${id} has inconsistent players`);
    }
    const score = Object.fromEntries(players.map((p) => [p.id, 0]));
    const losses = Object.fromEntries(players.map((p) => [p.id, 0]));
    for (const { replay } of games) for (const winner of replay.outcome.winners ?? (replay.outcome.winner ? [replay.outcome.winner] : [])) {
      if (!(winner in score)) throw new Error(`Unknown winner in series ${id}`);
      score[winner]++;
    }
    for (const { replay } of games) for (const p of players) if (playerResult(replay.outcome, p.id) === "loss") losses[p.id]++;
    const max = Math.max(...Object.values(score));
    const leaders = players.filter((p) => score[p.id] === max);
    const winners = new Set(leaders.map((p) => p.team)).size === 1 ? leaders.map((p) => p.id) : [];
    series.push({ savedAt: games.map((g) => g.summary.savedAt).sort().at(-1)!, summary: {
      id, title: titles[id] ?? `${players.map((p) => p.name).join(" vs. ")}: three-game series`,
      createdAt: games[0].replay.createdAt, totalGames: 3, currentGame: 3, status: "finished", players, score, losses, winners,
      ...(!winners.length && games[0].replay.ruleset.drawsAreLosses ? { allDefeated: true as const } : {}),
      games: games.map(({ replay }, i) => ({ number: i + 1, roomId: replay.id, status: "finished", outcome: replay.outcome })),
    } });
  }
  return series;
}

export async function collectPublication(root: string): Promise<Publication> {
  let titles: { replays: Record<string, string>; series: Record<string, string> } = { replays: {}, series: {} };
  try { titles = JSON.parse(await readFile(join(root, "cloudflare/titles.json"), "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  const featured = join(root, replayArchive.featured);
  const local = join(root, replayArchive.local);
  const previous = new Map((await optionalIndex(join(featured, replayArchive.index))).map((e) => [e.id, e]));
  const localIndex = new Map((await optionalIndex(join(local, replayArchive.index))).map((e) => [e.id, e]));
  const files = new Map<string, { path: string; compressed: boolean }>();
  for (const id of previous.keys()) files.set(id, { path: join(featured, `${id}.json`), compressed: false });
  let localFiles: string[] = [];
  try { localFiles = await readdir(local); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  for (const file of localFiles.filter((file) => file.endsWith(".json.gz"))) files.set(file.slice(0, -8), { path: join(local, file), compressed: true });
  const replays: Publication["replays"] = [];
  let excluded = 0;
  for (const [id, { path, compressed }] of files) {
    const bytes = await readFile(path);
    const raw: ReplayFile = JSON.parse((compressed ? gunzipSync(bytes) : bytes).toString("utf8"));
    if (raw.id !== id) throw new Error(`Replay ID does not match filename: ${path}`);
    if (hasScriptedBot(raw.players) || hasScriptedBot(localIndex.get(id)?.players ?? []) || raw.players.some((p) => /^demo:/i.test(p.name))) { excluded++; continue; }
    const replay = publicReplay(raw);
    const old = previous.get(id);
    // When the match ended: file times move when recordings are copied or rewritten.
    const savedAt = old?.savedAt ?? new Date(Date.parse(replay.createdAt) + replay.finalTick * 1000 / replay.tickRate).toISOString();
    replays.push({ replay, summary: {
      id, title: titles.replays[id] ?? old?.title ?? `${replay.players.map((p) => p.name).join(" vs. ")} — ${replay.ruleset.map.name ?? "Open field"}`,
      createdAt: replay.createdAt, savedAt, players: replayPlayerSummaries(raw), outcome: replay.outcome,
      finalTick: replay.finalTick, tickRate: replay.tickRate, rulesVersion: replay.ruleset.version, map: replay.ruleset.map.name ?? old?.map,
    } });
  }
  replays.sort((a, b) => b.summary.savedAt.localeCompare(a.summary.savedAt) || a.replay.id.localeCompare(b.replay.id));
  return { replays, series: completeSeries(replays, titles.series), excluded };
}

const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
const STATEMENT_LIMIT = 100_000, CHUNK_BYTES = 80_000;

/** A payload in pieces whose quoted SQL literal stays well under D1's statement limit. */
export function chunks(payload: string): string[] {
  const out: string[] = [];
  let piece = "", bytes = 0;
  for (const char of payload) {
    const size = Buffer.byteLength(char) * (char === "'" ? 2 : 1);
    if (bytes + size > CHUNK_BYTES) { out.push(piece); piece = ""; bytes = 0; }
    piece += char; bytes += size;
  }
  return [...out, piece];
}

/** What D1 already holds for a replay, to skip unchanged rows. */
export type Published = Map<string, { contentHash: string; summaryJson: string }>;

export const contentHash = (payload: string) => createHash("sha256").update(payload).digest("hex");

export function publicationSQL(publication: Publication, published: Published = new Map()): string {
  const statements: string[] = [];
  for (const { replay, summary } of publication.replays) {
    const payload = JSON.stringify(replay), hash = contentHash(payload), summaryJson = JSON.stringify(summary);
    const before = published.get(replay.id);
    if (before?.contentHash === hash && before.summaryJson === summaryJson) continue;
    if (before?.contentHash !== hash) {
      statements.push(`DELETE FROM replay_chunks WHERE id=${quote(replay.id)};`);
      chunks(payload).forEach((chunk, n) => statements.push(`INSERT INTO replay_chunks(id,n,chunk) VALUES(${quote(replay.id)},${n},${quote(chunk)});`));
    }
    statements.push(`INSERT INTO replays(id,saved_at,summary_json,content_hash) VALUES(${[replay.id, summary.savedAt, summaryJson, hash].map(quote).join(",")}) ON CONFLICT(id) DO UPDATE SET saved_at=excluded.saved_at,summary_json=excluded.summary_json,content_hash=excluded.content_hash;`);
  }
  for (const { summary, savedAt } of publication.series) statements.push(`INSERT INTO series(id,saved_at,summary_json) VALUES(${[summary.id, savedAt, JSON.stringify(summary)].map(quote).join(",")}) ON CONFLICT(id) DO UPDATE SET saved_at=excluded.saved_at,summary_json=excluded.summary_json WHERE series.summary_json != excluded.summary_json OR series.saved_at != excluded.saved_at;`);
  for (const statement of statements) if (Buffer.byteLength(statement) >= STATEMENT_LIMIT) throw new Error("A catalogue statement exceeds D1's 100 KB SQL import limit. Nothing was uploaded.");
  return statements.length ? statements.join("\n") + "\n" : "";
}
