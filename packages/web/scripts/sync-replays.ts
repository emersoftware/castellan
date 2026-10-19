/** Bundle every saved match so the battle list also works without a local API.
 * Run from the repo: pnpm exec tsx packages/web/scripts/sync-replays.ts
 */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { replayArchive, replayPlayerSummaries, rules, type ReplayFile } from "@castellan/shared";
import type { ReplaySummary } from "../src/api";
import { catalogBattles, hasScriptedBot } from "../src/replayCatalog";

const root = resolve(import.meta.dirname, "../../..");
const destination = resolve(root, replayArchive.featured);
const local = resolve(root, replayArchive.local);
await mkdir(destination, { recursive: true });
const existing = JSON.parse(await readFile(resolve(destination, replayArchive.index), "utf8")) as ReplaySummary[];
const titles = new Map(existing.map((entry) => [entry.id, entry.title]));
const maps = new Map(existing.map((entry) => [entry.id, entry.map]));
const bundled = new Set(existing.map((entry) => entry.id));
const games = new Map<string, ReplayFile>();
const savedDates = new Map(existing.map((entry) => [entry.id, entry.savedAt]));
for (const file of (await readdir(local)).filter((file) => file.endsWith(".json.gz"))) {
  const replay = JSON.parse(gunzipSync(await readFile(resolve(local, file))).toString()) as ReplayFile;
  if (replay.format !== 1 || !replay.id || !Array.isArray(replay.orders) || !replay.outcome) throw new Error(`Invalid replay: ${file}`);
  games.set(replay.id, replay);
  savedDates.set(replay.id, (await stat(resolve(local, file))).mtime.toISOString());
}
// Preserve previously bundled recordings and their editorial titles.
for (const entry of existing) {
  games.set(entry.id, JSON.parse(await readFile(resolve(destination, `${entry.id}.json`), "utf8")) as ReplayFile);
}
// Player summaries drop the bot flag: check it on the full recording first.
const index: Omit<ReplaySummary, "source">[] = catalogBattles([...games.values()].filter((replay) => !hasScriptedBot(replay.players)).map((replay) => ({
  id: replay.id, title: titles.get(replay.id), createdAt: replay.createdAt, savedAt: savedDates.get(replay.id),
  players: replayPlayerSummaries(replay), outcome: replay.outcome, finalTick: replay.finalTick,
  tickRate: replay.tickRate, rulesVersion: replay.ruleset.version, map: replay.ruleset.map.name ?? maps.get(replay.id) })), rules.version);
for (const { id } of index) if (!bundled.has(id)) await writeFile(resolve(destination, `${id}.json`), JSON.stringify(games.get(id)) + "\n");
await writeFile(resolve(destination, replayArchive.index), JSON.stringify(index, null, 1) + "\n");
console.log(`Bundled ${index.length} agent battles by original replay file date; excluded ${games.size - index.length} bot matches.`);
