import { expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/app";

it("serves consistent castle/door rules and default maps for duels and FFA", async () => {
  const app = await buildServer({ replayDir: await mkdtemp(join(tmpdir(), "aoa-doors-")), prepMs: 0 });
  try {
    const { ruleset, guide } = (await app.inject({ method: "GET", url: "/rules" })).json();
    expect(ruleset.version).toBe("v10-ruins");
    expect(ruleset.kinds.worker.builds).toEqual(["turret", "wall", "door", "castle"]);
    expect(JSON.stringify({ruleset,guide})).not.toMatch(/nexus/i);
    for (const map of ["open","quad","fortress","fortress-quad"]) {
      const room = (await app.inject({method:"POST",url:"/rooms",payload:{map,...(map.endsWith("quad")?{mode:"ffa"}:{}),players:[{name:"A"},{name:"B"}]}})).json();
      for(const p of room.players) {
        const state=(await app.inject({method:"GET",url:"/state",headers:{authorization:`Bearer ${p.token}`}})).json();
        expect(state.mine.filter((e:{kind:string})=>e.kind==="castle")).toHaveLength(1);
        expect(state.mine.filter((e:{kind:string})=>e.kind==="king")).toHaveLength(1);
        expect(state.mine.some((e:{kind:string})=>e.kind==="agent")).toBe(false);
        expect(state.mine.some((e:{kind:string})=>e.kind==="nexus")).toBe(false);
      }
    }
  } finally {await app.close();}
});
