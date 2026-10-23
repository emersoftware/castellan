import { BOT_NAMES } from "@castellan/shared";

/** A player named after a reference bot, alone or with a suffix such as `eco-2`. */
const BOT_PLAYER = new RegExp(`^(${BOT_NAMES.join("|")})(?:[-_][a-z0-9]+)?$`, "i");

/** Legacy recordings only stored player names, not the built-in bot flag. */
export function hasScriptedBot(players: readonly { name: string; bot?: string }[]): boolean {
  return players.some((player) => !!player.bot || /^bot:/i.test(player.name) || BOT_PLAYER.test(player.name));
}

interface Listed { id: string; players: readonly { name: string; bot?: string }[]; rulesVersion?: string; savedAt?: string; createdAt: string }

/** Recordings are listed by the date of their original file, not by when the match started. */
const listedAt = (replay: { savedAt?: string; createdAt: string }) => replay.savedAt ?? replay.createdAt;

/**
 * The rules family a recording belongs to: "0.29" for 0.29.0, its patches and its variants
 * ("0.29.0+stats:…"); "v26" for "v26-coordinated-movement". Unknown versions have none.
 */
export function rulesFamily(version: string | undefined): string | null {
  const release = /^(\d+\.\d+)\.\d+(?:\+|$)/.exec(version ?? "");
  if (release) return release[1];
  return /^(v\d+[a-z]?)(?:[-+]|$)/.exec(version ?? "")?.[1] ?? null;
}

/** Sort order for rules families, newest first: releases (0.29, 0.27) before the numbered prototypes (v26 … v16). */
export function newerFamily(a: string, b: string): number {
  const rank = (family: string): [release: number, order: number, letter: string] => {
    const release = /^(\d+)\.(\d+)$/.exec(family);
    if (release) return [1, Number(release[1]) * 1000 + Number(release[2]), ""];
    const prototype = /^v(\d+)([a-z]?)$/.exec(family)!;
    return [0, Number(prototype[1]), prototype[2]];
  };
  const [x, y] = [rank(a), rank(b)];
  return y[0] - x[0] || y[1] - x[1] || y[2].localeCompare(x[2]);
}

/** A rules family as a reader sees it: "v0.29", "v26". */
export const familyLabel = (family: string) => /^\d/.test(family) ? `v${family}` : family;

/** The battles a catalog lists: agents only, on known rules, the newest recording first. */
export function catalogBattles<T extends Listed>(entries: readonly T[]): T[] {
  return entries.filter((entry) => !hasScriptedBot(entry.players) && rulesFamily(entry.rulesVersion) !== null)
    .sort((a, b) => listedAt(b).localeCompare(listedAt(a)) || a.id.localeCompare(b.id));
}

/**
 * Listed replays and every agent series whose three games are all listed, newest first.
 * A series is dated by its newest game.
 */
export function battleList<R extends Listed, S extends { players: Listed["players"]; games: readonly { roomId: string }[] }>(replays: readonly R[], series: readonly S[]) {
  const listed = new Map(replays.map((replay) => [replay.id, replay]));
  return [
    ...replays.map((replay) => ({ kind: "replay" as const, replay, date: listedAt(replay), family: rulesFamily(replay.rulesVersion) })),
    ...series.filter((s) => !hasScriptedBot(s.players) && s.games.length === 3 && s.games.every((game) => listed.has(game.roomId)))
      .map((s) => ({ kind: "series" as const, series: s, date: s.games.map((game) => listedAt(listed.get(game.roomId)!)).sort().at(-1)!,
        family: rulesFamily(listed.get(s.games[0].roomId)!.rulesVersion) })),
  ].sort((a, b) => b.date.localeCompare(a.date));
}
