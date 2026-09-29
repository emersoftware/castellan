/** Legacy recordings only stored player names, not the built-in bot flag. */
export function hasScriptedBot(players: readonly { name: string; bot?: string }[]): boolean {
  return players.some((player) => !!player.bot || /^bot:/i.test(player.name)
    || /^(rush|eco|kite|turtle)(?:[-_][a-z0-9]+)?$/i.test(player.name));
}

export const replayFileDate = (replay: { savedAt?: string; createdAt: string }) => replay.savedAt ?? replay.createdAt;
