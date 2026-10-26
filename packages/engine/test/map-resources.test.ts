import { expect, it } from "vitest";
import { MAPS, rules, type MapSpec, type ReplayFile, type SpectatorView } from "@castellan/shared";
import { createMatch, findPath, runReplay } from "../src";
import { seatToMap } from "@castellan/shared";
import { SEAT_DIRS, type Grid } from "../src/grid";

const home = (x: number, y: number) => x < 13 && y < 13;
const sum = (mines: { amount: number }[]) => mines.reduce((n, d) => n + d.amount, 0);
const totalByMap: Record<string, number> = {
  open: 9600, fortress: 9600, ridge: 9600, canyons: 9600,
  quad: 26400, "quad-contested": 26400, "quad-crossroads": 26400, "fortress-quad": 21600, hex: 32400,
};

function movementGrid(frame: SpectatorView, map: MapSpec, owner: string): Grid {
  const blocked = new Set([
    ...frame.deposits,
    ...frame.entities.filter(e => rules.kinds[e.kind].building && !(e.kind === "door" && e.owner === owner)),
    ...map.walls,
  ].map(p => `${p.x},${p.y}`));
  return { width: map.width, height: map.height, isStatic: (x, y) => blocked.has(`${x},${y}`) };
}

function routeCost(grid: Grid, from: { x: number; y: number }, to: { x: number; y: number }, side: number): number {
  const path = findPath(grid, from.x, from.y, to.x, to.y, 1, SEAT_DIRS[side], undefined, 14);
  expect(path, `no route from ${from.x},${from.y} to ${to.x},${to.y}`).not.toBeNull();
  let x = from.x, y = from.y, cost = 0;
  for (const tile of path!) {
    const nx = tile % grid.width, ny = Math.floor(tile / grid.width);
    cost += nx !== x && ny !== y ? 14 : 10;
    x = nx; y = ny;
  }
  return cost;
}

for (const [name, map] of Object.entries(MAPS)) {
  it(`${name}: preserves mineral, rotates equal mining access and leaves expansions contestable`, async () => {
    const players = Array.from({ length: map.seats ?? 2 }, (_, side) => ({ id: `p${side}`, name: `P${side}`, side }));
    const match = await createMatch({ ruleset: { ...rules, map }, players, seed: 1, tickRate: 10 });
    try {
      const frame = match.spectate();
      const occupied = [...frame.entities, ...frame.deposits, ...map.walls];
      expect(occupied.every(p => p.x >= 0 && p.y >= 0 && p.x < map.width && p.y < map.height)).toBe(true);
      expect(new Set(occupied.map(p => `${p.x},${p.y}`)).size).toBe(occupied.length);
      expect(sum(frame.deposits)).toBe(totalByMap[name]);
      const atHome = (d: { x: number; y: number }) => map.origins ? Math.max(Math.abs(d.x), Math.abs(d.y)) < 8 : home(d.x, d.y);
      expect(sum(map.deposits.filter(atHome))).toBe(1200);
      expect(sum(map.deposits.filter(d => !atHome(d)))).toBe(name.startsWith("quad") ? 4000 : 2800);
      let reference: number[] | undefined;
      for (const player of players) {
        const grid = movementGrid(frame, map, player.id);
        const castle = frame.entities.find(e => e.owner === player.id && e.kind === "castle")!;
        const mines = map.deposits.map(d => {
          const [x, y] = seatToMap(d.x, d.y, player.side, map.width, map.height, map.origins);
          expect(frame.deposits).toContainEqual(expect.objectContaining({ x, y, amount: d.amount }));
          return { x, y, amount: d.amount };
        });
        const costs = mines.map(d => routeCost(grid, castle, d, player.side));
        // Shared mines are unordered under rotation; compare the distance multiset.
        // A square grid has no 60-degree rotational symmetry. Hex shared access
        // and travel bounds are measured separately in six-player.test.ts.
        if (!map.origins) costs.push(...map.sharedDeposits.map(d => routeCost(grid, castle, d, player.side)).sort((a, b) => a - b));
        if (reference) expect(costs).toEqual(reference);
        else reference = costs;
        // Every exposed mine is reachable by every opponent without breaching a
        // wall. A mine outside the home box but sealed behind rocks is not an expansion.
        for (const d of map.deposits.filter(d => !atHome(d))) {
          const [x, y] = seatToMap(d.x, d.y, player.side, map.width, map.height, map.origins);
          for (const enemy of players.filter(p => p.id !== player.id)) {
            const enemyCastle = frame.entities.find(e => e.owner === enemy.id && e.kind === "castle")!;
            routeCost(movementGrid(frame, map, enemy.id), enemyCastle, { x, y }, enemy.side);
          }
        }
      }
    } finally { match.dispose(); }
  });
}

it("replays use their embedded historical mine layout rather than today's map of the same name", async () => {
  const historicalMap = {
    ...MAPS.open,
    deposits: MAPS.open.deposits.filter(d => home(d.x, d.y)).map(d => ({ ...d, amount: 500 })),
  };
  const ruleset = { ...rules, map: historicalMap, matchMs: 3000 };
  const players = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
  const match = await createMatch({ ruleset, players, seed: 1, tickRate: 10 });
  try {
    const initial = match.spectate().deposits;
    const hashes: Record<number, string> = {};
    while (!match.outcome) {
      const tick = match.tick;
      match.step([]);
      hashes[tick] = match.hash();
    }
    const replay: ReplayFile = { format: 1, id: "historical-map", createdAt: "", ruleset, seed: 1, tickRate: 10,
      players, orders: [], hashes, finalTick: match.tick, outcome: match.outcome! };
    let first = true;
    const check = await runReplay(JSON.parse(JSON.stringify(replay)), frame => {
      if (!first) return;
      first = false;
      expect(frame.deposits).toEqual(initial);
      expect(frame.deposits).toHaveLength(18);
    });
    expect(check.verified).toBe(true);
    expect(MAPS.open.deposits).toHaveLength(12);
  } finally { match.dispose(); }
});
