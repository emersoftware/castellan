import type { ReplayFile } from "./protocol";

export type ReplayPlayerSummary = ReplayFile["players"][number] & {
  /** Last declared reasoning effort; null means it was not recorded. */
  effort?: string | null;
};

const EFFORTS = new Set(["none", "off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);

/** Public catalogue metadata, without copying the manifest or guessing from names. */
export function replayPlayerSummaries(replay: Pick<ReplayFile, "players" | "experiment">): ReplayPlayerSummary[] {
  return replay.players.map(({ id, name, side, team }) => {
    const declared = replay.experiment?.players?.[id]?.configuration?.effort;
    const effort = typeof declared === "string" ? declared.trim().toLowerCase() : "";
    return { id, name, side, team, effort: EFFORTS.has(effort) ? effort : null };
  });
}
