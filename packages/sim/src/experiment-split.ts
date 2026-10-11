/** One replay and all its battles/variants always stay in one partition. */
export type Partition = "search" | "validation" | "test";

export function splitReplays(battleIds: string[]): Map<string, Partition> {
  const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };
  const games = [...new Set(battleIds.map((id) => id.split("#")[0]))].sort((a, b) => hash(a) - hash(b) || a.localeCompare(b));
  if (games.length < 3) throw new Error("Balance optimization requires at least 3 independent replays for search, validation and final test");
  const held = Math.max(1, Math.floor(games.length * 0.2));
  return new Map(games.map((game, i) => [game, i < held ? "test" : i < held * 2 ? "validation" : "search"]));
}
