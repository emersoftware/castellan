import { afterEach, expect, it } from "vitest";
import { rules, type Ruleset } from "@aoa/shared";
import { createMatch, runReplay, type Match } from "../src";

const live: Match[] = [];
const players = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
afterEach(() => live.splice(0).forEach(m => m.dispose()));
async function setup(patch: Partial<Ruleset> = {}) {
  const m = await createMatch({ players, seed: 9, tickRate: 10, ruleset: {
    ...rules, matchMs: 5000,
    map: { ...rules.map, width: 8, height: 8, walls: [], deposits: [], sharedDeposits: [],
      start: [{ kind: "king", x: 0, y: 0 }, { kind: "knight", x: 3, y: 3 }] },
    defaultScripts: Object.fromEntries(Object.keys(rules.defaultScripts).map(k => [k, "self.hold();"])), ...patch,
  } });
  live.push(m); return m;
}
const unit = (m: Match, player = "a", kind = "knight") => m.view(player).mine.find(e => e.kind === kind)!;
const script = (code: string, kind = "knight", player = "a") => ({ player, order: { type: "script" as const, kind, code } });
const logs = (m: Match, input: Parameters<Match["step"]>[0] = []) => m.step(input).events
  .filter(e => e.type === "log" && e.owner === "a").map(e => e.type === "log" ? e.message : "");

it("runs onTick during a move, but requires explicit interruption to override the order", async () => {
  const m = await setup(), a = unit(m);
  const code = `return { onTick() { self.memory.n=(self.memory.n||0)+1; self.log(self.memory.n); self.attack(self.nearestEnemy()); } };`;
  expect(logs(m, [script(code), { player: "a", order: { type: "move", unit: a.id, x: 0, y: 3 } }])).toEqual(["1"]);
  expect(unit(m)).toMatchObject({ x: 2, y: 3, actionResult: { source: "order", effect: "move" } });
  expect(logs(m)).toEqual(["2"]);
  expect(unit(m, "b").hp).toBe(110);
});

it("reacts to damage next tick, suspends movement, fights, then resumes the stored destination", async () => {
  const m = await setup(), a = unit(m), b = unit(m, "b");
  m.step([{ player: "b", order: { type: "attack", unit: b.id, target: a.id } }]);
  const code = `return {
    onAttacked(e) { self.memory.until=self.tick+3; self.memory.target=e.attacker.id; self.suspendOrder(); self.attack(e.attacker); },
    onTick() { if(self.tick < self.memory.until) self.attack(self.memory.target); else self.continueOrder(); }
  };`;
  const hit = m.step([script(code), { player: "a", order: { type: "move", unit: a.id, x: 0, y: 3 } }]);
  expect(hit.events).toContainEqual(expect.objectContaining({ type: "attack", from: a.id, to: b.id }));
  expect(unit(m)).toMatchObject({ x: 3, y: 3, order: "move 0,3", orderSuspended: true, actionResult: { source: "script", effect: "attack" } });
  expect(m.view("b").enemy.find(e => e.id === a.id)).not.toHaveProperty("orderSuspended");
  m.step([]); m.step([]); m.step([]);
  expect(unit(m)).toMatchObject({ x: 2, y: 3, order: "move 0,3", actionResult: { source: "order", effect: "move" } });
  expect(unit(m)).not.toHaveProperty("orderSuspended");
});

it("lets the agent keep retreating when attacked, and does not repeat an old damage event", async () => {
  const m = await setup(), a = unit(m), b = unit(m, "b");
  m.step([{ player: "b", order: { type: "attack", unit: b.id, target: a.id } }]);
  const code = `return { onAttacked(e) { self.log(JSON.stringify([e.tick,e.damage,e.attacker.id])); self.continueOrder(); self.attack(e.attacker); } };`;
  expect(logs(m, [script(code), { player: "a", order: { type: "move", unit: a.id, x: 0, y: 3 } }])).toEqual([JSON.stringify([0, 10, b.id])]);
  expect(unit(m)).toMatchObject({ x: 2, y: 3, actionResult: { source: "order" } });
  expect(unit(m, "b").hp).toBe(110);
  expect(logs(m)).toEqual([]);
});

it("cancels without resuming stale orders and reports the reason once", async () => {
  const m = await setup(), a = unit(m);
  const code = `return { onTick() { self.cancelOrder(); self.hold(); }, onOrderEnded(e) { self.log(e.reason+':'+e.order.type); } };`;
  m.step([script(code), { player: "a", order: { type: "move", unit: a.id, x: 0, y: 3 } }]);
  expect(unit(m)).toMatchObject({ x: 3, y: 3 });
  expect(unit(m).order).toBeUndefined();
  expect(logs(m)).toEqual(["cancelled by script:move"]);
  expect(logs(m)).toEqual([]);
});

it("new manual orders replace suspended ones and reset suspension", async () => {
  const m = await setup(), a = unit(m);
  m.step([script("if(!self.memory.once){self.memory.once=true;self.suspendOrder();}self.hold();"),
    { player: "a", order: { type: "move", unit: a.id, x: 0, y: 3 } }]);
  expect(unit(m).orderSuspended).toBe(true);
  expect(logs(m, [script("return {onOrderEnded(e){self.log(e.reason);}};"),
    { player: "a", order: { type: "move", unit: a.id, x: 3, y: 0 } }])).toEqual(["replaced"]);
  expect(unit(m)).toMatchObject({ x: 3, y: 2, order: "move 3,0" });
  expect(unit(m).orderSuspended).toBeUndefined();
});

