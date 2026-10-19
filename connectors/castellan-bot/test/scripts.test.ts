import { describe, expect, it } from "vitest";
import { SCRIPT_MAX_BYTES, kingScript, knightScript, archerScript, workerScript, STATIC_SCRIPT, type ArmyParams } from "../src/scripts";

describe("unit scripts", () => {
  it("stay under the size limit with a full army and worker roster", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `e${100 + i}`);
    const p: ArmyParams = { role: "g", roles: Object.fromEntries(ids.map((id, i) => [id, i % 2 ? "a" : "h"])), rally: { x: 25, y: 25 }, target: { x: 4, y: 4 }, gp: { x: 23, y: 21 },
      posts: Object.fromEntries(ids.map((id, i) => [id, { x: 20 + i, y: 21 }])), leash: 7, engage: 8, wps: [{ x: 16, y: 16 }, { x: 23, y: 23 }, { x: 30, y: 30 }], kite: true };
    expect(knightScript(p).length).toBeLessThan(SCRIPT_MAX_BYTES);
    expect(archerScript(p).length).toBeLessThan(SCRIPT_MAX_BYTES);
    const workers = Array.from({ length: 16 }, (_, i) => `e${200 + i}`);
    const w = workerScript({ safe: { x: 1, y: 1 }, assign: Object.fromEntries(workers.map((id, i) => [id, `d${10 + i}`])), evac: Object.fromEntries(workers.map((id, i) => [id, { x: i % 4, y: (i / 4) | 0 }])), fleeRadius: 5, fleeTicks: 15 });
    expect(w.length).toBeLessThan(SCRIPT_MAX_BYTES);
    expect(kingScript({ safe: { x: 1, y: 1 } }).length).toBeLessThan(600);
    expect(STATIC_SCRIPT.length).toBeLessThan(600);
  });

  it("are valid function bodies", () => {
    const p: ArmyParams = { role: "g", roles: {}, rally: { x: 6, y: 6 }, target: null, gp: null, posts: {}, leash: 6, engage: 8, wps: [], kite: true };
    for (const code of [knightScript(p), archerScript(p), workerScript({ safe: { x: 1, y: 1 }, assign: {}, evac: {}, fleeRadius: 5, fleeTicks: 15 }), kingScript({ safe: { x: 1, y: 1 } }), STATIC_SCRIPT]) {
      expect(() => new Function("self", code)).not.toThrow();
    }
  });
});
