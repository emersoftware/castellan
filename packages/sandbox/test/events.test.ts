import { beforeAll, expect, it } from "vitest";
import { rules } from "@castellan/shared";
import { createScriptHost, initSandbox, type ScriptWorld } from "../src";

beforeAll(initSandbox);
const world: ScriptWorld = {
  reactiveOrders: true, sight: "player", tick: 8, side: 0,
  units: { a: { id: "a", type: "knight", x: 1, y: 1, hp: 100, maxHp: 110, atk: 16, def: 6, range: 1, vision: 5,
    order: { type: "move", x: 9, y: 9 }, orderSuspended: false,
    events: [{ type: "attacked", tick: 7, damage: 10, attacker: "b" }, { type: "enemy_seen", tick: 8, enemy: "b" }] } },
  all: [["a", "knight", "p1", 1, 1, 1, 100, 110, 0, 1], ["b", "knight", "p2", 0, 2, 1, 110, 110, 0, 2]],
  myBase: null, enemyBase: null,
};

it("dispatches engine events before onTick, with one physical action and one order control", () => {
  const h = createScriptHost(rules.script, 1);
  try {
    h.setScript("knight", `const calls=[]; return {
      onAttacked(e){calls.push('hit:'+e.attacker.id+':'+e.damage);self.suspendOrder();self.attack(e.attacker);},
      onEnemySeen(e){calls.push('seen:'+e.enemy.id);},
      onTick(){calls.push('tick');self.continueOrder();self.move('N');self.log(calls.join(','));}
    };`);
    expect(h.run(world, ["a"]).a).toMatchObject({ action: { a: "attack", id: "b" }, orderControl: "suspend", log: "hit:b:10,seen:b,tick" });
  } finally { h.dispose(); }
});

it("hides attackers absent from perception and prevents mutation of the order snapshot", () => {
  const h = createScriptHost(rules.script, 1);
  try {
    h.setScript("knight", "return {onAttacked(e){self.log(String(e.attacker));}};");
    expect(h.run({ ...world, all: [world.all[0]] }, ["a"]).a.log).toBe("null");
    h.setScript("knight", "self.order.x=99;");
    expect(h.run(world, ["a"]).a.error).toMatch(/read.only/);
    expect(world.units.a.order).toEqual({ type: "move", x: 9, y: 9 });
  } finally { h.dispose(); }
});

it("meters callbacks in the same unit budget and preserves legacy return semantics", () => {
  const h = createScriptHost(rules.script, 1);
  try {
    h.setScript("knight", "return {onTick(){let n=0;for(let i=0;i<1000000;i++) n+=i;self.log(n);}};");
    expect(h.run(world, ["a"]).a.error).toMatch(/gas/);
    h.setScript("knight", "return {onTick(){self.move('N');}};");
    expect(h.run(world, ["a"]).a.action).toEqual({ a: "move", dir: "N" });
    expect(h.run({ ...world, reactiveOrders: undefined }, ["a"]).a.action).toEqual({ a: "hold" });
  } finally { h.dispose(); }
});
