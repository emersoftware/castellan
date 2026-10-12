import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { ReplayFile, SeriesSummary } from "../packages/shared/src/protocol";
import { playerResult } from "../packages/shared/src/outcome";
import { hasScriptedBot } from "../packages/web/src/replayCatalog";

interface Entry {
  id: string;
  title?: string;
  createdAt: string;
  savedAt: string;
  players: ReplayFile["players"];
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
  const featured = join(root, "packages/web/public/featured");
  const previous = new Map((await optionalIndex(join(featured, "index.json"))).map((e) => [e.id, e]));
  const localIndex = new Map((await optionalIndex(join(root, "replays/index.json"))).map((e) => [e.id, e]));
  const files = new Map<string, { path: string; compressed: boolean }>();
  for (const id of previous.keys()) files.set(id, { path: join(featured, `${id}.json`), compressed: false });
  let localFiles: string[] = [];
  try { localFiles = await readdir(join(root, "replays")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  for (const file of localFiles.filter((file) => file.endsWith(".json.gz"))) files.set(file.slice(0, -8), { path: join(root, "replays", file), compressed: true });
  const replays: Publication["replays"] = [];
  let excluded = 0;
  for (const [id, { path, compressed }] of files) {
    const bytes = await readFile(path);
    const raw: ReplayFile = JSON.parse((compressed ? gunzipSync(bytes) : bytes).toString("utf8"));
    if (raw.id !== id) throw new Error(`Replay ID does not match filename: ${path}`);
    if (hasScriptedBot(raw.players) || hasScriptedBot(localIndex.get(id)?.players ?? []) || raw.players.some((p) => /^demo:/i.test(p.name))) { excluded++; continue; }
    const replay = publicReplay(raw);
    const old = previous.get(id);
    const savedAt = old?.savedAt ?? (await stat(path)).mtime.toISOString();
    replays.push({ replay, summary: {
      id, title: titles.replays[id] ?? old?.title ?? `${replay.players.map((p) => p.name).join(" vs. ")} — ${replay.ruleset.map.name ?? "Open field"}`,
      createdAt: replay.createdAt, savedAt, players: replay.players, outcome: replay.outcome,
      finalTick: replay.finalTick, tickRate: replay.tickRate, rulesVersion: replay.ruleset.version, map: replay.ruleset.map.name ?? old?.map,
    } });
  }
  replays.sort((a, b) => b.summary.savedAt.localeCompare(a.summary.savedAt) || a.replay.id.localeCompare(b.replay.id));
  return { replays, series: completeSeries(replays, titles.series), excluded };
}

const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
export function publicationSQL(publication: Publication): string {
  const statements = publication.replays.map(({ replay, summary }) => {
    const payload = JSON.stringify(replay);
    const hash = createHash("sha256").update(payload).digest("hex");
    return `INSERT INTO replays(id,saved_at,summary_json,replay_json,content_hash) VALUES(${[replay.id, summary.savedAt, JSON.stringify(summary), payload, hash].map(quote).join(",")}) ON CONFLICT(id) DO UPDATE SET saved_at=excluded.saved_at,summary_json=excluded.summary_json,replay_json=excluded.replay_json,content_hash=excluded.content_hash WHERE replays.content_hash != excluded.content_hash OR replays.summary_json != excluded.summary_json;`;
  });
  for (const { summary, savedAt } of publication.series) statements.push(`INSERT INTO series(id,saved_at,summary_json) VALUES(${[summary.id, savedAt, JSON.stringify(summary)].map(quote).join(",")}) ON CONFLICT(id) DO UPDATE SET saved_at=excluded.saved_at,summary_json=excluded.summary_json WHERE series.summary_json != excluded.summary_json OR series.saved_at != excluded.saved_at;`);
  for (const statement of statements) if (Buffer.byteLength(statement) >= 100_000) throw new Error("Replay exceeds D1's 100 KB SQL import statement limit. Nothing was uploaded; use a parameterized importer for this replay.");
  return statements.join("\n") + "\n";
}
