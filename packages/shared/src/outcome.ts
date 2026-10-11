import type { Outcome, PlayerId } from "./protocol";

/** Interpret recorded outcomes, including historical draws and team victories. */
export function playerResult(outcome: Outcome, player: PlayerId): "win" | "loss" | "draw" {
  const winners = outcome.winners ?? (outcome.winner ? [outcome.winner] : []);
  if (winners.includes(player)) return "win";
  return winners.length || outcome.allDefeated ? "loss" : "draw";
}

export function outcomeText(outcome: Outcome): string {
  const winners = outcome.winners ?? (outcome.winner ? [outcome.winner] : []);
  return winners.length ? `winner ${winners.join("+")}` : outcome.allDefeated ? "all defeated" : "draw";
}
