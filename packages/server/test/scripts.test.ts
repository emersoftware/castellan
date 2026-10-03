import { expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rules } from "@aoa/shared";
import { buildServer } from "../src/app";

it("lists the script every player's scriptable kinds run in a live room", async () => {
  const app = await buildServer({ replayDir: await mkdtemp(join(tmpdir(), "aoa-scripts-")), prepMs: 0 });
  try {
    const room = (await app.inject({ method: "POST", url: "/rooms", payload: { players: [{ name: "A" }, { name: "B" }] } })).json();
    const [a] = room.players;
    for (const p of room.players) await app.inject({ url: "/state", headers: { authorization: `Bearer ${p.token}` } });
    let put;
    for (let i = 0; i < 50; i++) {
      put = await app.inject({ method: "PUT", url: "/scripts/knight", headers: { authorization: `Bearer ${a.token}` }, payload: { code: "self.hold(); // mine" } });
      if (put.statusCode === 200) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(put!.statusCode).toBe(200);
    const scripts = (await app.inject({ url: `/rooms/${room.id}/scripts` })).json();
    expect(scripts[a.id].knight).toEqual({ code: "self.hold(); // mine", custom: true });
    expect(scripts.p2.knight).toEqual({ code: rules.defaultScripts.knight, custom: false });
    expect(scripts.p2.wall).toBeUndefined();
    expect((await app.inject({ url: "/rooms/nope/scripts" })).statusCode).toBe(404);
  } finally { await app.close(); }
});
