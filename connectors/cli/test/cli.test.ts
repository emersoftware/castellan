import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlayerView } from "@aoa/shared";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { ApiError, act, chat, client, getScript, newRoom, putScript, rooms, rules, run, state, status, wait, watch } from "../src/index";
import { startServer } from "./server";

let srv: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => void (srv = await startServer()));
afterAll(() => srv.app.close());

describe("aoa commands", () => {
  it("creates FFA rooms and sends direct messages from the CLI without leaking over HTTP", async () => {
    const lobby = client({ server: srv.url });
    const bin = fileURLToPath(new URL("../bin/aoa.mjs", import.meta.url));
    const created = await promisify(execFile)(process.execPath, [bin, "new", "--map", "quad", "--mode", "ffa", "--chat", "--json"], {
      env: { ...process.env, AOA_SERVER: srv.url },
    });
    const room = JSON.parse(created.stdout);
    expect(room.mode).toBe("ffa");
    expect(new Set(room.players.map((p: { team: number }) => p.team)).size).toBe(4);
    const clients = room.players.map((p: { token: string }) => client({ server: srv.url, token: p.token }));
    const guide = await rules(clients[0]);
    expect(guide).toContain("four-player free-for-all");
    expect(guide).toContain('"to":"p2"');
    expect(guide).not.toContain("allied AI");
    for (const c of clients) await state(c);
    await wait(clients[0], { seconds: 2 });
    const { stdout } = await promisify(execFile)(process.execPath, [bin, "chat", "just for you", "--to", "p2"], {
      env: { ...process.env, AOA_SERVER: srv.url, AOA_TOKEN: room.players[0].token },
    });
    expect(stdout).toContain('p1 "player1" (you) [private to p2]: "just for you"');
    expect(await chat(clients[1])).toContain("[private to p2]: just for you");
    for (const c of clients.slice(2)) {
      expect(JSON.parse(await chat(c, undefined, { json: true })).messages).toEqual([]);
      expect(await state(c, { since: 0 })).not.toContain("just for you");
      expect(await wait(c, { seconds: 0, since: 0, until: "chat" })).not.toContain("just for you");
    }
    await act(clients[1], { type: "chat", to: "p1", text: "direct reply" });
    expect(await chat(clients[0])).toContain("direct reply");
    expect(await chat(clients[2])).not.toContain("direct reply");
    await expect(clients[2].post("/chat", { text: "bad", to: null })).rejects.toMatchObject({ status: 400 });
    await expect(lobby.post("/rooms", { map: "quad", mode: "ffa", players: [{ team: 0 }] })).rejects.toMatchObject({ status: 400 });
    await expect(lobby.post("/rooms", { map: "quad", mode: "typo" })).rejects.toMatchObject({ status: 400 });
  });

  it("sends private team chat through the CLI and filters history and views over HTTP", async () => {
    const room = JSON.parse(await newRoom(client({ server: srv.url }), { json: true, names: ["a", "b", "c", "d"], map: "quad", chat: true }));
    const clients = room.players.map((p: { token: string }) => client({ server: srv.url, token: p.token }));
    for (const c of clients) await state(c);
    await wait(clients[0], { seconds: 2 });
    const bin = fileURLToPath(new URL("../bin/aoa.mjs", import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, [bin, "chat", "secret plan", "--channel", "team"], {
      env: { ...process.env, AOA_SERVER: srv.url, AOA_TOKEN: room.players[0].token },
    });
    expect(stdout).toContain("message sent");
    expect(stdout).toContain('p1 "a" (you) [team]: "secret plan"');
    expect(await chat(clients[1])).toContain("[team]: secret plan");
    expect(await state(clients[1], { since: 0 })).toContain("secret plan");
    for (const c of clients.slice(2)) {
      expect(JSON.parse(await chat(c, undefined, { json: true })).messages).toEqual([]);
      expect(await state(c, { since: 0 })).not.toContain("secret plan");
      expect(await wait(c, { seconds: 0, since: 0, until: "chat" })).not.toContain("secret plan");
    }
    // The batch endpoint must use the same privacy checks.
    await act(clients[1], { type: "chat", channel: "team", text: "private reply" });
    expect(await chat(clients[0])).toContain("private reply");
    expect(await chat(clients[2])).not.toContain("private reply");
    await expect(clients[2].post("/chat", { text: "bad", channel: "typo" })).rejects.toMatchObject({ status: 400 });
    expect(await act(clients[2], { type: "chat", channel: "typo", text: "bad" })).toContain('FAILED chat: bad or missing "channel"');
  });

  it("plays a match through the command functions", async () => {
    const lobby = client({ server: srv.url });
    expect(await newRoom(lobby, { names: ["x"], bots: ["eco"] })).toMatch(/^room \w+ \(waiting\) · map open\n.*corner\].*AOA_TOKEN=\w+\n.*\(bot eco\)\nwatch http/);
    const room = JSON.parse(await newRoom(lobby, { json: true, names: ["alice", "bob"], seed: 5 }));
    const [c1, c2] = room.players.map((p: { token: string }) => client({ server: srv.url, token: p.token }));
    expect(await rooms(lobby)).toContain(`${room.id} waiting`);

    expect(await status(c1)).toBe("waiting");
    const ts = "const e: any = self.nearestEnemy(); if (e) self.attack(e); else self.hold();";
    await expect(putScript(c1, "knight", ts, { lang: "ts" })).rejects.toThrow(ApiError); // not before the start

    expect(await status(c2)).toBe("waiting"); // checking status does not connect a player
    await state(c2); // both connected → prep (0 ms) → running
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
