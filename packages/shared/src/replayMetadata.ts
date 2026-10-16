import type { ReplayFile } from "./protocol";

export type ReplayPlayerSummary = ReplayFile["players"][number] & {
  /** Last declared reasoning effort; null means it was not recorded. */
  effort?: string | null;
};

const OFF = ["none", "off"];
const EFFORTS = new Set([...OFF, "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);

/** Whether a declared effort turns reasoning off. */
export const reasoningOff = (effort: string) => OFF.includes(effort);

/** Public catalogue metadata, without copying the manifest or guessing from names. */
export function replayPlayerSummaries(replay: Pick<ReplayFile, "players" | "experiment">): ReplayPlayerSummary[] {
  return replay.players.map(({ id, name, side, team }) => {
    const declared = replay.experiment?.players?.[id]?.configuration?.effort;
    const effort = typeof declared === "string" ? declared.trim().toLowerCase() : "";
    return { id, name, side, team, effort: EFFORTS.has(effort) ? effort : null };
  });
}
