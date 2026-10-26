import { expect, it } from "vitest";
import { MAPS, mapToSeat, matchLengthMs, rules, seatToMap, type SpectatorView, type ReplayFile } from "@castellan/shared";
import { createMatch, findPath, runReplay, type PlayerOrder } from "../src";

const map = MAPS["fortress-hex"];
const players = Array.from({ length: 6 }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));

it.each(["hex", "fortress-hex"])("%s gives six independent players identical rotated openings and waits for the sixth survivor", async name => {
  const map = MAPS[name];
  expect([map.width, map.height]).toEqual([64, 64]);
  expect(map.start.filter(e => e.kind === "wall" || e.kind === "door")).toHaveLength(name === "hex" ? 0 : 37);
  const match = await createMatch({ ruleset: { ...rules, map }, players, seed: 31, tickRate: 10 });
  try {
    const frame = match.spectate();
    expect(new Set(frame.players.map(p => p.team)).size).toBe(6);
    expect(matchLengthMs({ ...rules, map })).toBe(900_000);
    for (const [seat, player] of players.entries()) {
      const view = match.view(player.id);
      expect(view.allies).toEqual([]);
      expect(view.enemy).toEqual([]); // the initial bases do not see each other
      expect(view.mine.map(e => {
        const [x, y] = mapToSeat(e.x, e.y, seat, map.width, map.height, map.origins);
        return { kind: e.kind, x, y };
      })).toEqual(map.start);
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

it("places six camps around a 64-square map with reachable neighbouring gates and center", async () => {
  expect([map.width, map.height]).toEqual([64, 64]);
  const midpoint = { x: (map.width - 1) / 2, y: (map.height - 1) / 2 };
  const origins = map.origins!;
  expect(origins.reduce((sum, p) => sum + p.x, 0) / origins.length).toBe(midpoint.x);
  expect(origins.reduce((sum, p) => sum + p.y, 0) / origins.length).toBe(midpoint.y);
  for (const from of origins) for (const to of origins) expect(Math.hypot(from.x - to.x, from.y - to.y)).toBeLessThanOrEqual(64);
  const match = await createMatch({ ruleset: { ...rules, map }, players, seed: 31, tickRate: 10 });
  try {
    const frame = match.spectate();
    // 10 Hz Knight movement is 4 ticks straight / 6 diagonal (including rounding).
    const ticks = (from: { x: number; y: number }, to: { x: number; y: number }, range: number) => {
      const owner = frame.entities.find(e => e.kind === "castle" && e.x === from.x && e.y === from.y)!.owner;
      const blocked = new Set([...frame.deposits, ...frame.entities.filter(e => rules.kinds[e.kind].building && !(e.kind === "door" && e.owner === owner))].map(p => `${p.x},${p.y}`));
      const grid = { width: map.width, height: map.height, isStatic: (x: number, y: number) => blocked.has(`${x},${y}`) };
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
    // Attackers can approach an enemy gate, but cannot path through it to the Castle.
    const approach = (from: typeof midpoint, to: typeof midpoint) => Math.min(...frame.entities
      .filter(e => e.kind === "door" && Math.max(Math.abs(e.x - to.x), Math.abs(e.y - to.y)) === 6)
      .map(door => ticks(from, door, 1)));
    const neighbours = origins.flatMap((p, i) => [approach(p, origins[(i + 1) % 6]), approach(p, origins[(i + 5) % 6])]);
    const center = origins.map(p => ticks(p, midpoint, 1));
    // Bounds are on the real obstacle-aware path, not a Euclidean drawing.
    expect(Math.max(...neighbours)).toBeLessThanOrEqual(150);
    expect(Math.max(...neighbours) - Math.min(...neighbours)).toBeLessThanOrEqual(12);
    expect(Math.max(...center)).toBeLessThanOrEqual(160);
    expect(Math.max(...center) - Math.min(...center)).toBeLessThanOrEqual(40);
    for (const p of origins) for (const mine of map.sharedDeposits) expect(ticks(p, mine, 1)).toBeLessThan(300);
  } finally { match.dispose(); }
});

it("seals three-wall camps against the boundary and lets workers leave through every gate", async () => {
  const match = await createMatch({ ruleset: { ...rules, map }, players, seed: 31, tickRate: 10 });
  try {
    const frame = match.spectate();
    const exits = [{ x: 7, y: 0 }, { x: 0, y: 7 }, { x: -7, y: 0 }];
    const workers = players.map(p => frame.entities.find(e => e.owner === p.id && e.kind === "worker")!);
    for (const [seat, player] of players.entries()) {
      const origin = map.origins![seat];
      const perimeter = frame.entities.filter(e => e.owner === player.id && (e.kind === "wall" || e.kind === "door"));
      expect(perimeter.filter(e => e.kind === "wall")).toHaveLength(34);
      expect(perimeter.filter(e => e.kind === "door").map(e => mapToSeat(e.x, e.y, seat, map.width, map.height, map.origins)).sort())
        .toEqual([[6, 0], [0, 6], [-6, 0]].sort());
      expect(perimeter.every(e => Math.max(Math.abs(e.x - origin.x), Math.abs(e.y - origin.y)) === 6)).toBe(true);
      const [bx, by] = seatToMap(0, -7, seat, map.width, map.height, map.origins);
      expect(bx < 0 || by < 0 || bx >= map.width || by >= map.height).toBe(true);
      const blocked = new Set(perimeter.map(p => `${p.x},${p.y}`));
      const grid = { width: map.width, height: map.height, isStatic: (x: number, y: number) => blocked.has(`${x},${y}`) };
      for (const exit of exits) {
        const [x, y] = seatToMap(exit.x, exit.y, seat, map.width, map.height, map.origins);
        expect(findPath(grid, x, y, origin.x, origin.y, 1)).toBeNull();
        const [dx, dy] = seatToMap(Math.sign(exit.x) * 6, Math.sign(exit.y) * 6, seat, map.width, map.height, map.origins);
        const passage = { ...grid, isStatic: (x: number, y: number) => grid.isStatic(x, y) && !(x === dx && y === dy) };
        expect(findPath(passage, origin.x, origin.y, x, y, 0)).not.toBeNull();
      }
    }
    match.step(players.map(p => ({ player: p.id, order: { type: "script", kind: "worker", code: "self.hold();" } })));
    for (const exit of exits) {
      const orders = workers.map((worker, seat) => {
        const [x, y] = seatToMap(exit.x, exit.y, seat, map.width, map.height, map.origins);
        return { player: worker.owner, order: { type: "move" as const, unit: worker.id, x, y } };
      });
      expect(match.step(orders).results.every(r => r.ok)).toBe(true);
      for (let tick = 0; tick < 160; tick++) match.step([]);
      for (const { player, order } of orders) expect(match.view(player).mine.find(e => e.id === order.unit)).toMatchObject({ x: order.x, y: order.y });
    }
  } finally { match.dispose(); }
});

it.each(["hex", "fortress-hex"])("%s runs and strictly replays all six script engines, including production and movement in the last seats", async name => {
  const map = MAPS[name];
  const ruleset = { ...rules, map, fourSeatMatchMs: 15_000 };
  const match = await createMatch({ ruleset, players, seed: 31, tickRate: 10 });
  try {
    const input: PlayerOrder[] = players.flatMap((p, seat) => {
      const castle = match.view(p.id).mine.find(e => e.kind === "castle")!;
      const [x, y] = seatToMap(4, 4, seat, map.width, map.height, map.origins);
      return [
        { player: p.id, order: { type: "script", kind: "knight", code: `self.moveTo(${x},${y});` } },
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
      const knight = view.mine.find(e => e.kind === "knight")!;
      expect(mapToSeat(knight.x, knight.y, seat, map.width, map.height, map.origins)[1]).toBeGreaterThan(2);
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
  const invalidRotation = structuredClone(map);
  Object.assign(invalidRotation.origins![0], { rotation: 4 });
  for (const bad of [
    invalidRotation,
    { ...map, origins: undefined },
    { ...map, origins: map.origins!.slice(0, 5) },
    { ...map, origins: map.origins!.map(() => ({ x: 10, y: 34 })) },
    { ...map, origins: [{ x: 0, y: 0 }, ...map.origins!.slice(1)] },
  ]) await expect(createMatch({ ruleset: { ...rules, map: bad }, players, seed: 1, tickRate: 10 })).rejects.toThrow(/origins|tile/);
  await expect(createMatch({ ruleset: { ...rules, map }, players: players.map(p => ({ ...p, side: 0 })), seed: 1, tickRate: 10 })).rejects.toThrow("distinct valid map seats");
});
