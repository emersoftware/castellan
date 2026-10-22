import { beforeAll, describe, expect, it } from "vitest";
import { createScriptHost, initSandbox, testScript, validateScript, type ScriptWorld } from "../src";
import { rules } from "@castellan/shared";

const world: ScriptWorld = {
  tick: 5,
  side: 0,
  units: { e1: { id: "e1", type: "knight", x: 5, y: 5, hp: 80, maxHp: 80, atk: 12, def: 4, range: 1, vision: 4 } },
  all: [
    ["e1", "knight", "p1", 1, 5, 5, 80, 80, 0, 5 * 32 + 5],
    ["e2", "knight", "p2", 0, 6, 6, 50, 80, 0, 6 * 32 + 6],
    ["e3", "worker", "p2", 0, 20, 20, 40, 40, 0, 20 * 32 + 20],
  ],
  myBase: { x: 4, y: 4 },
  enemyBase: { x: 27, y: 27 },
};

beforeAll(initSandbox);

describe("sandbox", () => {
  it("runs a script and returns its action", () => {
    const h = createScriptHost(rules.script, 1);
    expect(h.setScript("knight", rules.defaultScripts.knight)).toEqual({ ok: true });
    expect(h.run(world, ["e1"]).e1.action).toEqual({ a: "attack", id: "e2" });
    h.dispose();
  });

  it("reports syntax errors", () => {
    expect(validateScript("self.hold(", rules.script).ok).toBe(false);
  });

  it("keeps the working script after a rejected replacement", () => {
    const h = createScriptHost(rules.script, 1);
    try {
      h.setScript("knight", "self.move('N');");
      expect(h.setScript("knight", "self.hold(").ok).toBe(false);
      expect(h.run(world, ["e1"]).e1.action).toEqual({ a: "move", dir: "N" });
    } finally { h.dispose(); }
  });

  it("prevents poisoned loader intrinsics from running outside the unit budget on later ticks", () => {
    const h = createScriptHost(rules.script, 1);
    try {
      // Finite payload: the old loader called a player-replaced Array.map with
      // metering off. It must neither install nor run on the next world load.
      h.setScript("knight", `Array.prototype.map = function () {
        let n = 0; for (let i = 0; i < 1000000; i++) n += i;
        return [];
      }; self.hold();`);
      expect(h.run(world, ["e1"]).e1.error).toMatch(/read.only/);
      h.setScript("knight", "self.attack(self.nearestEnemy());");
      expect(h.run(world, ["e1"]).e1).toMatchObject({ action: { a: "attack", id: "e2" } });
      for (const code of [
        "globalThis.Object = {};", "Object.keys = function () { return []; };",
        "Object.prototype.toJSON = function () { return {}; };", "Math.round = function () { return 0; };",
        "Object.getPrototypeOf([][Symbol.iterator]()).next = function () { let n=0; for(let i=0;i<1000000;i++) n+=i; return {done:true}; };",
      ]) {
        h.setScript("knight", code);
        expect(h.run(world, ["e1"]).e1.error).toBeTruthy();
      }
    } finally { h.dispose(); }
  });

  it("meters player-controlled memory serialization and error formatting", () => {
    const h = createScriptHost(rules.script, 1);
    const work = "let n=0; for(let i=0;i<1000000;i++) n+=i; return n;";
    try {
      for (const code of [
        `self.memory.toJSON = function () { ${work} };`,
        `throw { get message() { ${work} } };`,
      ]) {
        h.setScript("knight", code);
        const result = h.run(world, ["e1"]).e1;
        expect(result.error).toMatch(/gas/);
        expect(result.gasUsed).toBeGreaterThan(rules.script.gasPerUnit);
        h.setScript("knight", "self.memory = {}; self.hold();");
        expect(h.run(world, ["e1"]).e1.error).toBeUndefined();
      }
    } finally { h.dispose(); }
  });

  it("charges world loading to the player budget", () => {
    const h = createScriptHost({ ...rules.script, gasPerPlayer: 0 }, 1);
    try {
      const largeWorld = { ...world, all: Array.from({ length: 5000 }, () => world.all[0]) };
      expect(h.run(largeWorld, ["e1"]).e1.error).toBe("player gas exhausted loading world");
    } finally { h.dispose(); }
  });

  it("archer default shoots even a closing knight: stepping away is the player's choice", () => {
    const stats = { atk: 16, def: 6, range: 1, minRange: 0, vision: 6, attackMs: 1000, moveMs: 400, ruin: false };
    const archer = (x: number, y: number, moves: Record<string, boolean>): ScriptWorld => ({
      reactiveOrders: true, tick: 1, side: 0,
      units: { e1: { id: "e1", type: "archer", x, y, hp: 60, maxHp: 60, atk: 12, def: 3, range: 5, vision: 7, moves,
        attackReadyInTicks: 0, moveReadyInTicks: 0, aimReadyInTicks: 0, gatherReadyInTicks: 0 } },
      all: [["e1", "archer", "p1", 1, x, y, 60, 60, 0, y * 32 + x], ["e2", "knight", "p2", 0, x + 1, y, 100, 100, 0, y * 32 + x + 1, stats]],
      myBase: null, enemyBase: null,
    });
    const open = Object.fromEntries(["N", "NE", "E", "SE", "S", "SW", "W", "NW"].map((d) => [d, true]));
    const run = testScript(rules.defaultScripts.archer, "archer", [archer(5, 5, open)], rules.script);
    expect(run.ok && run.frames[0].runs.e1).toMatchObject({ action: { a: "attack", id: "e2" } });
  });

  it("probes finite scenarios in an isolated VM and reports requested actions and gas", () => {
    const frames = [world, { ...world, tick: 6 }];
    const code = "self.memory.n=(self.memory.n||0)+1; self.log(self.memory.n); self.move('N');";
    const result = testScript(code, "knight", frames, rules.script);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames.map(f => f.runs.e1.log)).toEqual(["1", "2"]);
    expect(result.frames[0].runs.e1).toMatchObject({ action: { a: "move", dir: "N" }, gasUsed: expect.any(Number) });
    expect(testScript("self.hold(", "knight", frames, rules.script).ok).toBe(false);
  });

  it("stops infinite loops with gas and keeps working", () => {
    const h = createScriptHost(rules.script, 1);
    h.setScript("knight", "while (true) {}");
    const r = h.run(world, ["e1"]).e1;
    expect(r.action).toEqual({ a: "hold" });
    expect(r.error).toMatch(/gas/);
    h.setScript("knight", "self.move('N')");
    expect(h.run(world, ["e1"]).e1.action).toEqual({ a: "move", dir: "N" });
    h.dispose();
  });

  it("keeps memory per unit and is deterministic", () => {
    const code = "self.memory.n = (self.memory.n || 0) + 1; self.log(self.memory.n + ':' + self.random().toFixed(6)); self.hold();";
    const logs = (seed: number) => {
      const h = createScriptHost(rules.script, seed);
      h.setScript("knight", code);
      const out = [h.run(world, ["e1"]).e1.log, h.run(world, ["e1"]).e1.log];
      h.dispose();
      return out;
    };
    const a = logs(7);
    expect(a[0]!.startsWith("1:")).toBe(true);
    expect(a[1]!.startsWith("2:")).toBe(true);
    expect(logs(7)).toEqual(a);
    expect(logs(8)).not.toEqual(a);
  });

  it("has no host access and no clock", () => {
    const h = createScriptHost(rules.script, 1);
    h.setScript("knight", "self.log([typeof Date, typeof require, typeof process, typeof fetch, typeof setTimeout].join(','));");
    expect(h.run(world, ["e1"]).e1.log).toBe("undefined,undefined,undefined,undefined,undefined");
    h.dispose();
  });

  it("reports a memory reset even when the script also failed", () => {
    const h = createScriptHost(rules.script, 1);
    h.setScript("knight", "self.memory.n = (self.memory.n || 0) + 1; self.memory.big = 'x'.repeat(5000); throw new Error('boom');");
    expect(h.run(world, ["e1"]).e1.error).toMatch(/boom.*self\.memory over \d+ bytes, reset/);
    h.setScript("knight", "self.memory.loop = self.memory; self.hold();");
    expect(h.run(world, ["e1"]).e1.error).toMatch(/self\.memory is not serializable, reset/);
    h.dispose();
  });

  it("caps memory and heap", () => {
    const h = createScriptHost(rules.script, 1);
    h.setScript("knight", "self.memory.big = 'x'.repeat(5000); self.hold();");
    expect(h.run(world, ["e1"]).e1.error).toMatch(/memory/);
    h.setScript("knight", "const a = []; for (let i = 0; i < 1e8; i++) a.push('xxxxxxxxxxxxxxxx' + i);");
    expect(h.run(world, ["e1"]).e1.error).toBeTruthy();
    h.setScript("knight", "self.hold()");
    expect(h.run(world, ["e1"]).e1.error).toBeUndefined();
    h.dispose();
  });
});

