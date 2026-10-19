import { expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rules } from "@castellan/shared";
import { buildServer } from "../src/app";

it("serves consistent castle/door rules and default maps for duels and FFA", async () => {
  const app = await buildServer({ replayDir: await mkdtemp(join(tmpdir(), "castellan-doors-")), prepMs: 0 });
  try {
    const { ruleset, guide } = (await app.inject({ method: "GET", url: "/rules" })).json();
    expect(ruleset.version).toBe(rules.version);
    expect(ruleset.kinds.worker.builds).toEqual(["tower", "wall", "door", "castle"]);
    expect(JSON.stringify({ruleset,guide})).not.toMatch(/nexus/i);
    for (const map of ["open","quad","fortress","fortress-quad"]) {
      const room = (await app.inject({method:"POST",url:"/rooms",payload:{map,...(map.endsWith("quad")?{mode:"ffa"}:{}),players:[{name:"A"},{name:"B"}]}})).json();
      expect(room.players).toHaveLength(map.endsWith("quad") ? 4 : 2);
      for(const p of room.players) {
        const state=(await app.inject({method:"GET",url:"/state",headers:{authorization:`Bearer ${p.token}`}})).json();
        expect(state.mine.filter((e:{kind:string})=>e.kind==="castle")).toHaveLength(1);
        expect(state.mine.filter((e:{kind:string})=>e.kind==="king")).toHaveLength(1);
        expect(state.mine.some((e:{kind:string})=>e.kind==="agent"||e.kind==="nexus")).toBe(false);
      }
    }
  } finally {await app.close();}
});

it("plays another version's stats only when the server allows it (experiments)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "castellan-stats-"));
  const app = await buildServer({ replayDir: dir });
  try {
    const stats = { label: "old", kinds: { knight: { hp: 80, def: 4, atk: 12, range: 1, vision: 4, moveMs: 400, attackMs: 1000, cost: 100 } }, upgrades: {} };
    delete process.env.CASTELLAN_CUSTOM_STATS;
    expect((await app.inject({ method: "POST", url: "/rooms", payload: { stats } })).statusCode).toBe(400);
    process.env.CASTELLAN_CUSTOM_STATS = "1";
    const room = (await app.inject({ method: "POST", url: "/rooms", payload: { stats } })).json();
    const token = room.players[0].token;
    const r = (await app.inject({ method: "GET", url: "/rules", headers: { authorization: `Bearer ${token}` } })).json();
    expect(r.ruleset.version).toBe(`${rules.version}+stats:old`);
    expect(r.ruleset.kinds.knight).toMatchObject({ hp: 80, def: 4, symbol: "K", scriptable: true });
    expect(r.ruleset.kinds.knight.aimMs).toBeUndefined();
    expect(r.ruleset.upgrades).toEqual({});
  } finally { delete process.env.CASTELLAN_CUSTOM_STATS; await app.close(); }
});
