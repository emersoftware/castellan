import { beforeAll, describe, expect, it } from "vitest";
import { createScriptHost, initSandbox, validateScript, type ScriptWorld } from "../src";
import { v0 } from "@aoa/shared";

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
    const h = createScriptHost(v0.script, 1);
    expect(h.setScript("knight", v0.defaultScripts.knight)).toEqual({ ok: true });
    expect(h.run(world, ["e1"]).e1.action).toEqual({ a: "attack", id: "e2" });
    h.dispose();
  });

  it("reports syntax errors", () => {
    expect(validateScript("self.hold(", v0.script).ok).toBe(false);
  });

  it("stops infinite loops with gas and keeps working", () => {
    const h = createScriptHost(v0.script, 1);
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
      const h = createScriptHost(v0.script, seed);
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
    const h = createScriptHost(v0.script, 1);
    h.setScript("knight", "self.log([typeof Date, typeof require, typeof process, typeof fetch, typeof setTimeout].join(','));");
    expect(h.run(world, ["e1"]).e1.log).toBe("undefined,undefined,undefined,undefined,undefined");
    h.dispose();
  });

  it("caps memory and heap", () => {
    const h = createScriptHost(v0.script, 1);
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
 const h=createScriptHost(v0.script,1);
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
it('only returns a living visible hostile attacker and leaves legacy APIs unchanged',()=>{
 const h=createScriptHost(v0.script,1);
 try {
  h.setScript('knight','self.log(typeof self.lastAttacker);');expect(h.run(world,['e1']).e1.log).toBe('undefined');
  h.setScript('knight','self.log(self.lastAttacker() ? self.lastAttacker().id : "none");');
  for(const [id,result] of [['e2','e2'],['e3','none'],['e1','none'],['dead','none']]){
   const w={...world,units:{e1:{...world.units.e1,lastAttackedTick:4,lastAttacker:id}}};
   expect(h.run(w,['e1']).e1.log).toBe(result);
  }
 }finally{h.dispose();}
});
