import type { Outcome, PlayerId } from "./protocol.ts";

/** Every player on the winning side; recordings older than teams name only `winner`. */
export function winnersOf(outcome: Outcome): PlayerId[] {
  return outcome.winners ?? (outcome.winner ? [outcome.winner] : []);
}

/** Interpret recorded outcomes, including historical draws and team victories. */
export function playerResult(outcome: Outcome, player: PlayerId): "win" | "loss" | "draw" {
  const winners = winnersOf(outcome);
  if (winners.includes(player)) return "win";
  return winners.length || outcome.allDefeated ? "loss" : "draw";
}

export function outcomeText(outcome: Outcome): string {
  const winners = winnersOf(outcome);
  return winners.length ? `winner ${winners.join("+")}` : outcome.allDefeated ? "all defeated" : "draw";
}

/**
 * A series from the games played so far: wins and losses per player, and who leads it. Teammates lead
 * together; when opposing sides tie, nobody does. The leaders win once all three games are over.
 */
export function seriesStandings(players: readonly { id: PlayerId; team: number }[], outcomes: readonly (Outcome | undefined)[]) {
  const score: Record<PlayerId, number> = Object.fromEntries(players.map((p) => [p.id, 0]));
  const losses: Record<PlayerId, number> = Object.fromEntries(players.map((p) => [p.id, 0]));
  for (const outcome of outcomes) {
    if (!outcome) continue;
    for (const winner of winnersOf(outcome)) {
      if (!(winner in score)) throw new Error(`winner ${winner} is not in the series`);
      score[winner]++;
    }
    for (const p of players) if (playerResult(outcome, p.id) === "loss") losses[p.id]++;
  }
  const max = Math.max(0, ...Object.values(score));
  const top = players.filter((p) => score[p.id] === max);
  const leaders = new Set(top.map((p) => p.team)).size === 1 ? top.map((p) => p.id) : [];
  return { score, losses, leaders };
}
