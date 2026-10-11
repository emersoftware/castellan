import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAPS } from "@aoa/shared";
import { buildServer } from "../src/app";

it("advertises solid terrain and creates only four competing players", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aoa-neutral-"));
  const app = await buildServer({ replayDir: dir, prepMs: 0 });
  try {
    const maps = (await app.inject({ method: "GET", url: "/maps" })).json();
    expect(maps.find((m: { name: string }) => m.name === "quad-crossroads")).toMatchObject({
      players: 4, walls: MAPS["quad-crossroads"].walls, wallStyle: "wall",
    });
    const response = await app.inject({ method: "POST", url: "/rooms", payload: {
      map: "quad-crossroads", mode: "ffa", sides: "fixed", seed: 419,
      players: ["One", "Two", "Three", "Four"].map(name => ({ name })),
    } });
    expect(response.statusCode).toBe(200);
    const room = response.json();
    expect(room.players).toHaveLength(4);
    const view = (await app.inject({ method: "GET", url: "/state", headers: { authorization: `Bearer ${room.players[0].token}` } })).json();
    expect(view.players).toHaveLength(4);
    expect(view.grid).toHaveLength(44);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
