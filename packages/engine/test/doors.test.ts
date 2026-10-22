import { afterEach, expect, it } from "vitest";
import { rules, MAPS, playerGuide, viewToText, type RecordedKind, type Ruleset, type ReplayFile } from "@castellan/shared";
import { createMatch, runReplay, type Match, type PlayerOrder } from "../src";
import { Board } from "../src/board";
import { SimulationClock } from "../src/clock";
import type { Entity } from "../src/entities";
import { Movement } from "../src/movement";

const live: Match[] = [];
afterEach(() => { for (const m of live.splice(0)) m.dispose(); });
const players = [{ id: "a", name: "A", side: 0, team: 0 }, { id: "b", name: "B", side: 1, team: 1 }];
const entity = (m: Match, kind: string, owner = "a") => m.spectate().entities.find(e => e.kind === kind && e.owner === owner)!;
const step = (m: Match, n = 1) => { for (let i = 0; i < n; i++) m.step([]); };
const move = (m: Match, id: string, x: number, y: number, player = "a") => m.step([{ player, order: { type: "move", unit: id, x, y } }]);
const spawn = (m: Match, kind: RecordedKind, owner: string, x: number, y: number) => { let id = ""; m.stage(s => { id = s.spawn(kind, owner, x, y); }); return id; };
const weaken = (m: Match, id: string) => m.stage(s => s.setHealth(id, 1));
async function setup(team = false, corridor = true) {
  // Instant walls and doors: these tests are about passage, not construction time.
  const ruleset: Ruleset = { ...rules, matchMs: 10000, startMineral: 1000,
    kinds: Object.fromEntries(Object.entries(rules.kinds).map(([k, s]) => [k, k === "wall" || k === "door" ? { ...s, buildMs: undefined } : s])),
    defaultScripts: { ...rules.defaultScripts, castle: "self.hold();" },
    map: { name: "doors", description: "", width: 9, height: 9,
      start: [{ kind: "worker", x: 1, y: 4 }, { kind: "king", x: 0, y: 0 }, { kind: "castle", x: 0, y: 1 }],
      deposits: [], sharedDeposits: [], walls: corridor ? [3,5].flatMap(y => Array.from({ length: 9 }, (_, x) => ({ x, y }))) : [] } };
  const participants = team ? [...players, { id: "ally", name: "Ally", side: 2, team: 0 }] : players;
  const m = await createMatch({ ruleset, players: participants, seed: 1, tickRate: 10 }); live.push(m);
  const build: PlayerOrder = { player: "a", order: { type: "build", unit: entity(m,"worker").id, kind: "door", x: 2, y: 4 } };
  return { m, build, ruleset };
}

it("uses castle consistently in current maps, rules, text, training and script API", async () => {
  expect(Object.values(MAPS).every(map => map.start.some(s => s.kind === "castle"))).toBe(true);
  expect(rules.kinds.nexus).toBeUndefined();
  expect(playerGuide(rules)).not.toMatch(/nexus/i);
  const { m } = await setup();
  expect(viewToText(m.view("a"))).toContain("castle");
  const castle = entity(m,"castle");
  expect(m.step([{ player:"a",order:{type:"script",kind:"castle",code:"self.hold();"} },
    { player:"a",order:{type:"train",building:castle.id,kind:"worker"} }]).results.every(r => r.ok)).toBe(true);
  expect(entity(m,"castle").training).toHaveLength(1);
  expect(m.step([{ player:"a", order:{type:"script",kind:"nexus",code:"self.hold();"} }]).results[0].ok).toBe(false);
});

it("builds a one-tile door with the advertised charge; allies cross and it closes behind them", async () => {
  const { m, build, ruleset } = await setup();
  const result = m.step([build]);
  const price = ruleset.kinds.door.cost;
  expect(result.events).toContainEqual(expect.objectContaining({ type:"spawn", kind:"door", x:2,y:4,mineral:{spent:price,remaining:ruleset.startMineral-price} }));
  expect(entity(m,"door")).toMatchObject({ open:false,hp:300 });
  const worker = entity(m,"worker");
  move(m,worker.id,4,4);
  expect(entity(m,"worker").x).toBe(2);
  expect(entity(m,"door").open).toBe(true);
  expect(m.view("a").grid[4][2]).toBe("W");
  step(m,10);
  expect(entity(m,"worker").x).toBe(4);
  expect(entity(m,"door").open).toBe(false);
  expect(m.view("a").grid[4][2]).toBe("D");
});

