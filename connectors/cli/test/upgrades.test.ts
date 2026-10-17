import { expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServer } from "@aoa/server";
import { rules } from "@aoa/shared";
import { waitForStatus } from "../../../packages/server/test/support/readiness";

it("researches through the real MCP schema, reports mineral and persists pending research across a server restart", async () => {
  const replayDir = await mkdtemp(join(tmpdir(), "aoa-upgrade-api-"));
  const ruleset = { ...rules, matchMs: 15_000, upgrades: {
    worker_damage: { ...rules.upgrades!.worker_damage, levels: [{ cost: 150, researchMs: 3000, value: 5 }] },
  } };
  let app = await buildServer({ replayDir, ruleset, prepMs: 0 });
  const mcp = new Client({ name: "upgrade-test", version: "0" });
  try {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const server = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    const series = (await app.inject({ method: "POST", url: "/series", payload: { prepMs: 0 } })).json();
    const current = await Promise.all(series.players.map(async (p: { token: string }) =>
      (await app.inject({ url: "/series/current", headers: { authorization: `Bearer ${p.token}` } })).json()));
    const tokens = current.map((c) => c.game.token);
    const headers = tokens.map((token: string) => ({ authorization: `Bearer ${token}` }));
    await mcp.connect(new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL("../../mcp/bin/aoa-mcp.mjs", import.meta.url))],
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", AOA_SERVER: server, AOA_TOKEN: tokens[0] },
    }));
    const guide = await mcp.callTool({ name: "guide", arguments: {} });
    expect(JSON.stringify(guide.content)).toContain("worker_damage");
    await app.inject({ url: "/state", headers: headers[1] });
    await app.inject({ url: "/state", headers: headers[0] });
    await waitForStatus(app, tokens[0]);
    const answer = await mcp.callTool({ name: "act", arguments: { orders: [{ type: "upgrade", upgrade: "worker_damage" }] } });
    expect(answer.isError, JSON.stringify(answer.content)).toBeFalsy();
    expect(JSON.stringify(answer.content)).toContain("mineral spent 150, remaining 50");
    expect(JSON.stringify(answer.content)).toContain("researching worker_damage L1");
    await mcp.close();
    await app.close();
    app = await buildServer({ replayDir, ruleset, prepMs: 0 });
    const restored = (await app.inject({ url: "/state", headers: headers[0] })).json();
    expect(restored.players[0].research.upgrade).toBe("worker_damage");
    expect(restored.players[0].mineral).toBe(50);
    await app.inject({ url: "/state", headers: headers[1] });
    const completed = (await app.inject({ url: "/wait?max=5&until=upgrade_completed", headers: headers[0] })).json();
    expect(completed.players[0].upgrades).toEqual({ worker_damage: 1 });
    expect(completed.mine.filter((e: { kind: string }) => e.kind === "worker").every((e: { stats: { atk: number } }) => e.stats.atk === 5)).toBe(true);
  } finally { await mcp.close(); await app.close(); await rm(replayDir, { recursive: true, force: true }); }
}, 15_000);
