/** Legacy recordings only stored player names, not the built-in bot flag. */
export function hasScriptedBot(players: readonly { name: string; bot?: string }[]): boolean {
  return players.some((player) => !!player.bot || /^bot:/i.test(player.name)
    || /^(rush|eco|kite|turtle)(?:[-_][a-z0-9]+)?$/i.test(player.name));
}

interface Listed { id: string; players: readonly { name: string; bot?: string }[]; rulesVersion?: string; savedAt?: string; createdAt: string }

/** Recordings are listed by the date of their original file, not by when the match started. */
const listedAt = (replay: { savedAt?: string; createdAt: string }) => replay.savedAt ?? replay.createdAt;

/** 0.27.0 only renamed v26; keep its recordings visible without rewriting their rules. Unknown and experimental versions stay excluded. */
/** A release's mechanics: "0.27" for 0.27.0 and 0.27.1. Experimental variants ("0.27.0+…") have none. */
const release = (version: string | undefined) => /^\d+\.\d+\.\d+$/.test(version ?? "") ? version!.split(".").slice(0, 2).join(".") : null;
// Patch versions change wording, not mechanics, so their battles share a catalog; v26 coordinated movement is 0.27's mechanics.
const onRules = (recorded: string | undefined, version: string) =>
  recorded === version || (release(recorded) !== null && release(recorded) === release(version))
  || (release(version) === "0.27" && recorded === "v26-coordinated-movement");

/** The battles a catalog lists: agents only, on `version`'s rules, the newest recording first. */
export function catalogBattles<T extends Listed>(entries: readonly T[], version: string): T[] {
  return entries.filter((entry) => !hasScriptedBot(entry.players) && onRules(entry.rulesVersion, version))
    .sort((a, b) => listedAt(b).localeCompare(listedAt(a)) || a.id.localeCompare(b.id));
}

/**
 * Listed replays and every agent series whose three games are all listed, newest first.
 * A series is dated by its newest game.
 */
export function battleList<R extends Listed, S extends { players: Listed["players"]; games: readonly { roomId: string }[] }>(replays: readonly R[], series: readonly S[]) {
  const dates = new Map(replays.map((replay) => [replay.id, listedAt(replay)]));
  return [
    ...replays.map((replay) => ({ kind: "replay" as const, replay, date: listedAt(replay) })),
    ...series.filter((s) => !hasScriptedBot(s.players) && s.games.length === 3 && s.games.every((game) => dates.has(game.roomId)))
      .map((s) => ({ kind: "series" as const, series: s, date: s.games.map((game) => dates.get(game.roomId)!).sort().at(-1)! })),
  ].sort((a, b) => b.date.localeCompare(a.date));
}