it("blocks hostile pathfinding while allowing same-team passage", async () => {
  const { m, build } = await setup(true);
  m.step([build]);
  const worker = entity(m,"worker");
  move(m,worker.id,4,4); step(m,10);
  const ally = spawn(m,"worker","ally",1,4);
  move(m,ally,3,4,"ally");
  expect(m.inspect(ally)!.x).toBe(2);
  const enemy = entity(m,"worker","b");
  move(m,enemy.id,1,4,"b"); step(m,10);
  expect(entity(m,"worker","b").x).toBeGreaterThan(2);
  expect(m.inspect(ally)!.x).toBe(3);
});

it("keeps the occupant when a door is destroyed, then opens the route to enemies", async () => {
  const { m, build } = await setup(); m.step([build]);
  const worker = entity(m,"worker"), door = entity(m,"door");
  move(m,worker.id,2,4);
  weaken(m,door.id);
  const knight=spawn(m,"knight","b",3,4);
  m.step([{player:"b",order:{type:"attack",unit:knight,target:door.id}}]);
  expect(entity(m,"door")).toBeUndefined();
  expect(m.inspect(worker.id)).toMatchObject({ x:2, y:4 });
  move(m,worker.id,1,4); step(m,5);
  move(m,knight,2,4,"b"); step(m,5);
  expect(m.inspect(knight)!.x).toBe(2);
});

it("retains the door when a unit on it dies; another ally can enter", async () => {
  const {m,build}=await setup();m.step([build]);const worker=entity(m,"worker"), door=entity(m,"door");
  move(m,worker.id,2,4);
  weaken(m,worker.id);
  const knight=spawn(m,"knight","b",3,4);
  m.step([{player:"b",order:{type:"attack",unit:knight,target:worker.id}}]);
  expect(entity(m,"door")).toMatchObject({id:door.id,open:false});
  const replacement=spawn(m,"worker","a",1,4);
  move(m,replacement,2,4);
  expect(entity(m,"door").open).toBe(true);
});

it("prevents overlapping construction even when a door's passage is empty", async () => {
  const {m,build}=await setup();m.step([build]);
  for(const kind of ["door","wall","castle"]){
    expect(m.step([{player:"a",order:{type:"build",unit:entity(m,"worker").id,kind,x:2,y:4}}]).results[0].ok).toBe(false);
  }
  expect(m.spectate().entities.filter(e=>e.x===2&&e.y===4)).toHaveLength(1);
});

it("keeps diagonal corner checks owner-aware around a door", () => {
  // Movement owns stepping; a board with one door at (2,4) east of a unit at (1,4).
  const units = new Map<string, Entity>();
  const board = new Board(9, 9, id => units.get(id)?.spec.building ?? false);
  const piece = (id: string, kind: "worker" | "door", owner: string, x: number, y: number) => {
    const e = { id, kind, owner, x, y, spec: rules.kinds[kind] } as Entity;
    units.set(id, e); board.place(e); return e;
  };
  piece("door", "door", "a", 2, 4);
  const worker = piece("worker", "worker", "a", 1, 4), enemy = piece("enemy", "worker", "b", 1, 5);
  const movement = new Movement(() => rules, new SimulationClock(10), board, units, () => 0, (x, y) => x !== y);
  expect(movement.canStep(worker, 2, 3)).toBe(true);
  expect(movement.canStep(enemy, 2, 4)).toBe(false);
  // From (1,4), the step to (2,3) cuts the door's corner: blocked for an enemy.
  expect(movement.canStep({ ...worker, owner: "b" }, 2, 3)).toBe(false);
});

it("serializes doors and their shared tiles through deterministic replay", async () => {
  const {m,build,ruleset}=await setup();const orders=[{...build,tick:0},{player:"a",tick:1,order:{type:"move" as const,unit:entity(m,"worker").id,x:4,y:4}}];
  const hashes:Record<number,string>={};
  while(!m.outcome){const tick=m.tick;m.step(orders.filter(o=>o.tick===tick));hashes[tick]=m.hash();}
  const replay:ReplayFile={format:1,id:"doors",createdAt:"",ruleset,seed:1,tickRate:10,players,orders,hashes,finalTick:m.tick,outcome:m.outcome!};
  let openSeen=false;
  expect(await runReplay(replay,v=>{openSeen ||= v.entities.some(e=>e.kind==="door"&&e.open)})).toMatchObject({verified:true});
  expect(openSeen).toBe(true);
});
