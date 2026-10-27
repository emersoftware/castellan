import type { ReplayFile } from "./protocol.ts";

/** Reasoning efforts a harness may declare, from none to the most; "none" and "off" turn reasoning off. */
export const EFFORTS = ["none", "off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type Effort = (typeof EFFORTS)[number];
const OFF: Effort[] = ["none", "off"];

export type ReplayPlayerSummary = ReplayFile["players"][number] & {
  /** Last declared reasoning effort, or one a replay migration read from the name; null means unknown. */
  effort?: Effort | null;
};

/** Players grouped by team, in seat order; a player without a team is alone. */
export function teamsOf<P extends { team?: number }>(players: readonly P[]): P[][] {
  const teams = new Map<number, P[]>();
  players.forEach((p, i) => teams.set(p.team ?? -1 - i, [...(teams.get(p.team ?? -1 - i) ?? []), p]));
  return [...teams.values()];
}

/** "a & b vs. c & d". */
export function matchupTitle(players: readonly { name: string; team?: number }[]): string {
  return teamsOf(players).map((team) => team.map((p) => p.name).join(" & ")).join(" vs. ");
}

/** How a declared effort reads in the catalogue. */
export function effortText(effort: string | null | undefined): string {
  return !effort ? "Effort not recorded" : OFF.some((off) => off === effort) ? "Reasoning off" : `${effort[0].toUpperCase()}${effort.slice(1)} effort`;
}

/**
 * Public catalogue metadata, without copying the manifest: each player's declared effort, or the one the replay
 * migration read from its display name and recorded in `migrated`. Nothing is guessed from names here.
 */
export function replayPlayerSummaries(replay: Pick<ReplayFile, "players" | "experiment" | "migrated">): ReplayPlayerSummary[] {
  return replay.players.map(({ id, name, side, team }) => {
    const declared = replay.experiment?.players?.[id]?.configuration?.effort ?? replay.migrated?.effortFromNames?.[id];
    const effort = typeof declared === "string" ? declared.trim().toLowerCase() : "";
    return { id, name, side, team, effort: EFFORTS.find((known) => known === effort) ?? null };
  });
}
