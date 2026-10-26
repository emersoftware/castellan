import { expect, it } from "vitest";
import { MAPS, mapToSeat, matchLengthMs, rules, seatToMap, type SpectatorView, type ReplayFile } from "@castellan/shared";
import { createMatch, findPath, runReplay, type PlayerOrder } from "../src";

const map = MAPS.hex;
const players = Array.from({ length: 6 }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));

it("gives six independent players identical translated openings and waits for the sixth survivor", async () => {
  const match = await createMatch({ ruleset: { ...rules, map }, players, seed: 31, tickRate: 10 });
  try {
    const frame = match.spectate();
    expect(new Set(frame.players.map(p => p.team)).size).toBe(6);
    expect(matchLengthMs({ ...rules, map })).toBe(900_000);
    for (const [seat, player] of players.entries()) {
      const view = match.view(player.id);
      expect(view.allies).toEqual([]);
      expect(view.enemy).toEqual([]); // the initial bases do not see each other
      expect(view.mine.map(e => ({ kind: e.kind, x: e.x - map.origins![seat].x, y: e.y - map.origins![seat].y }))).toEqual(map.start);
      for (const entity of view.mine) {
        const local = mapToSeat(entity.x, entity.y, seat, map.width, map.height, map.origins);
        expect(seatToMap(...local, seat, map.width, map.height, map.origins)).toEqual([entity.x, entity.y]);
      }
    }
    for (const player of players.slice(0, -1)) {
      match.forfeit(player.id);
      if (player.id !== "p5") expect(match.outcome).toBeNull();
    }
    expect(match.outcome).toMatchObject({ winner: "p6", winners: ["p6"] });
  } finally { match.dispose(); }
});

it("keeps actual neighbour and center paths close after mineral obstacles are placed", async () => {
  const match = await createMatch({ ruleset: { ...rules, map }, players, seed: 31, tickRate: 10 });
  try {
    const frame = match.spectate();
    const blocked = new Set([...frame.deposits, ...frame.entities.filter(e => rules.kinds[e.kind].building)].map(p => `${p.x},${p.y}`));
    const grid = { width: map.width, height: map.height, isStatic: (x: number, y: number) => blocked.has(`${x},${y}`) };
    // 10 Hz Knight movement is 4 ticks straight / 6 diagonal (including rounding).
    const ticks = (from: { x: number; y: number }, to: { x: number; y: number }, range: number) => {
      const path = findPath(grid, from.x, from.y, to.x, to.y, range, undefined, undefined, 6, 4);
      expect(path).not.toBeNull();
      let { x, y } = from, cost = 0;
      for (const tile of path!) {
        const nx = tile % map.width, ny = Math.floor(tile / map.width);
        cost += nx !== x && ny !== y ? 6 : 4;
        x = nx; y = ny;
      }
      return cost;
    };
    const origins = map.origins!;
    const neighbours = origins.flatMap((p, i) => [ticks(p, origins[(i + 1) % 6], 1), ticks(p, origins[(i + 5) % 6], 1)]);
    const center = origins.map(p => ticks(p, { x: 42, y: 34 }, 0));
    // Bounds are on the real obstacle-aware path, not a Euclidean drawing.
    expect(Math.max(...neighbours)).toBeLessThanOrEqual(140);
    expect(Math.max(...neighbours) - Math.min(...neighbours)).toBeLessThanOrEqual(12);
    expect(Math.max(...center)).toBeLessThanOrEqual(150);
    expect(Math.max(...center) - Math.min(...center)).toBeLessThanOrEqual(12);
    for (const p of origins) for (const mine of map.sharedDeposits) expect(ticks(p, mine, 1)).toBeLessThan(300);
  } finally { match.dispose(); }
});

it("runs and strictly replays all six script engines, including production and movement in the last seats", async () => {
  const ruleset = { ...rules, map, fourSeatMatchMs: 15_000 };
  const match = await createMatch({ ruleset, players, seed: 31, tickRate: 10 });
  try {
    const input: PlayerOrder[] = players.flatMap(p => {
      const castle = match.view(p.id).mine.find(e => e.kind === "castle")!;
      return [
        { player: p.id, order: { type: "script", kind: "knight", code: "const c=self.nearbyAllies().find(e=>e.type==='castle'); if(c)self.moveTo(c.x+4,c.y+4);" } },
        { player: p.id, order: { type: "train", building: castle.id, kind: "knight" } },
      ];
    });
    const hashes: Record<number, string> = {};
    while (!match.outcome) {
      const tick = match.tick;
      const result = match.step(tick === 0 ? input : []);
      if (tick === 0) expect(result.results.every(r => r.ok)).toBe(true);
      expect(result.events.some(e => e.type === "script_error")).toBe(false);
      hashes[tick] = match.hash();
    }
    const last = players.map(p => match.view(p.id));
    for (const [seat, view] of last.entries()) {
      expect(view.mine.filter(e => e.kind === "knight")).toHaveLength(1);
      expect(view.mine.find(e => e.kind === "knight")!.y).toBeGreaterThan(map.origins![seat].y + 2);
    }
    const replay: ReplayFile = { format: 1, id: "six", createdAt: "", ruleset, players, seed: 31, tickRate: 10,
      orders: input.map(o => ({ tick: 0, ...o })), hashes, finalTick: match.tick, outcome: match.outcome! };
    let views: SpectatorView["perspectives"];
    const check = await runReplay(JSON.parse(JSON.stringify(replay)), frame => { views = frame.perspectives; });
    expect(check.verified).toBe(true);
    for (const view of last) expect(views![view.you].entities.filter(e => e.owner === view.you)).toEqual(view.mine);
  } finally { match.dispose(); }
});

it("rejects missing, duplicate, overlapping or out-of-bounds six-seat layouts before creating VMs", async () => {
  for (const bad of [
    { ...map, origins: undefined },
    { ...map, origins: map.origins!.slice(0, 5) },
    { ...map, origins: map.origins!.map(() => ({ x: 10, y: 34 })) },
    { ...map, origins: [{ x: 0, y: 0 }, ...map.origins!.slice(1)] },
  ]) await expect(createMatch({ ruleset: { ...rules, map: bad }, players, seed: 1, tickRate: 10 })).rejects.toThrow(/origins|tile/);
  await expect(createMatch({ ruleset: { ...rules, map }, players: players.map(p => ({ ...p, side: 0 })), seed: 1, tickRate: 10 })).rejects.toThrow("distinct valid map seats");
});
