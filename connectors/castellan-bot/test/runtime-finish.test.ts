import { expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMatch } from "@castellan/engine";
import { rules, routes } from "@castellan/shared";
import { Runtime } from "../src/runtime";

it("returns and journals the final view when the match ends in the act response", async () => {
  const match = await createMatch({ ruleset: { ...rules, matchMs: 100 },
    players: [{ id: "a", name: "one" }, { id: "b", name: "two" }], seed: 1, tickRate: 10 });
  const logDir = mkdtempSync(join(tmpdir(), "castellan-act-end-"));
  try {
    const running = match.view("a");
    match.step([]);
    const finished = match.view("a");
    expect(finished.status).toBe("finished");
    expect(finished.outcome).toBeDefined();
    const runtime = new Runtime({ token: "local-fixture", logDir, name: "test", echo: () => {} });
    const get = vi.spyOn(runtime.client, "get")
      .mockRejectedValue(new Error("401 unexpected extra request"))
      .mockResolvedValueOnce({ room: "fixture", player: "a", status: "running" })
      .mockResolvedValueOnce({ ruleset: match.ruleset })
      .mockResolvedValueOnce(running);
    const post = vi.spyOn(runtime.client, "post").mockResolvedValue({ results: [], view: finished });
    const outcome = await runtime.run();
    expect(post).toHaveBeenCalledWith(routes.act, { orders: expect.any(Array) });
    expect(get).toHaveBeenCalledTimes(3);
    expect(outcome).toEqual(finished.outcome);
    expect(runtime.core.world?.view).toEqual(finished);
    const journal = readFileSync(join(logDir, "test.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(journal.at(-1)).toMatchObject({ type: "match_end", tick: finished.tick, outcome: finished.outcome });
  } finally {
    match.dispose();
    rmSync(logDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  }
});
