import type { ReplayFile } from "./protocol.ts";

/** Reasoning efforts a harness may declare, from none to the most; "none" and "off" turn reasoning off. */
export const EFFORTS = ["none", "off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type Effort = (typeof EFFORTS)[number];
const OFF: Effort[] = ["none", "off"];

export type ReplayPlayerSummary = ReplayFile["players"][number] & {
  /** Last declared reasoning effort; null means it was not recorded. */
  effort?: Effort | null;
};

/** How a declared effort reads in the catalogue. */
export function effortText(effort: string | null | undefined): string {
  return !effort ? "Effort not recorded" : OFF.some((off) => off === effort) ? "Reasoning off" : `${effort[0].toUpperCase()}${effort.slice(1)} effort`;
}

/** Public catalogue metadata, without copying the manifest or guessing from names. */
export function replayPlayerSummaries(replay: Pick<ReplayFile, "players" | "experiment">): ReplayPlayerSummary[] {
  return replay.players.map(({ id, name, side, team }) => {
    const declared = replay.experiment?.players?.[id]?.configuration?.effort;
    const effort = typeof declared === "string" ? declared.trim().toLowerCase() : "";
    return { id, name, side, team, effort: EFFORTS.find((known) => known === effort) ?? null };
  });
}
