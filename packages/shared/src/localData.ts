import { homedir } from "node:os";
import { join } from "node:path";

/**
 * What matches on this machine leave behind (replays, run logs, reports, videos). It stays outside the
 * repository, so every checkout and worktree shares one archive: CASTELLAN_DATA, or ~/.local/share/castellan.
 */
export function localData(...parts: string[]): string {
  return join(process.env.CASTELLAN_DATA || join(homedir(), ".local", "share", "castellan"), ...parts);
}

/** The server's replay archive, one file per replay id: REPLAY_DIR, or `replays` in the local data. */
export const localReplays = (): string => process.env.REPLAY_DIR || localData("replays");

/** The file in a replay archive that lists its matches, newest first. */
export const REPLAY_INDEX = "index.json";
