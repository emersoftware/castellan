import { afterEach, expect, it } from "vitest";
import { MAPS, NEUTRAL_OWNER, playerGuide, rules, viewToText, type ReplayFile, type Ruleset } from "@castellan/shared";
import { createMatch, findPath, runReplay, type Match } from "../src";
import { seatToMap } from "@castellan/shared";
import type { Grid } from "../src/grid";

const matches: Match[] = [];
afterEach(() => { for (const m of matches.splice(0)) m.dispose(); });
const players = [0, 1, 2, 3].map(side => ({ id: `p${side + 1}`, name: `P${side + 1}`, side }));
// Destructible scenario walls remain supported for embedded historical maps.
const neutralMap = { ...MAPS["quad-contested"], neutralWalls: [{ x: 12, y: 0 }, { x: 13, y: 0 }] };
async function start(ruleset: Ruleset, seats = players) {
  const m = await createMatch({ ruleset, players: seats, seed: 419, tickRate: 10 });
  matches.push(m);
  return m;
}
function corridor(): Ruleset {
  return {
    ...rules, matchMs: 90_000, defaultScripts: Object.fromEntries(Object.keys(rules.defaultScripts).map(k => [k, "self.hold();"])),
    map: { name: "neutral-corridor", description: "", width: 9, height: 9,
      walls: Array.from({ length: 9 }, (_, y) => ({ x: 4, y })).filter(w => w.y !== 4),
      neutralWalls: [{ x: 4, y: 4 }], deposits: [], sharedDeposits: [],
      start: [{ kind: "king", x: 0, y: 0 }, { kind: "knight", x: 2, y: 4 }, { kind: "worker", x: 2, y: 2 }],
    },
  };
}

it("adds inert walls without adding participants, resources, population, vision, or scripts", async () => {
  const r = { ...rules, map: neutralMap };
  const m = await start(r);
  const base = await start({ ...rules, map: MAPS["quad-contested"] });
  const f = m.spectate();
  const walls = f.entities.filter(e => e.owner === NEUTRAL_OWNER);
  expect(walls.length).toBeGreaterThan(0);
  expect(walls).toHaveLength(r.map.neutralWalls!.length);
  expect(walls.every(e => e.kind === "wall" && e.ruin && !e.vital && e.hp === rules.kinds.wall.hp && e.stats!.def === rules.kinds.wall.def)).toBe(true);
  expect(m.playerIds).toEqual(players.map(p => p.id));
  expect(f.players).toEqual(base.spectate().players);
  expect(f.deposits).toEqual(base.spectate().deposits);
  expect(Object.keys(f.perspectives!)).toEqual(m.playerIds);
  for (const p of players) {
    expect(m.view(p.id).visibility).toEqual(base.view(p.id).visibility);
    expect(m.view(p.id).scripts).toEqual(base.view(p.id).scripts);
  }
  m.step([]);
  expect(m.outcome).toBeNull();
});

it("routes every pair of bases through the center with solid, unattackable terrain", async () => {
  const map = MAPS["quad-crossroads"];
  const m = await start({ ...rules, map });
  const f = m.spectate();
  const blocked = new Set([...map.walls, ...f.deposits, ...f.entities.filter(e => rules.kinds[e.kind].building)].map(e => `${e.x},${e.y}`));
  expect(map.walls).toHaveLength(832);
  expect(map.neutralWalls).toBeUndefined();
  expect(f.entities.some(e => e.owner === NEUTRAL_OWNER)).toBe(false);
  expect(playerGuide({ ...rules, map })).toContain("cannot be attacked, and are not enemies");
  // Every horizontal slice of the northern wedge is filled, including its core.
  for (let y = 0; y < 16; y++) for (let x = 12 + Math.floor(y / 2); x < 32 - Math.floor(y / 2); x++) {
    expect(map.walls).toContainEqual({ x, y });
  }
  const central = (x: number, y: number) => x >= 16 && x <= 27 && y >= 16 && y <= 27;
  const grid: Grid = { width: 44, height: 44, isStatic: (x, y) => blocked.has(`${x},${y}`) };
  const closedCenter: Grid = { ...grid, isStatic: (x, y) => grid.isStatic(x, y) || central(x, y) };
  for (const a of players) for (const b of players.filter(p => p.id !== a.id)) {
    const from = seatToMap(6, 6, a.side, 44, 44);
    const to = seatToMap(6, 6, b.side, 44, 44);
    const path = findPath(grid, ...from, ...to, 0)!;
    expect(path).not.toBeNull();
    expect(path.some(t => central(t % 44, Math.floor(t / 44)))).toBe(true);
    expect(findPath(closedCenter, ...from, ...to, 0)).toBeNull();
  }
  // Even deleting the former contour pieces leaves the solid interior blocked.
  expect(blocked.delete("15,7")).toBe(true);
  expect(blocked.delete("28,7")).toBe(true);
  expect(findPath(closedCenter, 6, 6, 37, 6, 0)).toBeNull();
});

