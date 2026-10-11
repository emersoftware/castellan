import type { PlayerStats } from "./protocol";
import type { Ruleset } from "./ruleset";

/** Read old recordings without rewriting their orders, scripts or unit kinds. */
export function withMineralNames(ruleset: Ruleset): Ruleset {
  if (ruleset.startMineral !== undefined && ruleset.score.mineral !== undefined) return ruleset;
  const { startCapital, ...rest } = ruleset as Ruleset & { startCapital?: number };
  const { capital, ...score } = ruleset.score as Ruleset["score"] & { capital?: number };
  const startMineral = ruleset.startMineral ?? startCapital;
  const mineral = ruleset.score.mineral ?? capital;
  if (startMineral === undefined || mineral === undefined) throw new Error("Ruleset is missing mineral values");
  return { ...rest, startMineral, score: { ...score, mineral } };
}

/** Static showcase frames published before the resource rename. */
export function mineralBalance(player: PlayerStats): number | undefined {
  return player.mineral ?? (player as PlayerStats & { capital?: number }).capital;
}
