import type { ReplayFile } from "./protocol.ts";

/** Reasoning efforts a harness may declare, from none to the most; "none" and "off" turn reasoning off. */
export const EFFORTS = ["none", "off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type Effort = (typeof EFFORTS)[number];
const OFF: Effort[] = ["none", "off"];
/** Longest model ID kept in the public catalogue; provider IDs are far shorter. */
const MODEL_ID_MAX = 100;

export type ReplayPlayerSummary = ReplayFile["players"][number] & {
  /** Last declared reasoning effort, or one a replay migration read from the name; null means unknown. */
  effort?: Effort | null;
  /** Model ID the harness declared in the experiment metadata (never read from the display name); null means unknown. */
  model?: string | null;
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
 * Public catalogue metadata, without copying the manifest: each player's declared model and effort, or the effort
 * the replay migration read from its display name and recorded in `migrated`. Nothing is guessed from names here.
 */
export function replayPlayerSummaries(replay: Pick<ReplayFile, "players" | "experiment" | "migrated">): ReplayPlayerSummary[] {
  return replay.players.map(({ id, name, side, team }) => {
    const configuration = replay.experiment?.players?.[id]?.configuration;
    const declared = configuration?.effort ?? replay.migrated?.effortFromNames?.[id];
    const effort = typeof declared === "string" ? declared.trim().toLowerCase() : "";
    const model = typeof configuration?.model === "string" ? configuration.model.trim().slice(0, MODEL_ID_MAX) : "";
    return { id, name, side, team, effort: EFFORTS.find((known) => known === effort) ?? null, model: model || null };
  });
}
