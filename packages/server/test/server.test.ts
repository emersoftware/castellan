import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { v0, type PlayerView } from "@aoa/shared";
import { buildServer } from "../src/app";

let app: FastifyInstance;
let base = "";
const dir = mkdtempSync(join(tmpdir(), "aoa-"));

beforeAll(async () => {
  app = await buildServer({ replayDir: dir, ruleset: { ...v0, matchMs: 4000 }, tickRate: 20, prepMs: 300 });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(() => app.close());

const call = async (path: string, token?: string, init: RequestInit = {}) => {
  const res = await fetch(base + path, {
    ...init,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}
  return { status: res.status, body };
};

describe("server", () => {
  it("plays a match over the HTTP API and saves a replay", async () => {
    const room = (await call("/rooms", undefined, { method: "POST", body: JSON.stringify({ players: [{ name: "alice" }, { name: "bob" }], seed: 5 }) })).body;
    const [t1, t2] = room.players.map((p: any) => p.token);
    expect(room.status).toBe("waiting");

    expect((await call("/state", "nope")).status).toBe(401);
    const s1 = (await call("/state", t1)).body as PlayerView;
    expect(s1.status).toBe("waiting");
    expect(s1.grid).toHaveLength(32);

    // Before the start nothing goes in, scripts included: prep is for planning.
    const tsScript = JSON.stringify({ lang: "ts", code: "const e: any = self.nearestEnemy(); if (e) self.attack(e); else self.hold();" });
    const early = await call("/scripts/knight", t1, { method: "PUT", body: tsScript });
    expect(early.status).toBe(409);

    await call("/state", t2); // both connected → prep → running
    const w = await call(`/wait?since=0&max=5`, t1);
    expect(["prep", "running"]).toContain(w.body.status);
    await new Promise((r) => setTimeout(r, 400));

    // Once running: TS is accepted and stripped; syntax errors are rejected.
    const put = await call("/scripts/knight", t1, { method: "PUT", body: tsScript });
    expect(put.body).toMatchObject({ ok: true });
    const bad = await call("/scripts/knight", t1, { method: "PUT", body: JSON.stringify({ code: "self.hold(" }) });
    expect(bad.status).toBe(400);

    const nexus = s1.mine.find((e) => e.kind === "nexus")!;
    const act = await call("/act", t1, { method: "POST", body: JSON.stringify({ orders: [{ type: "train", building: nexus.id, kind: "knight" }, { type: "move", unit: "zzz", x: 1, y: 1 }] }) });
    expect(act.body.results[0]).toMatchObject({ ok: true });
    expect(act.body.capital.spent).toBe(v0.kinds.knight.cost);
    expect(act.body.capital.remaining).toBe(act.body.view.players.find((p: any) => p.id === "p1").capital);
    expect(act.body.results[0].capital.spent).toBe(v0.kinds.knight.cost);
    expect(act.body.results[1]).toMatchObject({ ok: false });
    expect(act.body.view.mine.some((e: any) => e.kind === "knight")).toBe(true);

    const text = await call("/state?format=text", t1);
    expect(text.body).toContain("map (x→, y↓;");

    const script = await call("/scripts/knight", t1);
    expect(script.body.custom).toBe(true);
    expect(script.body.code).not.toContain(": any");

    // Wait for the (short) match to end.
    for (let i = 0; i < 20; i++) {
      const v = (await call(`/wait?since=0&max=2&until=match_end`, t2)).body as PlayerView;
      if (v.status === "finished") break;
    }
    const summary = (await call(`/rooms/${room.id}`)).body;
    expect(summary.status).toBe("finished");
    await new Promise((r) => setTimeout(r, 200));
    const replays = (await call("/replays")).body;
    expect(replays[0].id).toBe(room.id);
    const replay = (await call(`/replays/${room.id}`)).body;
    expect(replay.orders.length).toBeGreaterThan(0);
  });

  it("runs bot practice rooms without tokens", async () => {
    const room = (await call("/rooms", undefined, { method: "POST", body: JSON.stringify({ players: [{ bot: "eco" }, { bot: "rush" }] }) })).body;
    expect(room.players.every((p: any) => p.token === undefined)).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect((await call(`/rooms/${room.id}`)).body.status).toBe("running");
  });
});

describe("chat and timing", () => {
  it("relays chat only when the room has it on, and measures each player's time", async () => {
    const make = async (chat: boolean) => (await call("/rooms", undefined, { method: "POST", body: JSON.stringify({ players: [{ name: "a" }, { name: "b" }], prepMs: 0, chat }) })).body;
    const on = await make(true);
    const [a, b] = on.players.map((p: any) => p.token);
    await call("/state", a);
    await call("/state", b);
    await new Promise((r) => setTimeout(r, 200));
    const sent = await call("/chat", a, { method: "POST", body: JSON.stringify({ text: "gg, your nexus is mine" }) });
    expect(sent.body).toMatchObject({ ok: true, view: { you: "p1" } });
    expect((await call("/chat", a, { method: "POST", body: JSON.stringify({ text: "again" }) })).status).toBe(400); // rate limit
    await new Promise((r) => setTimeout(r, 200));
    const seen = (await call("/state?since=0", b)).body as PlayerView;
    expect(seen.events.some((e) => e.type === "chat" && e.text === "gg, your nexus is mine")).toBe(true);
    // Without `since`, events are "since my last view": the message is not repeated.
    const again = (await call("/state", b)).body as PlayerView;
    expect(again.events.some((e) => e.type === "chat")).toBe(false);
    const summary = (await call(`/rooms/${on.id}`)).body;
    expect(summary.chat).toBe(true);
    expect(summary.timing.p1.calls).toBeGreaterThanOrEqual(3);
    expect(summary.timing.p1.thinks).toBeGreaterThanOrEqual(1);
    // Supervisor status checks are not player calls.
    expect((await call("/status", "nope")).status).toBe(401);
    expect((await call("/status", a)).body).toMatchObject({ room: on.id, player: "p1", status: "running" });
    expect((await call(`/rooms/${on.id}`)).body.timing.p1.calls).toBe(summary.timing.p1.calls);
    expect((await call("/rules?format=text", a)).body).toContain("## Chat");
    expect((await call("/chat?format=text", b)).body).toContain("p1 a: gg, your nexus is mine");

    const off = await make(false);
    const c = off.players[0].token;
    await call("/state", c);
    await call("/state", off.players[1].token);
    await new Promise((r) => setTimeout(r, 200));
    const denied = await call("/chat", c, { method: "POST", body: JSON.stringify({ text: "hello?" }) });
    expect(denied.body.error).toMatch(/chat is off/);
  });
});

describe("one-shot player scripts", () => {
  it("runs code over the JSON view and rules, applies its orders together, and returns value and logs", async () => {
    const room = (await call("/rooms", undefined, { method: "POST", body: JSON.stringify({ players: [{ name: "a" }, { name: "b" }], prepMs: 0 }) })).body;
    const [a, b] = room.players.map((p: any) => p.token);
    await call("/state", a); await call("/state", b);
    await new Promise((r) => setTimeout(r, 150));
    const run = (code: string, format = "") => call(`/run${format}`, a, { method: "POST", body: JSON.stringify({ code }) });
    const ok = (await run(`const base = view.mine.find(e => rules.kinds[e.kind].trains);
      act({ type: "stop", unit: view.mine.find(e => !rules.kinds[e.kind].building).id });
      act({ type: "chat", text: "not from run" });
      log("capital", view.players.find(p => p.id === view.you).capital);
      return { base: base.id, kinds: Object.keys(rules.kinds).length };`)).body;
    expect(ok.error).toBeUndefined();
    expect(ok.results).toEqual([{ ok: true }]);
    expect(ok.rejected).toBe(1);
    expect(ok.value).toMatchObject({ base: expect.any(String) });
    expect(ok.logs[0]).toMatch(/^capital \d+$/);
    const failed = (await run(`act({ type: "stop", unit: "e1" }); throw new Error("boom");`)).body;
    expect(failed).toMatchObject({ error: "boom", orders: [], results: [] });
    expect((await run("while (true) {}")).body.error).toMatch(/out of gas/);
    const text = (await run(`return 42`, "?format=text")).body;
    expect(text).toContain("run ok · 0 order(s)");
    expect(text).toContain("returned: 42");
    expect((await call("/run", a, { method: "POST", body: JSON.stringify({}) })).status).toBe(400);
  });
});
