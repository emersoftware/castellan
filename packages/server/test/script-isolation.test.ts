import { afterEach, expect, it, vi } from "vitest";
import { rules } from "@castellan/shared";
import { RUN_LIMITS, type ScriptWorld } from "@castellan/sandbox";
import { createMatch, type MatchConfig } from "@castellan/engine";
import { createIsolatedScriptHost, runOnceIsolated, validateScriptIsolated, waitForStateChange } from "../src/script-isolation";

it("accepts a completed response when the parent resumes after a timed-out wait", () => {
  const header = new Int32Array(new SharedArrayBuffer(16));
  Atomics.store(header, 0, 2);
  const wait = vi.spyOn(Atomics, "wait").mockImplementationOnce(() => {
    // Worker publishes after the wait deadline, before the parent is scheduled.
    Atomics.store(header, 0, 3);
    return "timed-out";
  });
  try { expect(waitForStateChange(header, 2, 250)).toBe(true); }
  finally { wait.mockRestore(); }
  Atomics.store(header, 0, 2);
  expect(waitForStateChange(header, 2, 0)).toBe(false);
});

const live: { dispose(): void }[] = [];
afterEach(() => live.splice(0).forEach(h => h.dispose()));
const world: ScriptWorld = {
  tick: 0, side: 0, myBase: null, enemyBase: null,
  units: { e1: { id: "e1", type: "king", x: 0, y: 0, hp: 400, maxHp: 400, atk: 3, def: 2, range: 1, vision: 6 } },
  all: [["e1", "king", "a", 1, 0, 0, 400, 400, 0, 0]],
};
const host = (timeoutMs = 250, gas = rules.script.gasPerUnit) => {
  const h = createIsolatedScriptHost({ ...rules.script, gasPerUnit: gas, gasPerPlayer: Math.max(gas * 2, rules.script.gasPerPlayer) }, 42,
    { timeoutMs, startupTimeoutMs: 10000 });
  live.push(h); return h;
};

it("loads the bundled sandbox inside the Node worker and retains independent memory across bounded calls", () => {
  const a = host(), b = host();
  for (const h of [a, b]) expect(h.setScript("king", "self.memory.n=(self.memory.n||0)+1; self.log(self.memory.n); self.move('E');")).toEqual({ ok: true });
  expect(a.run(world, ["e1"]).e1).toMatchObject({ action: { a: "move", dir: "E" }, log: "1" });
  expect(a.run(world, ["e1"]).e1.log).toBe("2");
  expect(b.run(world, ["e1"]).e1.log).toBe("1");
  expect(a.setScript("king", "self.hold(").ok).toBe(false);
  expect(a.run(world, ["e1"]).e1.log).toBe("3");
  expect(a.setScript("king", null)).toEqual({ ok: true });
  expect(a.hasScript("king")).toBe(false);
  a.dispose();
  expect(a.run(world, ["e1"]).e1.error).toBe("sandbox disposed");
});

it("terminates finite excessive work outside the VM and keeps the other player operational", () => {
  // Finite payload and a deliberately huge gas allowance exercise the outer
  // watchdog, not QuickJS's interrupt handler. The next call must not silently
  // create a fresh VM or resurrect the timed-out script.
  const slow = host(40, 1_000_000_000), healthy = host();
  expect(slow.setScript("king", "let n=0; for(let i=0;i<100000000;i++) n+=i; self.log(n);")).toEqual({ ok: true });
  healthy.setScript("king", "self.move('N');");
  const start = performance.now();
  const result = slow.run(world, ["e1"]).e1;
  expect(performance.now() - start).toBeLessThan(1000);
  expect(result).toMatchObject({ action: { a: "hold" }, error: expect.stringContaining("watchdog timeout"), operationalFailure: true });
  expect(slow.run(world, ["e1"]).e1.error).toBe(result.error);
  expect(healthy.run(world, ["e1"]).e1.action).toEqual({ a: "move", dir: "N" });
});

it("rejects oversized IPC requests safely and keeps the VM usable", () => {
  const h = host();
  expect(h.setScript("king", "x".repeat(2 * 1024 * 1024))).toEqual({ ok: false, error: "sandbox request exceeds transport limit" });
  expect(h.setScript("king", "self.hold();")).toEqual({ ok: true });
  expect(h.run(world, ["e1"]).e1.error).toBeUndefined();
});

