import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { rules, type Ruleset } from "@aoa/shared";
import { Room } from "../src/room";
import { runReplay } from "@aoa/engine";
import { buildServer } from "../src/app";
import { waitForReplay, waitForStatus } from "./support/readiness";

afterEach(() => vi.useRealTimers());

it.each([1, 5])("damage (range %i) interrupts wait even while filtering for spawn", async (range) => {
  const r: Ruleset = { ...rules, map: { ...rules.map, width: 4, height: 4, walls: [], deposits: [], sharedDeposits: [],
    start: [{ kind: "king", x: 1, y: 1 }] }, kinds: { ...rules.kinds, king: { ...rules.kinds.king, range, aimMs: 0 } } };
  const room = await Room.create({ ruleset: r, players: [{ name: "a" }, { name: "b" }], tickRate: 10,
    seed: 1, sides: "fixed", prepMs: 0, botLatencyMs: 1000, chat: false, onFinish: () => {} });
  vi.useFakeTimers();
  try {
    room.touch("p1"); room.touch("p2"); await vi.advanceTimersByTimeAsync(1);
    const before = room.view("p1"), p2 = room.view("p2");
    let woke = false;
    const pendingWait = room.wait("p1", before.tick, 5000, ["spawn"]).then(() => { woke = true; });
    const order = room.act("p2", [{ type: "attack", unit: p2.mine[0].id, target: before.mine[0].id }]);
    await vi.advanceTimersByTimeAsync(600);
    expect((await order).results[0].ok).toBe(true);
    expect(woke).toBe(true);
    await pendingWait;
    const after = room.view("p1", before.tick);
    expect(after.underAttack?.[0].damage).toBeGreaterThan(0);
    expect(after.mine[0].hp).toBeLessThan(before.mine[0].hp);
    expect(after.events.some((e) => e.type === "spawn")).toBe(false);
  } finally { room.close(); }
});

