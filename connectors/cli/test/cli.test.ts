import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlayerView } from "@aoa/shared";
import { ApiError, act, client, getScript, newRoom, putScript, rooms, run, state, status, wait, watch } from "../src/index";
import { startServer } from "./server";

let srv: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => void (srv = await startServer()));
afterAll(() => srv.app.close());

describe("aoa commands", () => {
  it("plays a match through the command functions", async () => {
    const lobby = client({ server: srv.url });
    expect(await newRoom(lobby, { names: ["x"], bots: ["eco"] })).toMatch(/^room \w+ \(waiting\) · map open\n.*corner\].*AOA_TOKEN=\w+\n.*\(bot eco\)\nwatch http/);
    const room = JSON.parse(await newRoom(lobby, { json: true, names: ["alice", "bob"], seed: 5 }));
    const [c1, c2] = room.players.map((p: { token: string }) => client({ server: srv.url, token: p.token }));
    expect(await rooms(lobby)).toContain(`${room.id} waiting`);

    expect(await status(c1)).toBe("waiting");
    const ts = "const e: any = self.nearestEnemy(); if (e) self.attack(e); else self.hold();";
    await expect(putScript(c1, "knight", ts, { lang: "ts" })).rejects.toThrow(ApiError); // not before the start

    await status(c2); // both connected → prep (0 ms) → running
    const view = JSON.parse(await wait(c1, { json: true, seconds: 2, since: 0 })) as PlayerView;
    expect(view.status).toBe("running");
    expect(await putScript(c1, "knight", ts, { lang: "ts" })).toMatch(/uploaded, applied at tick \d+\n\ntick \d+ ·/);
    await expect(putScript(c1, "knight", "self.hold(")).rejects.toThrow(ApiError);
    expect(await getScript(c1, "knight")).toContain("self.nearestEnemy()");
    expect(await state(c1)).toContain("map (x→, y↓;");

    const nexus = view.mine.find((e) => e.kind === "nexus")!;
    const out = await act(c1, [{ type: "train", building: nexus.id, kind: "knight" }, { type: "move", unit: "zzz", x: 1, y: 1 }]);
    expect(out).toMatch(/order 0: ok[\s\S]*order 1: FAILED/);

    // The agent keeps exiting at once while the match runs: the keeper gives up.
    const log: string[] = [];
    expect(await run(c1, [process.execPath, "-e", ""], { fastMs: 60_000, maxFastFailures: 2, backoffMs: 10, log: (l) => log.push(l) })).toBe(1);
    expect(log.join("\n")).toContain("relaunching with AOA_RESUME=1");

    const lines: string[] = [];
    const outcome = await watch(c2, (l) => lines.push(l));
    expect(outcome).toBeDefined();
    expect(lines.some((l) => l.endsWith("status finished"))).toBe(true);
    expect(lines.at(-1)).toMatch(/match_end/);
    expect(await status(c1)).toBe("finished");
    expect(await run(c1, [process.execPath, "-e", ""], { log: () => {} })).toBe(0);
  });

  it("reports API errors", async () => {
    const bad = client({ server: srv.url, token: "nope" });
    await expect(state(bad)).rejects.toMatchObject({ status: 401 });
    expect(await run(bad, [process.execPath, "-e", ""], { log: () => {} })).toBe(1);
  });
});
