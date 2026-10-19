import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "@castellan/server";
import { rules } from "@castellan/shared";
import { Runtime } from "../src/runtime";

let app: Awaited<ReturnType<typeof buildServer>>;
let url = "";
beforeAll(async () => {
  app = await buildServer({ replayDir: mkdtempSync(join(tmpdir(), "castellan-castellan-")), ruleset: { ...rules, matchMs: 40_000 }, tickRate: 10, prepMs: 1000 });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(() => app.close());

describe("castellan runtime", () => {
  it("plays a short real-time match against a bot through the HTTP API and writes a journal", async () => {
    const room = await fetch(`${url}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ players: [{ name: "castellan" }, { bot: "rush" }] }) }).then((r) => r.json()) as { id: string; players: { token?: string }[] };
    const token = room.players[0].token!;
    const logDir = mkdtempSync(join(tmpdir(), "castellan-log-"));
    const lines: string[] = [];
    const rt = new Runtime({ server: url, token, logDir, name: "test", echo: (l) => lines.push(l), waitS: 1 });
    const outcome = await rt.run();
    expect(outcome).toBeDefined();
    expect(rt.core.stats.cycles).toBeGreaterThan(20);
    expect(rt.core.stats.ordersSent).toBeGreaterThan(5);
    const journal = readFileSync(join(logDir, "test.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(journal.some((e) => e.type === "runtime")).toBe(true);
    expect(journal.some((e) => e.type === "init")).toBe(true);
    expect(journal.at(-1)?.type).toBe("match_end");
    expect(existsSync(join(logDir, "test.md"))).toBe(true);
    const summary = readFileSync(join(logDir, "test.md"), "utf8");
    expect(summary).toContain("Outcome:");
    expect(rt.core.world?.view.status).toBe("finished");
    // The player only used its own token: it never asked for spectator data or the opponent's scripts.
    expect(lines.some((l) => l.startsWith("castellan-bot:"))).toBe(true);
  }, 120_000);

  it("rejects a bad token at once", async () => {
    const rt = new Runtime({ server: url, token: "nope", logDir: mkdtempSync(join(tmpdir(), "castellan-log-")), echo: () => {} });
    await expect(rt.run()).rejects.toThrow(/401/);
  });
});
