import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { client, newRoom } from "../src/index";
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
  it("serves the game over stdio", async () => {
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["act", "chat", "rules", "script", "state", "wait"]);

    const s = await mcp.callTool({ name: "state", arguments: {} });
    expect(s.isError).toBeFalsy();
    expect(text(s)).toContain("map");

    expect(text(await mcp.callTool({ name: "script", arguments: { kind: "knight" } }))).toContain("// knight: default");
    const bad = await mcp.callTool({ name: "script", arguments: { kind: "knight", code: "self.hold(" } });
    expect(bad.isError).toBe(true);
  });
});
