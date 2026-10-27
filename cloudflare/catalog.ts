import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { ReplayFile, SeriesSummary } from "../packages/shared/src/protocol";
import { seriesStandings } from "../packages/shared/src/outcome";
import { replayPlayerSummaries, type ReplayPlayerSummary } from "../packages/shared/src/replayMetadata";
import { REPLAY_INDEX } from "../packages/shared/src/localData";
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
  /** `image`: the replay's link preview (PNG), when one was drawn locally. */
  replays: { replay: ReplayFile; summary: Entry; image?: Buffer }[];
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
    // A rewritten recording names the original it came from and which efforts were read from player names.
    ...(value.migrated ? { migrated: value.migrated } : {}),
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
    const { score, losses, leaders: winners } = seriesStandings(players, games.map(({ replay }) => replay.outcome));
    series.push({ savedAt: games.map((g) => g.summary.savedAt).sort().at(-1)!, summary: {
      id, title: titles[id] ?? `${players.map((p) => p.name).join(" vs. ")}: three-game series`,
      createdAt: games[0].replay.createdAt, totalGames: 3, currentGame: 3, status: "finished", players, score, losses, winners,
      ...(!winners.length && games[0].replay.ruleset.drawsAreLosses ? { allDefeated: true as const } : {}),
      games: games.map(({ replay }, i) => ({ number: i + 1, roomId: replay.id, status: "finished", outcome: replay.outcome })),
    } });
  }
  return series;
}

/**
 * The `local` archive's agent matches, titled from the repository's `cloudflare/titles.json` under `root`,
 * with the link previews found in `images` as `<id>.png`.
 */
export async function collectPublication(root: string, local: string, only?: ReadonlySet<string>, images?: string): Promise<Publication> {
  let titles: { replays: Record<string, string>; series: Record<string, string> } = { replays: {}, series: {} };
  try { titles = JSON.parse(await readFile(join(root, "cloudflare/titles.json"), "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  const localIndex = new Map((await optionalIndex(join(local, REPLAY_INDEX))).map((e) => [e.id, e]));
  const files = new Map<string, string>();
  let localFiles: string[] = [];
  try { localFiles = await readdir(local); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  for (const file of localFiles.filter((file) => file.endsWith(".json.gz"))) files.set(file.slice(0, -8), join(local, file));
  const replays: Publication["replays"] = [];
  let excluded = 0;
  for (const [id, path] of files) {
    if (only && !only.has(id)) continue;
    const raw: ReplayFile = JSON.parse(gunzipSync(await readFile(path)).toString("utf8"));
    if (raw.id !== id) throw new Error(`Replay ID does not match filename: ${path}`);
    if (hasScriptedBot(raw.players) || hasScriptedBot(localIndex.get(id)?.players ?? []) || raw.players.some((p) => /^demo:/i.test(p.name))) { excluded++; continue; }
    const replay = publicReplay(raw);
    // When the match ended: file times move when recordings are copied or rewritten.
    const savedAt = new Date(Date.parse(replay.createdAt) + replay.finalTick * 1000 / replay.tickRate).toISOString();
    let image: Buffer | undefined;
    if (images) {
      try { image = await readFile(join(images, `${id}.png`)); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    }
    replays.push({ replay, ...(image ? { image } : {}), summary: {
      id, title: titles.replays[id] ?? `${replay.players.map((p) => p.name).join(" vs. ")} — ${replay.ruleset.map.name ?? "Open field"}`,
      createdAt: replay.createdAt, savedAt, players: replayPlayerSummaries(raw), outcome: replay.outcome,
      finalTick: replay.finalTick, tickRate: replay.tickRate, rulesVersion: replay.ruleset.version, map: replay.ruleset.map.name,
    } });
  }
  replays.sort((a, b) => b.summary.savedAt.localeCompare(a.summary.savedAt) || a.replay.id.localeCompare(b.replay.id));
  const missing = [...only ?? []].filter(id => !replays.some(entry => entry.replay.id === id));
  if (missing.length) throw new Error(`Not publishable or not found: ${missing.join(", ")}`);
  return { replays, series: completeSeries(replays, titles.series), excluded };
}

const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
const STATEMENT_LIMIT = 100_000, CHUNK_BYTES = 80_000;

/** A payload in pieces whose quoted SQL literal stays well under D1's statement limit. */
function chunks(payload: string): string[] {
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
export type Published = Map<string, { contentHash: string; summaryJson: string; imageHash?: string | null }>;

const contentHash = (payload: string | Buffer) => createHash("sha256").update(payload).digest("hex");

export function publicationSQL(publication: Publication, published: Published = new Map()): string {
  const statements: string[] = [];
  for (const { replay, summary, image } of publication.replays) {
    const payload = JSON.stringify(replay), hash = contentHash(payload), summaryJson = JSON.stringify(summary);
    const before = published.get(replay.id), imageHash = image && contentHash(image);
    const newImage = !!imageHash && before?.imageHash !== imageHash;
    if (before?.contentHash === hash && before.summaryJson === summaryJson && !newImage) continue;
    if (before?.contentHash !== hash) {
      statements.push(`DELETE FROM replay_chunks WHERE id=${quote(replay.id)};`);
      chunks(payload).forEach((chunk, n) => statements.push(`INSERT INTO replay_chunks(id,n,chunk) VALUES(${quote(replay.id)},${n},${quote(chunk)});`));
    }
    if (newImage) {
      statements.push(`DELETE FROM replay_images WHERE id=${quote(replay.id)};`);
      chunks(image.toString("base64")).forEach((chunk, n) => statements.push(`INSERT INTO replay_images(id,n,chunk) VALUES(${quote(replay.id)},${n},${quote(chunk)});`));
    }
    // A publication without a local picture keeps the one already published.
    statements.push(`INSERT INTO replays(id,saved_at,summary_json,content_hash,image_hash) VALUES(${[replay.id, summary.savedAt, summaryJson, hash].map(quote).join(",")},${imageHash ? quote(imageHash) : "NULL"}) ON CONFLICT(id) DO UPDATE SET saved_at=excluded.saved_at,summary_json=excluded.summary_json,content_hash=excluded.content_hash,image_hash=COALESCE(excluded.image_hash,replays.image_hash);`);
  }
  for (const { summary, savedAt } of publication.series) statements.push(`INSERT INTO series(id,saved_at,summary_json) VALUES(${[summary.id, savedAt, JSON.stringify(summary)].map(quote).join(",")}) ON CONFLICT(id) DO UPDATE SET saved_at=excluded.saved_at,summary_json=excluded.summary_json WHERE series.summary_json != excluded.summary_json OR series.saved_at != excluded.saved_at;`);
  for (const statement of statements) if (Buffer.byteLength(statement) >= STATEMENT_LIMIT) throw new Error("A catalogue statement exceeds D1's 100 KB SQL import limit. Nothing was uploaded.");
  return statements.length ? statements.join("\n") + "\n" : "";
}
