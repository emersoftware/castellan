/** The server's replay archive: one gzipped file per finished match and an index that lists them, newest first. */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { replayArchive, replayPlayerSummaries, type ReplayFile, type ReplayPlayerSummary } from "@castellan/shared";

interface IndexEntry {
  id: string;
  createdAt: string;
  players: ReplayPlayerSummary[];
  outcome: ReplayFile["outcome"];
  finalTick: number;
  tickRate: number;
  rulesVersion?: string;
  map?: string;
}

/** Each directory's writes, one after another, so concurrent saves never lose an index entry. */
const writes = new Map<string, Promise<void>>();

export class ReplayArchive {
  /** What older index entries lack, read once per version of their file. */
  private completed = new Map<string, { rulesVersion?: string; map?: string; players: ReplayPlayerSummary[] }>();

  constructor(readonly dir: string) {}

  /** Stores a finished match and lists it first. */
  save(replay: ReplayFile): Promise<void> {
    const write = (writes.get(this.dir) ?? Promise.resolve()).catch(() => {}).then(async () => {
      await mkdir(this.dir, { recursive: true });
      const path = join(this.dir, `${replay.id}.json.gz`);
      await writeFile(`${path}.tmp`, gzipSync(JSON.stringify(replay)));
      await rename(`${path}.tmp`, path);
      const index = (await this.index()).filter((r) => r.id !== replay.id);
      index.unshift({ id: replay.id, createdAt: replay.createdAt, players: replayPlayerSummaries(replay), outcome: replay.outcome, finalTick: replay.finalTick, tickRate: replay.tickRate, rulesVersion: replay.ruleset.version, map: replay.ruleset.map.name });
      const indexPath = join(this.dir, replayArchive.index);
      await writeFile(`${indexPath}.tmp`, JSON.stringify(index, null, 1));
      await rename(`${indexPath}.tmp`, indexPath);
    });
    writes.set(this.dir, write);
    return write;
  }

  /** Every match in the index, with when its file was saved and the metadata older entries lack. */
  async list() {
    return Promise.all((await this.index()).map(async (entry) => {
      const path = join(this.dir, `${entry.id}.json.gz`);
      const savedAt = await stat(path).then((file) => file.mtime.toISOString()).catch(() => entry.createdAt);
      const key = `${entry.id}:${savedAt}`;
      let metadata = this.completed.get(key);
      if ((!entry.rulesVersion || entry.players.some((player) => player.effort === undefined)) && !metadata) {
        try {
          const replay: ReplayFile = JSON.parse(gunzipSync(await readFile(path)).toString("utf8"));
          metadata = { rulesVersion: replay.ruleset.version, map: replay.ruleset.map.name, players: replayPlayerSummaries(replay) };
          this.completed.set(key, metadata);
        } catch { /* An unavailable historical recording stays unknown, never current. */ }
      }
      return { ...entry, ...metadata, savedAt };
    }));
  }

  /** A match's replay as JSON text; undefined when the archive has none. */
  async read(id: string): Promise<string | undefined> {
    const file = join(this.dir, `${id}.json.gz`);
    if (!existsSync(file)) return undefined;
    return gunzipSync(await readFile(file)).toString("utf8");
  }

  /** The index; only a missing one is empty. An unreadable index is an error, never rewritten from scratch. */
  private async index(): Promise<IndexEntry[]> {
    try {
      return JSON.parse(await readFile(join(this.dir, replayArchive.index), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
