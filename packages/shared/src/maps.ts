/**
 * Maps are data: layout only, no rules. Each is symmetric under its seats'
 * rotations (180° for 2 seats, every 90° for 4) so no corner has an advantage;
 * `symmetric` adds the mirror of every wall tile so a map only lists one half.
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
    { kind: "castle", x: 4, y: 4 },
    { kind: "king", x: 2, y: 2 },
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

/** 4-seat maps: twice the side of the 1v1 maps, one base per corner. */
const W4 = 64;
/** A tile and its 90°, 180° and 270° rotations on the W4 map. */
const quarters = (t: { x: number; y: number; amount: number }) => [
  t,
  { ...t, x: W4 - 1 - t.y, y: t.x },
  { ...t, x: W4 - 1 - t.x, y: W4 - 1 - t.y },
  { ...t, x: t.y, y: W4 - 1 - t.x },
];

const fortressStart = [
  ...base.start,
  ...line(0, 13, y => ({ x: 13, y })).map(p => ({ ...p, kind: p.y === 7 ? "door" : "wall" })),
  ...line(0, 12, x => ({ x, y: 13 })).map(p => ({ ...p, kind: p.x === 7 ? "door" : "wall" })),
];

export const MAPS: Record<string, MapSpec> = {
  open: {
    ...base,
    name: "open",
    description: "Flat island, nothing in the way. Two rich deposits in the center.",
    walls: [],
    sharedDeposits: [{ x: 15, y: 16, amount: 800 }, { x: 16, y: 15, amount: 800 }],
  },
  fortress: {
    ...base,
    name: "fortress",
    description: "Each player starts inside a corner fortress: the map edges close two sides; two owned, destructible wall lines close the others, each with one allied-only door. All starting mines are inside. Leave through either door; breach an enemy wall or door to enter their base. Two rich deposits lie outside in the center.",
    walls: [],
    start: fortressStart,
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
  "fortress-quad": {
    ...base,
    name: "fortress-quad",
    description: "Four identical corner fortresses, rotated 90 degrees: the map edges close two sides of each base; two owned, destructible wall lines close the others, each with one allied-only door. All starting mines are inside. Leave through either door; breach enemy walls or doors to enter. Shared deposits lie between corners and in the center.",
    width: W4,
    height: W4,
    seats: 4,
    walls: [],
    start: fortressStart,
    sharedDeposits: [
      ...quarters({ x: 31, y: 31, amount: 800 }),
      ...quarters({ x: 31, y: 5, amount: 600 }),
    ],
  },
  quad: {
    ...base,
    name: "quad",
    description: "Four corners on open ground, twice the size of the 1v1 maps. A deposit between each pair of neighbouring corners and four rich ones in the center.",
    width: W4,
    height: W4,
    seats: 4,
    walls: [],
    deposits: [...base.deposits, { x: 18, y: 17, amount: 600 }, { x: 17, y: 18, amount: 600 }],
    sharedDeposits: [
      ...quarters({ x: 31, y: 31, amount: 800 }),
      ...quarters({ x: 31, y: 5, amount: 600 }),
    ],
  },
};

/** v7 keeps the original unit identifier for deterministic historical games. */
export const CASTLE_MAPS: Record<string, MapSpec> = Object.fromEntries(Object.entries(MAPS).map(([id, map]) =>
  [id, { ...map, start: map.start.map(s => ({ ...s, kind: s.kind === "king" ? "agent" : s.kind })) }]));

/** Select map content using the requested rules, including older custom rooms. */
export function mapsForRuleset(ruleset: { kinds: Record<string, unknown> }): Record<string, MapSpec> {
  return ruleset.kinds.king ? MAPS : ruleset.kinds.castle ? CASTLE_MAPS : LEGACY_MAPS;
}

/** Layouts for v0-v6 and embedded legacy game content. Never rename replay orders. */
export const LEGACY_MAPS: Record<string, MapSpec> = Object.fromEntries(Object.entries(CASTLE_MAPS).filter(([, map]) => !map.start.some(s => s.kind === "door")).map(([id, map]) =>
  [id, { ...map, start: map.start.map(s => ({ ...s, kind: s.kind === "castle" ? "nexus" : s.kind })) }]));