it('exposes worker economy controls with first action winning', () => {
 const h=createScriptHost(rules.script,1);
 const w={...world,units:{e1:{...world.units.e1,type:'worker',carrying:2,carryCapacity:10,lastAttackedTick:null,lastAttacker:null}},
  deposits:[{id:'far',x:8,y:8,amount:20,tie:80},{id:'near',x:5,y:6,amount:10,tie:50}]};
 try {
  h.setScript('worker','self.gather(self.nearestDeposit()); self.unload();');
  expect(h.run(w,['e1']).e1.action).toEqual({a:'gather',id:'near'});
  h.setScript('worker','if(self.carrying === 2 && self.carryCapacity === 10) self.unload();');
  expect(h.run(w,['e1']).e1.action).toEqual({a:'unload'});
  h.setScript('worker','self.gather();');expect(h.run(w,['e1']).e1.action).toEqual({a:'gather'});
 }finally{h.dispose();}
});
it('returns a living hostile attacker the player sees, even beyond this unit\'s vision, and leaves legacy APIs unchanged',()=>{
 const h=createScriptHost(rules.script,1);
 try {
  h.setScript('knight','self.log(typeof self.lastAttacker);');expect(h.run(world,['e1']).e1.log).toBe('undefined');
  h.setScript('knight','self.log(self.lastAttacker() ? self.lastAttacker().id : "none");');
  for(const [id,result] of [['e2','e2'],['e3','e3'],['e1','none'],['dead','none']]){
   const w={...world,sight:'player' as const,units:{e1:{...world.units.e1,lastAttackedTick:4,lastAttacker:id}}};
   expect(h.run(w,['e1']).e1.log).toBe(result);
  }
  // Older rules: only within the unit's own vision.
  expect(h.run({...world,sight:'unit',units:{e1:{...world.units.e1,lastAttackedTick:4,lastAttacker:'e3'}}},['e1']).e1.log).toBe('none');
 }finally{h.dispose();}
});
