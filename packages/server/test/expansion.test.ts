import { expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { v2, type PlayerView } from "@aoa/shared";
import { buildServer } from "../src/app";

it("restores an in-progress Nexus build and charges only once after completion", async () => {
  const replayDir = await mkdtemp(join(tmpdir(), "aoa-expansion-"));
  const ruleset = { ...v2, startCapital: 1200, matchMs: 15_000,
    map: { ...v2.map, deposits: [], sharedDeposits: [] },
    kinds: { ...v2.kinds, nexus: { ...v2.kinds.nexus, buildMs: 1000 } },
  };
  let app = await buildServer({ replayDir, ruleset, prepMs: 0 });
  try {
    const series = (await app.inject({ method: "POST", url: "/series", payload: { prepMs: 0, sides: "fixed", seed: 42 } })).json();
    const current = await Promise.all(series.players.map(async (p: { token: string }) =>
      (await app.inject({ url: "/series/current", headers: { authorization: `Bearer ${p.token}` } })).json()));
    const headers = current.map((c) => ({ authorization: `Bearer ${c.game.token}` }));
    await app.inject({ url: "/state", headers: headers[1] });
    let state: PlayerView;
    do {
      state = (await app.inject({ url: "/state", headers: headers[0] })).json();
      if (state.status !== "running") await new Promise((r) => setTimeout(r, 10));
    } while (state.status !== "running");
    const workers = state.mine.filter((e) => e.kind === "worker");
    const order = await app.inject({ method: "POST", url: "/act", headers: headers[0], payload: { orders: [
      ...workers.map((w) => ({ type: "stop", unit: w.id })),
      { type: "build", unit: workers[0].id, kind: "nexus", x: 7, y: 5 },
    ] } });
    expect(order.json().results.at(-1)).toMatchObject({ ok: true, capital: { spent: 0, remaining: 1200, pending: 600 } });
    expect(order.json().view.mine.find((e: { id: string }) => e.id === workers[0].id).construction).toBeDefined();
    await app.close();
    app = await buildServer({ replayDir, ruleset, prepMs: 0 });
    const restored = (await app.inject({ url: "/state", headers: headers[0] })).json();
    expect(restored.mine.find((e: { id: string }) => e.id === workers[0].id).construction).toBeDefined();
    expect(restored.players[0].capital).toBe(1200);
    await app.inject({ url: "/state", headers: headers[1] });
    const completed = (await app.inject({ url: "/wait?max=3&until=spawn", headers: headers[0] })).json();
    expect(completed.mine.filter((e: { kind: string }) => e.kind === "nexus")).toHaveLength(2);
    expect(completed.players[0].capital).toBe(600);
    expect(completed.mine.filter((e: { kind: string }) => e.kind === "nexus").every((e: { vital: boolean }) => !e.vital)).toBe(true);
  } finally { await app.close(); }
});
