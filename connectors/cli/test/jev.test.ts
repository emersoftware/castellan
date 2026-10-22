import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error Plain Node launcher shared with external harnesses.
import { play } from "../../loop-keepers/jev/agent.mjs";
import { startServer } from "./server";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("gives the planner the player's directive and reads each observation from its own cursor", async () => {
  const srv = await startServer();
  const home = await mkdtemp(join(tmpdir(), "castellan-jev-home-"));
  vi.stubEnv("HOME", home);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const created = await fetch(`${srv.url}/rooms`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ players: [{ name: "jev" }, { bot: "eco" }] }) });
    const token = (await created.json()).players[0].token;
    const systems: string[] = [], reads: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/chat/completions")) {
        systems.push(JSON.parse(String(init!.body)).messages[0].content);
        return Response.json({ choices: [{ message: { content: JSON.stringify({ objective: "scout", targets: {} }) } }], usage: { cost: 0 } });
      }
      if (url.endsWith("/alpha/decisions")) return Response.json({ answers: { action: { choice: "a0" } }, usage: { cost: 0 } });
      if (new URL(url).pathname === "/state") reads.push(url);
      return fetch(url, init);
    };
    const code = await play({ env: { CASTELLAN_TOKEN: token, CASTELLAN_SERVER: srv.url, OPENROUTER_API_KEY: "test", CASTELLAN_DIRECTIVE: "TOWER RUSH" },
      args: ["--interval", "0"], fetchImpl });
    expect(code).toBe(0);
    expect.soft(systems[0]).toContain("TOWER RUSH");
    expect(reads.length).toBeGreaterThan(2);
    expect.soft(reads.filter((url) => new URL(url).searchParams.get("since") === null)).toEqual([]);
  } finally {
    await srv.close();
    await rm(home, { recursive: true, force: true });
  }
}, 30_000);
