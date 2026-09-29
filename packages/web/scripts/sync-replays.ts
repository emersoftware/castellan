/** Bundle every saved match so the battle list also works without a local API.
 * Run from the repo: pnpm exec tsx packages/web/scripts/sync-replays.ts
 */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import type { ReplayFile } from "@aoa/shared";
import type { ReplaySummary } from "../src/api";
import { hasScriptedBot, replayFileDate } from "../src/replayCatalog";

const root = resolve(import.meta.dirname, "../../..");
const destination = resolve(root, "packages/web/public/featured");
await mkdir(destination, { recursive: true });
const existing = JSON.parse(await readFile(resolve(destination, "index.json"), "utf8")) as ReplaySummary[];
const titles = new Map(existing.map((entry) => [entry.id, entry.title]));
const maps = new Map(existing.map((entry) => [entry.id, entry.map]));
const bundled = new Set(existing.map((entry) => entry.id));
const games = new Map<string, ReplayFile>();
const savedDates = new Map(existing.map((entry) => [entry.id, replayFileDate(entry)]));
for (const file of (await readdir(resolve(root, "replays"))).filter((file) => file.endsWith(".json.gz"))) {
  const replay = JSON.parse(gunzipSync(await readFile(resolve(root, "replays", file))).toString()) as ReplayFile;
  if (replay.format !== 1 || !replay.id || !Array.isArray(replay.orders) || !replay.outcome) throw new Error(`Invalid replay: ${file}`);
  games.set(replay.id, replay);
  savedDates.set(replay.id, (await stat(resolve(root, "replays", file))).mtime.toISOString());
}
// Preserve previously bundled recordings and their editorial titles.
for (const entry of existing) {
  games.set(entry.id, JSON.parse(await readFile(resolve(destination, `${entry.id}.json`), "utf8")) as ReplayFile);
}
const index: Omit<ReplaySummary, "source">[] = [];
for (const replay of games.values()) {
  if (hasScriptedBot(replay.players)) continue;
  if (!bundled.has(replay.id)) await writeFile(resolve(destination, `${replay.id}.json`), JSON.stringify(replay) + "\n");
  index.push({ id: replay.id, title: titles.get(replay.id), createdAt: replay.createdAt, savedAt: savedDates.get(replay.id),
    players: replay.players, outcome: replay.outcome, finalTick: replay.finalTick,
    tickRate: replay.tickRate, map: replay.ruleset.map.name ?? maps.get(replay.id) });
}
index.sort((a, b) => replayFileDate(b).localeCompare(replayFileDate(a)) || a.id.localeCompare(b.id));
await writeFile(resolve(destination, "index.json"), JSON.stringify(index, null, 1) + "\n");
console.log(`Bundled ${index.length} agent battles by original replay file date; excluded ${games.size - index.length} bot matches.`);
