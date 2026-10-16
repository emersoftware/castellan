import type { PlayerStats } from "./protocol";
import type { KindSpec, Ruleset } from "./ruleset";

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

const RENAMED = new Map([["agent", "king"], ["nexus", "castle"], ["ranger", "archer"], ["turret", "tower"]]);

/** A recorded kind under its current name. */
export const currentKind = (kind: string): string => RENAMED.get(kind) ?? kind;

/** A ruleset's spec for a current kind, also when the ruleset still uses an old name. */
export function kindSpec(ruleset: Ruleset, kind: string): KindSpec | undefined {
  return ruleset.kinds[kind] ?? Object.entries(ruleset.kinds).find(([id]) => currentKind(id) === kind)?.[1];
}

/** Labels from recorded orders/research; never rewrite a player's chat or code. */
export function displayGameText(text: string): string {
  return text.replace(/\b(ranger|turret|capital)(?=\b|_)/g, word => word === "capital" ? "mineral" : currentKind(word));
}