it("separates host spectators, player tokens and other-room capabilities; releases finished games", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aoa-access-"));
  const app = await buildServer({ replayDir: dir, prepMs: 0, ruleset: { ...rules, matchMs: 300 } });
  try {
    const make = async () => (await app.inject({ method: "POST", url: "/rooms", payload: {} })).json();
    const room = await make(), other = await make();
    const token = new URLSearchParams(room.watch.split("#")[1]).get("spectator")!;
    const path = `/rooms/${room.id}/scripts`;
    expect((await app.inject(path)).statusCode).toBe(403);
    expect((await app.inject({ url: path, headers: { authorization: `Bearer ${room.players[0].token}` } })).statusCode).toBe(403);
    expect((await app.inject({ url: `/rooms/${other.id}/scripts`, headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(403);
    expect((await app.inject({ url: path, headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
    for (const url of ["/rooms", `/rooms/${room.id}`]) expect((await app.inject(url)).body).not.toContain(token);
    const ws = await app.injectWS(`/spectate/${room.id}`);
    const close = new Promise<number>((resolve) => ws.on("close", (code: number) => resolve(code)));
    expect(await close).toBe(4403);
    const trusted = await app.injectWS(`/spectate/${room.id}?spectator=${token}`);
    trusted.close();
    for (const p of room.players) await app.inject({ url: "/state", headers: { authorization: `Bearer ${p.token}` } });
    await waitForStatus(app, room.players[0].token, "finished");
    expect((await app.inject(path)).statusCode).toBe(200);
    await waitForReplay(app, room.id);
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});

it("records reproducible manifests and errors without credentials, and probes without installing code", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aoa-manifest-"));
  const app = await buildServer({ replayDir: dir, prepMs: 0, ruleset: { ...rules, matchMs: 500 } });
  try {
    const created = (await app.inject({ method: "POST", url: "/rooms", payload: { players: [{ name: "model-looking-name" }, { name: "Model Low" }] } })).json();
    const headers = { authorization: `Bearer ${created.players[0].token}` };
    expect((await app.inject({ method: "POST", url: "/agent-config", headers, payload: { apiKey: "never-record-this" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/agent-config", headers,
      payload: { model: "test-model", effort: "low", connector: "test", promptSha256: "a".repeat(64), memoryPolicy: "isolated" } })).statusCode).toBe(200);
    expect((await app.inject(`/rooms/${created.id}`)).json().status).toBe("waiting");
    expect((await app.inject({ method: "POST", url: "/agent-status", headers, payload: { state: "provider_wait", retryAt: "2026-10-08T17:00:00Z" } })).statusCode).toBe(200);
    expect((await app.inject(`/rooms/${created.id}`)).json().status).toBe("waiting");
    expect((await app.inject({ method: "POST", url: "/agent-status", headers, payload: { state: "strategizing", retryAt: "bad" } })).statusCode).toBe(400);
    const probe = (await app.inject({ method: "POST", url: "/scripts/king/test", headers, payload: { code: "self.log(self.attackReadyInTicks); self.hold();" } })).json();
    expect(probe).toMatchObject({ ok: true, actionsApplied: false, freshMemory: true });
    expect(probe.frames[0].runs).not.toEqual({});
    expect((await app.inject({ url: "/scripts/king", headers })).json().custom).toBe(false);
    await app.inject({ method: "POST", url: "/run", headers, payload: { code: "throw new Error('test')" } });
    await app.inject({ url: "/state", headers: { authorization: `Bearer ${created.players[1].token}` } });
    for (let i = 0; i < 5; i++) {
      const waited = await app.inject({ url: "/wait?until=match_end&max=2", headers });
      if (waited.json().status === "finished") break;
    }
    await waitForReplay(app, created.id);
    const replay = (await app.inject(`/replays/${created.id}`)).json();
    expect(replay.experiment).toMatchObject({ schema: 1, mode: "independent", droppedCalls: 0,
      players: { p1: { configuration: { model: "test-model", effort: "low" } }, p2: { configuration: { model: null } } } });
    const indexPath = join(dir, "index.json");
    const index = JSON.parse(await readFile(indexPath, "utf8"));
    const expectedPlayers = [expect.objectContaining({ id: "p1", effort: "low" }), expect.objectContaining({ id: "p2", effort: null })];
    expect(index[0].players).toEqual(expectedPlayers);
    // Existing indexes already have a rules version but predate per-player effort.
    const replayBytes = await readFile(join(dir, `${created.id}.json.gz`));
    await writeFile(indexPath, JSON.stringify(index.map((entry: { players: { effort?: string | null }[] }) => ({ ...entry,
      players: entry.players.map(({ effort: _effort, ...player }) => player),
    }))));
    expect((await app.inject("/replays")).json()[0].players).toEqual(expectedPlayers);
    expect(await readFile(join(dir, `${created.id}.json.gz`))).toEqual(replayBytes);
    expect(replay.experiment.engine.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(replay.experiment.rulesSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(replay.experiment.calls.some((c: { failed: boolean }) => c.failed)).toBe(true);
    expect(replay.experiment.agentActivity).toEqual([expect.objectContaining({ player: "p1", tick: 0, activity: expect.objectContaining({ state: "provider_wait" }) })]);
    expect(replay.experiment.calls).toContainEqual(expect.objectContaining({ tool: "GET /wait", status: 200, answeredTick: replay.finalTick }));
    expect(replay.timing.p1.toolErrors).toBeGreaterThan(0);
    await expect(runReplay({ ...replay, experiment: { ...replay.experiment, operationalFailures: [{ player: "p1", tick: 1, message: "sandbox watchdog timeout" }] } }, () => {})).rejects.toThrow("operational failure");
    const serialized = JSON.stringify(replay);
    for (const secret of [...created.players.map((p: { token: string }) => p.token), "never-record-this", created.watch.split("#")[1]]) expect(serialized).not.toContain(secret);
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});

it("persists a pending trace after the bounded finish deadline instead of blocking a series", async () => {
  let saved: any;
  const room = await Room.create({ ruleset: { ...rules, matchMs: 200 }, players: [{ name: "a" }, { name: "b" }],
    tickRate: 10, seed: 1, sides: "fixed", prepMs: 0, botLatencyMs: 1000, chat: false, onFinish: (replay) => { saved = replay; } });
  vi.useFakeTimers();
  try {
    room.openCall("p1", "GET /wait"); // disconnected client: no onResponse
    room.touch("p1"); room.touch("p2");
    await vi.advanceTimersByTimeAsync(500);
    expect(room.state).toBe("finished"); expect(saved).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000);
    expect(saved.experiment.calls).toContainEqual(expect.objectContaining({ tool: "GET /wait", status: null, answeredTick: null }));
  } finally { room.close(); }
});

it("omits player and spectator capabilities from enabled access logs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aoa-logs-"));
  try {
    const source = `import { buildServer } from ${JSON.stringify(fileURLToPath(new URL("../src/app.ts", import.meta.url)))};
      const app = await buildServer({ replayDir: ${JSON.stringify(dir)}, logger: true });
      await app.inject('/health?token=private-player-sentinel&spectator=private-spectator-sentinel');
      await app.close();`;
    const { stdout, stderr } = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source]);
    expect(stdout).toContain("incoming request");
    expect(stdout + stderr).not.toContain("private-player-sentinel");
    expect(stdout + stderr).not.toContain("private-spectator-sentinel");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