it("emits enemy sightings on entry and re-entry, without leaking hidden enemies", async () => {
  const m = await setup({ kinds: { ...rules.kinds, king: { ...rules.kinds.king, vision: 0 }, knight: { ...rules.kinds.knight, vision: 1, moveMs: 100 } } });
  const b = unit(m, "b");
  const before = m.hash();
  const probe = m.testScript("a", "knight", "return {onEnemySeen(e){self.log(e.enemy.id);}};");
  expect(probe.ok && Object.values(probe.frames[0].runs)[0].log).toBe(b.id);
  expect(m.hash()).toBe(before);
  expect(logs(m, [script("return {onEnemySeen(e){self.log(e.enemy.id);}};")])).toEqual([b.id]);
  expect(logs(m)).toEqual([]);
  m.step([{ player: "b", order: { type: "move", unit: b.id, x: 5, y: 5 } }]);
  expect(logs(m)).toEqual([]);
  m.step([{ player: "b", order: { type: "move", unit: b.id, x: 4, y: 4 } }]);
  expect(logs(m)).toEqual([b.id]);
  expect(logs(m)).toEqual([]);
});

it.each(["player", "unit"] as const)("keeps each unit's sighting range and nearest-first order with %s sight", async scriptSight => {
  const m = await setup({ scriptSight,
    kinds: { ...rules.kinds, king: { ...rules.kinds.king, vision: 0 }, knight: { ...rules.kinds.knight, vision: 1 } },
    map: { ...rules.map, width: 10, height: 10, walls: [], deposits: [], sharedDeposits: [],
      start: [{ kind: "king", x: 0, y: 0 }, { kind: "knight", x: 4, y: 2 }, { kind: "knight", x: 4, y: 7 }] },
  });
  // Mirroring puts B's first knight at (5,7), its second at (5,2).
  const [bottom, top] = m.view("b").mine.filter(e => e.kind === "knight");
  const expected = scriptSight === "player" ? [[top.id, bottom.id], [bottom.id, top.id]] : [[top.id], [bottom.id]];
  const code = `return { onEnemySeen(e) { (self.memory.seen ||= []).push(e.enemy.id); }, onTick() { self.log(JSON.stringify(self.memory.seen || [])); } };`;
  const probe = m.testScript("a", "knight", code);
  expect(probe.ok).toBe(true);
  if (probe.ok) expect(Object.values(probe.frames[0].runs).map(run => JSON.parse(run.log!))).toEqual(expected);
  expect(logs(m, [script(code)]).map(text => JSON.parse(text))).toEqual(expected);
});

it("suspending construction releases the site and restarts work when resumed", async () => {
  const m = await setup({ startMineral: 1000, map: { ...rules.map, width: 10, height: 10, walls: [], deposits: [], sharedDeposits: [],
    start: [{ kind: "king", x: 0, y: 0 }, { kind: "worker", x: 2, y: 2 }] } });
  const a = unit(m, "a", "worker");
  m.step([{ player: "a", order: { type: "build", unit: a.id, kind: "castle", x: 2, y: 3 } }]);
  const deadline = unit(m, "a", "worker").construction!.completesAtMs;
  m.step([script("self.suspendOrder();self.hold();", "worker")]);
  expect(unit(m, "a", "worker").construction).toBeUndefined();
  for (let i = 0; i < 10; i++) m.step([]);
  m.step([script("self.continueOrder();", "worker")]);
  expect(unit(m, "a", "worker").construction!.completesAtMs).toBeGreaterThan(deadline);
  expect(m.view("a").players[0].mineral).toBe(1000);
});

it("delivers completion events after arrival, and script probes do not consume live events", async () => {
  const m = await setup(), a = unit(m);
  m.step([script("return {onOrderEnded(e){self.log(e.reason);}};"), { player: "a", order: { type: "move", unit: a.id, x: 3, y: 3 } }]);
  const before = m.hash();
  expect(m.testScript("a", "knight", "return {onOrderEnded(e){self.log(e.reason);}};").ok).toBe(true);
  expect(m.hash()).toBe(before);
  expect(logs(m)).toEqual(["arrived"]);
  expect(logs(m)).toEqual([]);
});

it("preserves historical order precedence and replays reactive callbacks deterministically", async () => {
  const old = await setup({ reactiveOrders: undefined });
  const a = unit(old);
  expect(logs(old, [script("self.log('called');self.move('N');"), { player: "a", order: { type: "move", unit: a.id, x: 0, y: 3 } }])).toEqual([]);
  const m = await setup(), own = unit(m);
  const orders = [script("return {onEnemySeen(e){self.suspendOrder();self.attack(e.enemy);},onTick(){if(self.tick>3)self.continueOrder();}};"),
    { player: "a", order: { type: "move" as const, unit: own.id, x: 0, y: 3 } }];
  const hashes: Record<number, string> = {};
  while (!m.outcome) { const tick = m.tick; m.step(tick === 0 ? orders : []); hashes[tick] = m.hash(); }
  expect((await runReplay({ format: 1, id: "reactive-orders", createdAt: new Date(0).toISOString(), players, seed: 9, tickRate: 10,
    ruleset: m.ruleset, orders: orders.map(o => ({ ...o, tick: 0 })), hashes, finalTick: m.tick, outcome: m.outcome! }, () => {})).verified).toBe(true);
});
