import { afterEach, expect, it } from "vitest";
import { rules, type Ruleset } from "@aoa/shared";
import { createMatch, type Match } from "../src";
import { createScriptHost, type UnitRun } from "@aoa/sandbox";

const live: Match[] = [];
afterEach(() => live.splice(0).forEach(m => m.dispose()));
async function setup(patch: Partial<Ruleset> = {}) {
  const ruleset: Ruleset = { ...rules, matchMs: 60000,
    map: { ...rules.map, width: 12, height: 12, walls: [], deposits: [], sharedDeposits: [], start: [{ kind: "king", x: 0, y: 0 }] },
    defaultScripts: { ...rules.defaultScripts, king: "self.hold();", archer: "self.hold();" }, ...patch };
  const m = await createMatch({ ruleset, players: [{ id: "a", name: "A" }, { id: "b", name: "B" }], seed: 42, tickRate: 10 });
  live.push(m);
  return m;
}
const logged = (result: ReturnType<Match["step"]>) => {
  const event = result.events.find(e => e.type === "log" && e.owner === "a");
  if (event?.type !== "log") throw new Error("missing script log");
  return JSON.parse(event.message);
};

it("distinguishes a blocked step, an actual move and movement cooldown on the following decision", async () => {
  const m = await setup();
  const code = `self.log(JSON.stringify([self.moveReadyInTicks,self.canMove('W'),self.canMove('E'),self.lastActionResult]));
    self.move(self.tick === 0 ? 'W' : 'E');`;
  expect(logged(m.step([{ player: "a", order: { type: "script", kind: "king", code } }]))).toEqual([0, false, true, null]);
  expect(logged(m.step([]))[3]).toMatchObject({ tick: 0, action: { a: "move", dir: "W" }, status: "blocked" });
  const afterMove = logged(m.step([]));
  expect(afterMove[0]).toBe(4);
  expect(afterMove[3]).toMatchObject({ tick: 1, status: "acted", effect: "move" });
  expect(logged(m.step([]))[3]).toMatchObject({ tick: 2, status: "cooldown", reason: "movement cooldown" });
  expect(m.view("a").mine[0]).toMatchObject({ x: 1, y: 0 });
});

it("reports aim and attack cooldown independently and exposes visible combat stats", async () => {
  const m = await setup({ map: { ...rules.map, width: 9, height: 9, walls: [], deposits: [], sharedDeposits: [],
    start: [{ kind: "king", x: 0, y: 0 }, { kind: "archer", x: 2, y: 4 }] } });
  const code = `const e=self.nearestEnemy();
    self.log(JSON.stringify([self.aimReadyInTicks,self.attackReadyInTicks,self.lastActionResult && self.lastActionResult.status,e.atk,e.def,e.range,e.ruin]));
    if(self.tick===0) self.move('S'); else self.attack(e);`;
  const enemy = m.view("b").mine.find(e => e.kind === "archer")!;
  expect(logged(m.step([{ player: "a", order: { type: "script", kind: "archer", code } }]))).toEqual([0, 0, null, enemy.stats!.atk, enemy.stats!.def, enemy.stats!.range, false]);
  expect(logged(m.step([])).slice(0, 3)).toEqual([3, 0, "acted"]);
  expect(logged(m.step([])).slice(0, 3)).toEqual([2, 0, "aiming"]);
  expect(logged(m.step([])).slice(0, 3)).toEqual([1, 0, "aiming"]);
  const fire = m.step([]);
  expect(fire.events.some(e => e.type === "attack" && e.from === m.view("a").mine.find(e => e.kind === "archer")!.id)).toBe(true);
  const next = logged(m.step([]));
  expect(next[0]).toBe(0);
  expect(next[1]).toBe(Math.round(rules.kinds.archer.attackMs! / 100) - 1);
  expect(next[2]).toBe("acted");
});

it("checks local terrain and corner crossings without revealing hidden occupancy", async () => {
  const m = await setup({ map: { ...rules.map, width: 12, height: 12, walls: [{ x: 1, y: 0 }, { x: 0, y: 1 }], deposits: [], sharedDeposits: [], start: [{ kind: "king", x: 0, y: 0 }] } });
  const probe = m.testScript("a", "king", "self.log(JSON.stringify([self.canMove('E'),self.canMove('SE'),self.canMove('bad')]));");
  expect(probe.ok && JSON.parse(Object.values(probe.frames[0].runs)[0].log!)).toEqual([false, false, false]);
  const hidden = await setup({ kinds: { ...rules.kinds, king: { ...rules.kinds.king, vision: 0 } } });
  const unseen = hidden.testScript("a", "king", "self.log(JSON.stringify([self.canMove('W'),self.canMove('E')]));");
  expect(unseen.ok && JSON.parse(Object.values(unseen.frames[0].runs)[0].log!)).toEqual([false, null]);
});

it("testing a proposed script preserves match state and the installed script's memory and random stream", async () => {
  const a = await setup(), b = await setup();
  const code = "self.memory.n=(self.memory.n||0)+1; self.log(JSON.stringify([self.memory.n,self.random()])); self.hold();";
  const upload = [{ player: "a", order: { type: "script" as const, kind: "king", code } }];
  expect(a.step(upload)).toEqual(b.step(upload));
  const before = a.hash();
  const probe = a.testScript("a", "king", "self.memory.n=999; self.random(); self.move('E');");
  expect(probe.ok).toBe(true);
  if (probe.ok) expect(Object.values(probe.frames[0].runs)[0]).toMatchObject({ action: { a: "move", dir: "E" }, gasUsed: expect.any(Number) });
  expect(a.testScript("a", "wall", "self.hold();")).toEqual({ ok: false, error: "wall is not scriptable" });
  expect(a.hash()).toBe(before);
  expect(a.scriptSource("a", "king")?.code).toBe(code);
  expect(a.step([])).toEqual(b.step([]));
  expect(a.hash()).toBe(b.hash());
});

it("propagates trusted host incidents once even if a previous script forged the same message", async () => {
  const message = "sandbox watchdog timeout after 250ms; player VM terminated";
  const m = await createMatch({ ruleset: { ...rules, map: { ...rules.map, start: [{ kind: "king", x: 0, y: 0 }] } },
    players: [{ id: "a", name: "A" }, { id: "b", name: "B" }], seed: 1, tickRate: 10,
    scriptHostFactory: (limits, seed) => {
      const host = createScriptHost(limits, seed);
      let calls = 0;
      return { ...host, run(_world, ids) {
        calls++;
        return Object.fromEntries(ids.map(id => [id, { action: { a: "hold" }, error: message,
          ...(calls >= 2 ? { operationalFailure: true } : {}) } as UnitRun]));
      } };
    },
  });
  live.push(m);
  const errors = () => m.step([]).events.filter(e => e.type === "script_error" && e.owner === "a");
  expect(errors()).toEqual([expect.objectContaining({ message })]);
  expect(errors()).toEqual([expect.objectContaining({ message, operationalFailure: true })]);
  expect(errors()).toEqual([]);
});
