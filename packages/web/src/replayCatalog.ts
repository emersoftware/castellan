/** Legacy recordings only stored player names, not the built-in bot flag. */
export function hasScriptedBot(players: readonly { name: string; bot?: string }[]): boolean {
  return players.some((player) => !!player.bot || /^bot:/i.test(player.name)
    || /^(rush|eco|kite|turtle)(?:[-_][a-z0-9]+)?$/i.test(player.name));
}

export const replayFileDate = (replay: { savedAt?: string; createdAt: string }) => replay.savedAt ?? replay.createdAt;

/** 0.27.0 only renamed v26; keep its recordings visible without rewriting their rules. */
export function matchesCatalogVersion(recorded: string | undefined, version: string): boolean {
  return recorded === version || (version === "0.27.0" && recorded === "v26-coordinated-movement");
}

/** Unknown and experimental versions stay excluded; only the explicit rename is accepted. */
export function currentBattles<T extends { rulesVersion?: string }>(entries: readonly T[], version: string): T[] {
  return entries.filter(entry => matchesCatalogVersion(entry.rulesVersion, version));
}

export type BattleMode = "ffa" | "duel" | "teams";

/** Two players are a duel; four in two teams of two are a 2v2; any other game of three or more is a free-for-all. */
export function battleMode(replay: { players: readonly { team?: number }[] }): BattleMode {
  const { players } = replay;
  if (players.length === 2) return "duel";
  const teams = new Map<number | undefined, number>();
  for (const p of players) teams.set(p.team, (teams.get(p.team) ?? 0) + 1);
  return players.length === 4 && teams.size === 2 && !teams.has(undefined) && [...teams.values()].every(n => n === 2) ? "teams" : "ffa";
}

/** Selected launch recordings: hero FFA, Opus/Sol duel, Claude/Codex 2v2. */
const FEATURED_BATTLE_IDS = ["02eb6795", "1b4b65c9", "2346f20b"] as const;

/** Missing selections stay absent instead of being replaced by unrelated matches. */
export function featuredBattles<T extends { id: string }>(entries: readonly T[]): T[] {
  return FEATURED_BATTLE_IDS.flatMap(id => entries.find(entry => entry.id === id) ?? []);
}