it("uses the factory for live scripts and isolated probes without changing deterministic results", async () => {
  const cfg: MatchConfig = { ruleset: { ...rules, map: { ...rules.map, width: 12, height: 12, walls: [], deposits: [], sharedDeposits: [], start: [{ kind: "king", x: 0, y: 0 }] } },
    players: [{ id: "a", name: "A" }, { id: "b", name: "B" }], seed: 42, tickRate: 10 };
  let created = 0;
  const isolated = await createMatch({ ...cfg, scriptHostFactory: (limits, seed) => { created++; return createIsolatedScriptHost(limits, seed); } });
  const inline = await createMatch(cfg);
  live.push(isolated, inline);
  const input = [{ player: "a", order: { type: "script" as const, kind: "king", code: "self.memory.n=(self.memory.n||0)+1; self.log(self.memory.n); self.move('E');" } }];
  expect(isolated.step(input)).toEqual(inline.step(input));
  expect(isolated.testScript("a", "king", "self.hold();").ok).toBe(true);
  expect(created).toBe(3);
  for (let i = 0; i < 10; i++) expect(isolated.step([])).toEqual(inline.step([]));
  expect(isolated.hash()).toBe(inline.hash());
});

it("supervises one-shot execution and validation, returning no orders on timeout", async () => {
  expect(await validateScriptIsolated("self.hold();", rules.script)).toEqual({ ok: true });
  expect((await validateScriptIsolated("self.hold(", rules.script)).ok).toBe(false);
  expect(await runOnceIsolated("act({type:'stop',unit:'e1'}); return view.tick;", { view: { tick: 7 }, rules: {} }))
    .toMatchObject({ orders: [{ type: "stop", unit: "e1" }], value: 7 });
  const timeout = await runOnceIsolated("act({type:'stop',unit:'e1'}); let n=0; for(let i=0;i<100000000;i++) n+=i; return n;", { view: {}, rules: {} },
    { ...RUN_LIMITS, gas: 1_000_000_000 }, { timeoutMs: 40, startupTimeoutMs: 10000 });
  expect(timeout).toMatchObject({ orders: [], logs: [], value: null, error: expect.stringContaining("watchdog timeout"), operationalFailure: true });
  // A crafted wrapper escape can execute during the compile check. Even that
  // stage belongs inside the worker rather than the server's event loop.
  const validation = await validateScriptIsolated("}); let n=0; for(let i=0;i<100000000;i++) n+=i; (function(self){", {
    ...rules.script, gasPerUnit: 1_000_000_000, gasPerPlayer: 1_000_000_000,
  }, { timeoutMs: 40, startupTimeoutMs: 10000 });
  expect(validation).toMatchObject({ ok: false, error: expect.stringContaining("watchdog timeout") });
});

it("does not trust a script's forged operational error message", async () => {
  const h = host();
  h.setScript("king", "throw new Error('sandbox watchdog timeout after 250ms; player VM terminated');");
  const result = h.run(world, ["e1"]).e1;
  expect(result.error).toContain("sandbox watchdog");
  expect(result.operationalFailure).toBeUndefined();
  const once = await runOnceIsolated("throw new Error('sandbox worker failed');", { view: {}, rules: {} });
  expect(once.error).toBe("sandbox worker failed");
  expect(once.operationalFailure).toBeUndefined();
});

it("rejects a failed worker startup and disposes players already initialized by the match", async () => {
  const first = host();
  let started = 0;
  await expect(createMatch({ ruleset: rules, players: [{ id: "a", name: "A" }, { id: "b", name: "B" }], seed: 1, tickRate: 10,
    scriptHostFactory: () => { if (started++) throw new Error("worker start failed"); return first; },
  })).rejects.toThrow("worker start failed");
  expect(first.run(world, ["e1"]).e1.error).toBe("sandbox disposed");
  expect(() => createIsolatedScriptHost(rules.script, 1, { timeoutMs: 250, startupTimeoutMs: 0 })).toThrow("startup timed out");
});
