import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chat, client, newRoom, state, wait } from "../src/index";
import { startServer } from "./server";

let srv: Awaited<ReturnType<typeof startServer>>;
let mcp: Client;
const bin = fileURLToPath(new URL("../../mcp/bin/aoa-mcp.mjs", import.meta.url));
const text = (r: Awaited<ReturnType<Client["callTool"]>>) => (r.content as { text: string }[])[0].text;

beforeAll(async () => {
  srv = await startServer();
  const room = JSON.parse(await newRoom(client({ server: srv.url }), { json: true }));
  mcp = new Client({ name: "test", version: "0" });
  const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", AOA_SERVER: srv.url, AOA_TOKEN: room.players[0].token };
  await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [bin], env }));
});
afterAll(async () => {
  await mcp?.close();
  await srv.app.close();
});

describe("aoa-mcp", () => {
  it("forwards a direct recipient and exposes direct-message rules in FFA", async () => {
    const room = JSON.parse(await newRoom(client({ server: srv.url }), { json: true, map: "quad", mode: "ffa", chat: true }));
    const clients = room.players.map((p: { token: string }) => client({ server: srv.url, token: p.token }));
    const dmMcp = new Client({ name: "dm-test", version: "0" });
    try {
      await dmMcp.connect(new StdioClientTransport({ command: process.execPath, args: [bin], env: {
        PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", AOA_SERVER: srv.url, AOA_TOKEN: room.players[0].token,
      } }));
      expect(text(await dmMcp.callTool({ name: "rules", arguments: {} }))).toContain("four-player free-for-all");
      for (const c of clients) await state(c);
      await wait(clients[0], { seconds: 2 });
      const sent = await dmMcp.callTool({ name: "chat", arguments: { text: "MCP direct plan", to: "p3" } });
      expect(sent.isError).toBeFalsy();
      expect(text(sent)).toContain("[private to p3]");
      expect(await chat(clients[2])).toContain("MCP direct plan");
      expect(await chat(clients[1])).not.toContain("MCP direct plan");
      expect(await chat(clients[3])).not.toContain("MCP direct plan");
      // Repeated reads are independent; chat stays in its own preview.
      await dmMcp.callTool({ name: "state", arguments: {} });
      const next = text(await dmMcp.callTool({ name: "state", arguments: {} }));
      expect(next).toContain("chat (last 5 visible messages):");
      expect(next).toContain("Use chat without text to read the full visible history.");
      expect(next.match(/MCP direct plan/g)).toHaveLength(1);
      expect(next).toContain("[private to p3]");
      const last = JSON.parse(await state(clients[2], { json: true }));
      const recipient = JSON.parse(await state(clients[2], { json: true, since: last.tick }));
      expect(recipient.events.some((e: { type: string }) => e.type === "chat")).toBe(false);
      expect(recipient.chat).toEqual({ enabled: true, messages: [expect.objectContaining({ from: "p1", to: "p3", text: "MCP direct plan" })] });
      expect(await wait(clients[2], { seconds: 0 })).toContain("MCP direct plan");
      for (const other of [clients[1], clients[3]]) {
        expect(await state(other)).not.toContain("MCP direct plan");
        expect(JSON.parse(await state(other, { json: true })).chat).toEqual({ enabled: true, messages: [] });
      }
    } finally {
      await dmMcp.close();
    }
  });

  it("exposes and forwards the private team channel", async () => {
    const room = JSON.parse(await newRoom(client({ server: srv.url }), { json: true, names: ["a", "b", "c", "d"], map: "quad", chat: true }));
    const clients = room.players.map((p: { token: string }) => client({ server: srv.url, token: p.token }));
    const teamMcp = new Client({ name: "team-test", version: "0" });
    try {
      await teamMcp.connect(new StdioClientTransport({ command: process.execPath, args: [bin], env: {
        PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", AOA_SERVER: srv.url, AOA_TOKEN: room.players[0].token,
      } }));
      for (const c of clients) await state(c);
      await wait(clients[0], { seconds: 2 });
      const sent = await teamMcp.callTool({ name: "chat", arguments: { text: "MCP private plan", channel: "team" } });
      expect(sent.isError).toBeFalsy();
      expect(text(sent)).toContain("[team]");
      expect(text(sent)).toContain("map (x→, y↓;");
      expect(await chat(clients[1])).toContain("MCP private plan");
      expect(await chat(clients[2])).not.toContain("MCP private plan");
      expect(text(await teamMcp.callTool({ name: "chat", arguments: {} }))).toContain("MCP private plan");
      await state(clients[1]);
      expect(await state(clients[1])).toContain("MCP private plan");
      expect(await state(clients[2])).not.toContain("MCP private plan");
      expect(await state(clients[3])).not.toContain("MCP private plan");
    } finally {
      await teamMcp.close();
    }
  });

  it("serves the game over stdio", async () => {
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["act", "chat", "history", "rules", "run", "script", "state", "wait"]);
    expect(JSON.parse(text(await mcp.callTool({ name: "history", arguments: {} })))).toEqual({ series: null, games: [] });

    const s = await mcp.callTool({ name: "state", arguments: {} });
    expect(s.isError).toBeFalsy();
    expect(text(s)).toContain("map");
    expect(text(s)).toContain("chat: off");

    expect(text(await mcp.callTool({ name: "script", arguments: { kind: "knight" } }))).toContain("// knight: default");
    const bad = await mcp.callTool({ name: "script", arguments: { kind: "knight", code: "self.hold(" } });
    expect(bad.isError).toBe(true);
  });
});
