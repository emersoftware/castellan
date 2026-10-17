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

const base: Pick<MapSpec, "width" | "height" | "start" | "deposits"> = {
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
    // 1,200 home mineral: enough to open, with the same initial mining approaches.
    { x: 10, y: 2, amount: 150 }, { x: 11, y: 3, amount: 150 }, { x: 11, y: 4, amount: 150 },
    { x: 2, y: 10, amount: 150 }, { x: 3, y: 11, amount: 150 }, { x: 4, y: 11, amount: 150 },
    { x: 9, y: 9, amount: 150 }, { x: 10, y: 8, amount: 150 },
    // The other 2,800 require leaving the corner. Two flanks let an army
    // contest income without controlling the single central cluster. These are
    // outside fortress walls and clear of ridge/canyon rocks on every rotation.
    { x: 15, y: 5, amount: 700 }, { x: 16, y: 6, amount: 700 },
    { x: 5, y: 15, amount: 700 }, { x: 6, y: 16, amount: 700 },
  ],
};

/** 4-seat maps: one base per corner and about the 1v1 area per player (484 tiles against 512). */
const W4 = 44;
/** The top-left of the four center tiles. */
const C4 = W4 / 2 - 1;
/** A tile and its 90°, 180° and 270° rotations on the W4 map. */
const quarters = (t: { x: number; y: number; amount: number }) => [
  t,
  { ...t, x: W4 - 1 - t.y, y: t.x },
  { ...t, x: W4 - 1 - t.x, y: W4 - 1 - t.y },
  { ...t, x: t.y, y: W4 - 1 - t.x },
];

type Placed = MapSpec["start"][number];
const fortressStart: Placed[] = [
  ...base.start,
  ...line(0, 13, y => ({ x: 13, y })).map((p): Placed => ({ ...p, kind: p.y === 7 ? "door" : "wall" })),
  ...line(0, 12, x => ({ x, y: 13 })).map((p): Placed => ({ ...p, kind: p.x === 7 ? "door" : "wall" })),
];

export const MAPS: Record<string, MapSpec> = {
  open: {
    ...base,
    name: "open",
    description: "Flat island. Each corner has 1,200 mineral at home and 2,800 at two flank expansions; two shared deposits of 800 mineral lie in the center.",
    walls: [],
    sharedDeposits: [{ x: 15, y: 16, amount: 800 }, { x: 16, y: 15, amount: 800 }],
  },
  fortress: {
    ...base,
    name: "fortress",
    description: "Each player starts inside a corner fortress: the map edges close two sides; two owned, destructible wall lines close the others, each with one allied-only door. Each base has 1,200 mineral inside and 2,800 at two flank expansions outside. Two shared deposits of 800 mineral lie in the center.",
    walls: [],
    start: fortressStart,
    sharedDeposits: [{ x: 15, y: 16, amount: 800 }, { x: 16, y: 15, amount: 800 }],
  },
  ridge: {
    ...base,
    name: "ridge",
    description: "A rock ridge splits the island; three narrow passes. Each corner has 1,200 mineral at home and 2,800 at flank expansions. Two shared deposits of 800 mineral lie just behind the ridge.",
    walls: symmetric(line(6, 15, (x) => ({ x, y: 31 - x }), [10, 11, 15])),
    sharedDeposits: [{ x: 13, y: 14, amount: 800 }, { x: 18, y: 17, amount: 800 }],
  },
  canyons: {
    ...base,
    name: "canyons",
    description: "Two long walls make three lanes: a central highway between the bases and two flanks. Each corner has 1,200 mineral at home and 2,800 at flank expansions; shared mines lie in the center.",
    walls: symmetric(line(4, 18, (x) => ({ x, y: x + 9 }), [11, 12])),
    sharedDeposits: [{ x: 15, y: 16, amount: 800 }, { x: 16, y: 15, amount: 800 }],
  },
  "fortress-quad": {
    ...base,
    name: "fortress-quad",
    description: "Four identical corner fortresses, rotated 90 degrees: the map edges close two sides of each base; two owned, destructible wall lines close the others, each with one allied-only door. Each base has 1,200 mineral inside and 2,800 at flank expansions outside. Shared deposits lie between corners and in the center.",
    width: W4,
    height: W4,
    seats: 4,
    walls: [],
    start: fortressStart,
    sharedDeposits: [
      ...quarters({ x: C4, y: C4, amount: 800 }),
      ...quarters({ x: C4, y: 5, amount: 600 }),
    ],
  },
  quad: {
    ...base,
    name: "quad",
    description: "Four corners on open ground, each with 1,200 mineral at home and 4,000 at expansions. A shared deposit lies between each pair of neighbouring corners and four of 800 mineral in the center.",
    width: W4,
    height: W4,
    seats: 4,
    walls: [],
    deposits: [...base.deposits, { x: 14, y: 13, amount: 600 }, { x: 13, y: 14, amount: 600 }],
    sharedDeposits: [
      ...quarters({ x: C4, y: C4, amount: 800 }),
      ...quarters({ x: C4, y: 5, amount: 600 }),
    ],
  },
};

/** Experimental layout: one 700-mineral flank mine per seat moves toward the
 * boundary between neighbours. Quantities, home openings and rotations match quad. */
MAPS["quad-contested"] = {
  ...MAPS.quad,
  name: "quad-contested",
  description: "Experimental quad layout: same 26,400 total mineral and 1,200 home resources per seat. One 700-mineral flank deposit per seat is relocated between neighbouring corners; all other rules and deposits are unchanged.",
  deposits: MAPS.quad.deposits.map(d => d.x === 16 && d.y === 6 ? { ...d, x: 21, y: 11 } : { ...d }),
};

// Solid terrain wedges, anchored to each edge. Their tips leave a 12x12 center
// open; no perimeter shortcut or destructible breach connects adjacent bases.
const northWedge: Tile[] = [];
for (let y = 0; y < 16; y++) {
  const left = 12 + Math.floor(y / 2);
  for (let x = left; x < W4 - left; x++) northWedge.push({ x, y });
}
const solidWedges = northWedge.flatMap(t => quarters({ ...t, amount: 0 }).map(({ x, y }) => ({ x, y })));
const approachMines: Record<string, Tile> = {
  "15,5": { x: 14, y: 10 }, "21,11": { x: 18, y: 16 },
  "5,15": { x: 10, y: 14 }, "6,16": { x: 16, y: 18 },
};

MAPS["quad-crossroads"] = {
  ...MAPS["quad-contested"],
  name: "quad-crossroads",
  description: "Four corner bases separated by four solid, indestructible terrain wedges drawn as grey walls. Routes between corners pass through the open center. Mines displaced by terrain sit along the central approaches; amounts and starting positions match quad-contested: 26,400 total mineral, 1,200 at home per seat.",
  walls: solidWedges,
  wallStyle: "wall",
  deposits: MAPS["quad-contested"].deposits.map(d => ({ ...d, ...approachMines[`${d.x},${d.y}`] })),
  sharedDeposits: [...quarters({ x: C4, y: C4, amount: 800 }), ...quarters({ x: C4, y: 17, amount: 600 })],
};
