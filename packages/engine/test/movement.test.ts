import { afterEach, expect, it } from "vitest";
import { rules, type Ruleset, type ReplayFile } from "@castellan/shared";
import { createMatch, runReplay, type Match, type PlayerOrder } from "../src";
import { seatToMap } from "@castellan/shared";

const live: Match[] = [];
afterEach(() => { for (const m of live.splice(0)) m.dispose(); });
const players = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
async function start(map: Ruleset["map"], tickRate = 10, coordinatedMovement = true, side = 0) {
  const ruleset = { ...rules, coordinatedMovement, tickPathCosts: true, matchMs: 60000,
    defaultScripts: Object.fromEntries(Object.keys(rules.kinds).map(k => [k, "self.hold();"])), map };
  const m = await createMatch({ ruleset, players: players.map((p, i) => ({ ...p, side: (side + i) % 4 })), seed: 1, tickRate }); live.push(m); return m;
}
const units = (m: Match) => m.view("a").mine.filter(e => e.kind === "knight");
const corridor: Ruleset["map"] = { name: "column", description: "", width: 30, height: 30,
  deposits: [], sharedDeposits: [],
  walls: [3, 5].flatMap(y => Array.from({ length: 13 }, (_, x) => ({ x, y }))),
  start: [{ kind: "king", x: 0, y: 0 }, { kind: "door", x: 8, y: 4 },
    ...Array.from({ length: 6 }, (_, i) => ({ kind: "knight" as const, x: i + 1, y: 4 }))] };
const advance = (m: Match, count: number) => { for (let i = 0; i < count; i++) m.step([]); };
const columnOrders = (m: Match): PlayerOrder[] => units(m).map(e => ({ player: "a", order: { type: "move", unit: e.id, x: 20, y: 4 } }));

it.each([0, 1, 2, 3])("advances a ready column together from seat %i, even with the rear units created first", async side => {
  const rotate = (x: number, y: number) => seatToMap(x, y, side, 30, 30);
  const m = await start({ ...corridor, walls: corridor.walls.map(p => { const [x,y] = rotate(p.x,p.y); return {x,y}; }) }, 10, true, side);
  const [x,y] = rotate(20,4);
  m.step(units(m).map(e => ({ player: "a", order: {type: "move", unit: e.id, x,y} })));
  const expected = [2,3,4,5,6,7].map(x => rotate(x,4));
  expect(units(m).map(e => [e.x,e.y])).toEqual(expected);
  advance(m, 3);
  expect(units(m).map(e => [e.x,e.y])).toEqual(expected); // each moved only once; cooldown still applies
});

it("crosses an allied door and finishes a shared destination on separate nearby tiles", async () => {
  const m = await start(corridor);
  m.step(columnOrders(m));
  advance(m, 180);
  const army = units(m);
  expect(army.every(e => e.order === undefined)).toBe(true);
  expect(army.every(e => Math.hypot(e.x - 20, e.y - 4) <= 2)).toBe(true);
  expect(new Set(army.map(e => `${e.x},${e.y}`)).size).toBe(6);
  expect(m.view("a").mine.find(e => e.kind === "door")?.open).toBe(false);
});

it("finishes a shared destination inside a one-tile corridor without parking beyond the lead unit", async () => {
  const m = await start({ ...corridor, walls: [3, 5].flatMap(y => Array.from({ length: 30 }, (_, x) => ({ x, y }))) });
  m.step(columnOrders(m));
  advance(m, 180);
  expect(units(m).every(e => e.order === undefined)).toBe(true);
  expect(units(m).map(e => e.x).sort((a,b) => a-b)).toEqual([15,16,17,18,19,20]);
});

it("does not push an idle ally or swap through it in a one-tile corridor", async () => {
  const m = await start(corridor);
  m.step(columnOrders(m).slice(0, -1));
  advance(m, 24);
  expect(units(m).map(e => e.x)).toEqual([1, 2, 3, 4, 5, 6]);
});

it.each([[5, 65], [10, 130]])("chooses the lower travel-time route with rounded step durations at %i Hz", async (rate, expectedCost) => {
  // Independent route costs: the old 10/14 choice uses 12 straight + 14 diagonal = 132 ticks.
  // A route with 22 straight + 7 diagonal costs 130 ticks at 10 Hz (400/600 ms).
  const rocks = [[4,1],[2,2],[3,2],[0,3],[1,3],[9,10],[15,11],[16,11],[8,12],[14,12],
    [10,13],[11,13],[13,13],[16,13],[19,13],[12,14],[17,14],[18,14],[16,17],[15,18]];
  const m = await start({ name: "travel-time", description: "", width: 42, height: 24,
    deposits: [], sharedDeposits: [], start: [{ kind: "king", x: 0, y: 22 }, { kind: "knight", x: 1, y: 1 }],
    walls: [...rocks.map(([x,y]) => ({x,y})), ...Array.from({length: 21}, (_,i) => [{x:20,y:i},{x:i,y:20}]).flat()] }, rate);
  let previous = units(m)[0], cost = 0;
  const order: PlayerOrder = { player: "a", order: { type: "move", unit: previous.id, x: 18, y: 18 } };
  for (let i = 0; i < 200; i++) {
    m.step(i === 0 ? [order] : []);
    const next = units(m)[0];
    if (next.x !== previous.x || next.y !== previous.y) cost += next.x !== previous.x && next.y !== previous.y ? Math.round(0.56 * rate) : Math.round(0.4 * rate);
    previous = next;
    if (next.x === 18 && next.y === 18) break;
  }
  expect(previous).toMatchObject({ x: 18, y: 18 });
  expect(cost).toBe(expectedCost);
});

it.each([true, false])("replays column movement with its recorded coordination policy (%s)", async coordinated => {
  const m = await start({ ...corridor }, 10, coordinated);
  const orders = columnOrders(m), hashes: Record<number, string> = {};
  for (let t = 0; t < 160; t++) { m.step(t === 0 ? orders : []); hashes[t] = m.hash(); }
  const replay: ReplayFile = { format: 1, id: "movement", createdAt: "", ruleset: m.ruleset, players,
    seed: 1, tickRate: 10, orders: orders.map(o => ({ ...o, tick: 0 })), hashes, finalTick: m.tick,
    outcome: { winner: null, winners: [], reason: "timeout", scores: {} } };
  expect(await runReplay(replay, () => {})).toEqual({ verified: true, desyncAt: undefined });
});
