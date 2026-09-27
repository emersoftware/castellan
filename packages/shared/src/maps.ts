/**
 * Maps are data: layout only, no rules. Each is symmetric under a 180°
 * rotation so neither side has an advantage; `symmetric` adds the mirror of
 * every wall tile so a map only lists one half.
 */
import type { MapSpec } from "./ruleset";

const W = 32;
const H = 32;

type Tile = { x: number; y: number };
const symmetric = (tiles: Tile[]): Tile[] => {
  const seen = new Set<string>();
  const out: Tile[] = [];
  for (const t of tiles.flatMap((t) => [t, { x: W - 1 - t.x, y: H - 1 - t.y }])) {
    const k = `${t.x},${t.y}`;
    if (!seen.has(k)) (seen.add(k), out.push(t));
  }
  return out;
};
const line = (from: number, to: number, at: (i: number) => Tile, gaps: number[] = []): Tile[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i).filter((i) => !gaps.includes(i)).map(at);

const base = {
  width: W,
  height: H,
  start: [
    { kind: "nexus", x: 4, y: 4 },
    { kind: "agent", x: 2, y: 2 },
    { kind: "worker", x: 6, y: 5 },
    { kind: "worker", x: 5, y: 6 },
    { kind: "worker", x: 6, y: 6 },
  ],
  deposits: [
    { x: 10, y: 2, amount: 500 }, { x: 11, y: 3, amount: 500 }, { x: 11, y: 4, amount: 500 },
    { x: 2, y: 10, amount: 500 }, { x: 3, y: 11, amount: 500 }, { x: 4, y: 11, amount: 500 },
    { x: 9, y: 9, amount: 500 }, { x: 10, y: 8, amount: 500 },
  ],
};

export const MAPS: Record<string, MapSpec> = {
  open: {
    ...base,
    name: "open",
    description: "Flat island, nothing in the way. Two rich deposits in the center.",
    walls: [],
    sharedDeposits: [{ x: 15, y: 16, amount: 800 }, { x: 16, y: 15, amount: 800 }],
  },
  ridge: {
    ...base,
    name: "ridge",
    description: "A rock ridge splits the island; three narrow passes. Rich deposits just behind it.",
    walls: symmetric(line(6, 15, (x) => ({ x, y: 31 - x }), [10, 11, 15])),
    sharedDeposits: [{ x: 13, y: 14, amount: 800 }, { x: 18, y: 17, amount: 800 }],
  },
  canyons: {
    ...base,
    name: "canyons",
    description: "Two long walls make three lanes: a central highway between the bases and two flanks.",
    walls: symmetric(line(4, 18, (x) => ({ x, y: x + 9 }), [11, 12])),
    sharedDeposits: [{ x: 15, y: 16, amount: 800 }, { x: 16, y: 15, amount: 800 }],
  },
};