it("blocks movement, takes ordinary wall damage and opens its tile without kill credit", async () => {
  const r = corridor();
  const m = await start(r, players.slice(0, 2));
  const knight = m.view("p1").mine.find(e => e.kind === "knight")!;
  const wall = m.view("p1").enemy.find(e => e.owner === NEUTRAL_OWNER)!;
  const blocked = m.step([{ player: "p1", order: { type: "move", unit: knight.id, x: 5, y: 4 } }]);
  expect(blocked.events).toContainEqual(expect.objectContaining({ type: "order_end", reason: "unreachable" }));
  expect(m.view("p1").mine.find(e => e.id === knight.id)!.x).toBe(2);
  const before = m.spectate().players[0];
  expect(m.step([{ player: "p1", order: { type: "attack", unit: knight.id, target: wall.id } }]).results[0].ok).toBe(true);
  let firstHit = false, dead = false;
  for (let t = 0; t < 800 && !dead; t++) {
    const step = m.step([]);
    const hit = step.events.find(e => e.type === "attack" && e.to === wall.id);
    if (hit?.type === "attack") { expect(hit.dmg).toBe(Math.max(1, rules.kinds.knight.atk! - rules.kinds.wall.def)); firstHit = true; }
    dead = step.events.some(e => e.type === "death" && e.id === wall.id);
  }
  expect(firstHit && dead).toBe(true);
  const after = m.spectate().players[0];
  expect([after.score, after.kills, after.mineral]).toEqual([before.score, before.kills, before.mineral]);
  expect(m.outcome).toBeNull();
  m.step([{ player: "p1", order: { type: "move", unit: knight.id, x: 5, y: 4 } }]);
  for (let t = 0; t < 30; t++) m.step([]);
  expect(m.view("p1").mine.find(e => e.id === knight.id)).toMatchObject({ x: 5, y: 4 });
});

it("allows every team to attack scenario walls, and does not treat them as an enemy construction radius", async () => {
  const r = corridor();
  const m = await start(r, players.slice(0, 2).map(p => ({ ...p, team: 0 })));
  const wall = m.spectate().entities.find(e => e.owner === NEUTRAL_OWNER)!;
  const attacks = m.playerIds.map(player => ({ player, order: { type: "attack" as const,
    unit: m.view(player).mine.find(e => e.kind === "knight")!.id, target: wall.id } }));
  expect(m.step(attacks).results.every(r => r.ok)).toBe(true);
  const worker = m.view("p1").mine.find(e => e.kind === "worker")!;
  const build = m.step([{ player: "p1", order: { type: "build", unit: worker.id, kind: "wall", x: 3, y: 3 } }]);
  expect(build.results[0]).toMatchObject({ ok: true });
  for (let t = 0; t < 45; t++) m.step([]);
  expect(m.view("p1").mine).toContainEqual(expect.objectContaining({ kind: "wall", x: 3, y: 3 }));
  expect(m.spectate().entities.find(e => e.id === wall.id)!.hp).toBeLessThan(wall.hp);
});

it("keeps neutral walls behind fog and explains visible walls as scenario ruins", async () => {
  const r = { ...rules, map: neutralMap };
  const m = await start(r);
  const v = m.view("p1");
  const visible = v.enemy.filter(e => e.owner === NEUTRAL_OWNER);
  expect(visible.length).toBeLessThan(r.map.neutralWalls!.length);
  expect(v.enemy.every(e => v.visibility[e.y][e.x] === "2")).toBe(true);
  const near = await start(corridor(), players.slice(0, 2));
  const text = viewToText(near.view("p1"));
  expect(text).toContain("neutral walls (scenario, not a player; attackable)");
  expect(text).toContain("RUIN (scenario: inert, blocks, can be destroyed)");
  expect(text).not.toContain("ENEMY neutral");
  expect(playerGuide(r)).toContain("Their owner is not a participant or a victory target");
});

it("ends with the last real player even while neutral walls remain", async () => {
  const m = await start({ ...rules, map: neutralMap });
  for (const id of ["p2", "p3", "p4"]) m.forfeit(id);
  expect(m.outcome).toMatchObject({ winner: "p1", winners: ["p1"] });
  expect(Object.keys(m.outcome!.scores)).toEqual(m.playerIds);
  expect(m.spectate().entities.some(e => e.owner === NEUTRAL_OWNER)).toBe(true);
});

it("replays neutral destruction and movement from embedded map data with matching hashes", async () => {
  const r = corridor();
  const m = await start(r, players.slice(0, 2));
  const unit = m.view("p1").mine.find(e => e.kind === "knight")!;
  const wall = m.spectate().entities.find(e => e.owner === NEUTRAL_OWNER)!;
  const orders: ReplayFile["orders"] = [{ tick: 0, player: "p1", order: { type: "attack", unit: unit.id, target: wall.id } },
    { tick: 650, player: "p1", order: { type: "move", unit: unit.id, x: 5, y: 4 } }];
  const hashes: ReplayFile["hashes"] = {};
  while (!m.outcome) { const tick = m.tick; m.step(orders.filter(o => o.tick === tick)); if (tick % 10 === 0) hashes[tick] = m.hash(); }
  hashes[m.tick] = m.hash();
  const replay: ReplayFile = { format: 1, id: "neutral-wall-check", createdAt: "", ruleset: r, players: players.slice(0, 2), seed: 419,
    tickRate: 10, orders, hashes, finalTick: m.tick, outcome: m.outcome! };
  let initial = true, final;
  const result = await runReplay(JSON.parse(JSON.stringify(replay)), frame => {
    if (initial) expect(frame.entities).toContainEqual(expect.objectContaining({ id: wall.id, owner: NEUTRAL_OWNER, ruin: true }));
    initial = false; final = frame;
  });
  expect(result.verified).toBe(true);
  expect(final).toEqual(m.spectate(undefined, { includePrivateChat: true }));
});

it("rejects overlapping neutral walls and reserved participant ids", async () => {
  const r = corridor();
  r.map.neutralWalls!.push({ x: 2, y: 4 });
  await expect(start(r, players.slice(0, 2))).rejects.toThrow("occupied neutral wall tile");
  await expect(start(corridor(), [{ ...players[0], id: NEUTRAL_OWNER }, players[1]])).rejects.toThrow("reserved");
});
