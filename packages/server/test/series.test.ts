import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { rules, type SeriesSummary } from "@aoa/shared";
import { runReplay } from "@aoa/engine";
import { buildServer } from "../src/app";

let app: FastifyInstance;
afterEach(async () => { await app?.close(); });
async function start(dir?: string, matchMs = 800) {
  const replayDir = dir ?? await mkdtemp(join(tmpdir(), "aoa-series-test-"));
  const webDir = join(replayDir, "web");
  await mkdir(webDir, { recursive: true });
  await writeFile(join(webDir, "index.html"), "<!doctype html><title>Series viewer</title>");
  app = await buildServer({ replayDir, webDir, ruleset: { ...rules, matchMs, fourSeatMatchMs: matchMs }, prepMs: 0, tickRate: 20 });
  return replayDir;
}
async function request(url: string, token?: string, payload?: unknown, method: "GET" | "POST" | "PUT" = payload ? "POST" : "GET") {
  const response = await app.inject({ method, url, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, payload: payload === undefined ? undefined : JSON.stringify(payload) });
  return { status: response.statusCode, body: response.json() };
}
async function poll<T>(get: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const end = Date.now() + 6000;
  for (;;) {
    const value = await get();
    if (ready(value)) return value;
    if (Date.now() > end) throw new Error("poll timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}
const current = async (token: string): Promise<{ series: SeriesSummary; game: { id: string; number: number; token: string; status: string } }> => (await request("/series/current", token)).body;
async function connect(tokens: string[]) {
  await Promise.all(tokens.map((token) => request("/state", token)));
  await poll(() => request("/state", tokens[0]), (r) => r.body.status === "running");
}

describe("three-game series", () => {
  it("accumulates only previous player-visible history and exports all three verified replays", async () => {
    const dir = await start();
    const created = await request("/series", undefined, { map: "quad", mode: "ffa", chat: true });
    expect(created.status).toBe(200);
    const invites: string[] = created.body.players.map((p: { token: string }) => p.token);
    const id = created.body.id;
    const first = await Promise.all(invites.map(current));
    const tokens = first.map((j) => j.game.token);
    expect(new Set([...invites, ...tokens]).size).toBe(8);
    // Player harnesses hold these tokens: they see ids, observers see names.
    expect(first[0].series.players.map((p) => p.name)).toEqual(["p1", "p2", "p3", "p4"]);
    expect((await request(`/series/${id}`)).body.players.map((p: { name: string }) => p.name)).toEqual(["player1", "player2", "player3", "player4"]);
    expect((await request("/history", tokens[0])).body.games).toEqual([]);
    expect((await request("/history?game=1", tokens[0])).status).toBe(403);
    expect((await request("/rules", tokens[0])).body.guide).toContain("Game 1 of 3");
    expect((await request(`/series/${id}/replay.json`)).status).toBe(409);
    await connect(tokens);
    await Promise.all([
      request("/chat", tokens[0], { text: "our pact", to: "p2" }),
      request("/chat", tokens[2], { text: "their secret", to: "p4" }),
      request("/scripts/knight", tokens[0], { code: "self.hold(); // my script" }, "PUT"),
      request("/scripts/knight", tokens[2], { code: "self.hold(); // rival secret script" }, "PUT"),
    ]);
    const second = await poll(() => current(invites[0]), (j) => j.game.number === 2);
    const secondJoins = await Promise.all(invites.map(current));
    expect(second.game.token).not.toBe(tokens[0]);
    expect((await request("/state", tokens[0])).body.status).toBe("finished");
    expect((await request("/history", second.game.token)).body.games).toHaveLength(1);
    const chat = (await request("/history?game=1&section=chat&limit=1", second.game.token)).body;
    expect(chat.items).toEqual([expect.objectContaining({ text: "our pact", to: "p2" })]);
    expect(chat.next).toBeNull();
    expect(JSON.stringify(chat)).not.toContain("their secret");
    const scripts = (await request("/history?game=1&section=scripts", second.game.token)).body;
    expect(JSON.stringify(scripts)).toContain("my script");
    expect(JSON.stringify(scripts)).not.toContain("rival secret script");
    const page = (await request("/history?game=1&section=orders&limit=1", second.game.token)).body;
    expect(page.items).toHaveLength(1);
    expect(page.next).toBe(1);
    expect((await request("/history?game=1&section=orders&offset=1&limit=1", second.game.token)).body.items).toHaveLength(1);
    expect((await request("/history?game=2", second.game.token)).status).toBe(403);
    expect((await request("/history?game=0", second.game.token)).status).toBe(400);
    expect((await request("/scripts/knight", second.game.token)).body.custom).toBe(false);
    await connect(secondJoins.map((j) => j.game.token));
    const third = await poll(() => current(invites[0]), (j) => j.game.number === 3);
    expect((await request("/history", third.game.token)).body.games).toHaveLength(2);
    const state = (await request("/state", third.game.token)).body;
    expect(state.series).toMatchObject({ id, gameNumber: 3, previousGames: [1, 2] });
    const thirdJoins = await Promise.all(invites.map(current));
    await connect(thirdJoins.map((j) => j.game.token));
    await poll(() => current(invites[0]), (j) => j.series.status === "finished");
    const bundle = (await request(`/series/${id}/replay.json`)).body;
    const pageResponse = await app.inject(`/series/${id}/replay`);
    expect(pageResponse.headers["content-type"]).toContain("text/html");
    expect(pageResponse.body).toContain("Series viewer");
    expect(bundle.format).toBe("aoa-series-v1");
    expect(bundle.games).toHaveLength(3);
    expect(bundle.games.map((g: any) => g.series.gameNumber)).toEqual([1, 2, 3]);
    for (const replay of bundle.games) expect((await runReplay(replay, () => {})).verified).toBe(true);
    expect(JSON.stringify((await request(`/series/${id}`)).body)).not.toContain("token");
    const other = (await request("/series", undefined, {})).body;
    const otherGame = await current(other.players[0].token);
    expect((await request("/history", otherGame.game.token)).body.games).toEqual([]);
    expect((await request("/history?game=1", otherGame.game.token)).status).toBe(403);
    await app.close();
    await start(dir);
    expect((await request(`/series/${id}/replay.json`)).body).toEqual(bundle);
  }, 15000);

  it("restores an unfinished game and stable credentials from its checkpoint", async () => {
    const dir = await start(undefined, 2000);
    const created = (await request("/series", undefined, { chat: true })).body;
    const invites: string[] = created.players.map((p: { token: string }) => p.token);
    const joins = await Promise.all(invites.map(current));
    const tokens = joins.map((j) => j.game.token);
    await connect(tokens);
    const before = (await request("/state", tokens[0])).body;
    await request("/act", tokens[0], { orders: [{ type: "train", building: before.mine.find((e: any) => e.kind === "castle").id, kind: "worker" }] });
    await request("/chat", tokens[0], { text: "remember after restart", to: "p2" });
    await app.close();
    const saved = JSON.parse(await readFile(join(dir, "series", `${created.id}.json`), "utf8"));
    await start(dir, 2000);
    const restored = await current(invites[0]);
    expect(restored.game.id).toBe(joins[0].game.id);
    expect(restored.game.token).toBe(tokens[0]);
    const view = (await request("/state", tokens[0])).body;
    expect(view.tick).toBe(saved.games[0].tick);
    expect(view.mine.filter((e: any) => e.kind === "worker")).toHaveLength(3);
    expect(view.mine.find((e: any) => e.kind === "castle").training).toEqual([expect.objectContaining({ kind: "worker" })]); // still queued
    expect(view.chat.messages).toContainEqual(expect.objectContaining({ text: "remember after restart" }));
    await connect(tokens);
    await poll(() => current(invites[0]), (j) => j.game.number === 2);
    await app.close();
    await start(dir, 2000);
    const second = await current(invites[0]);
    expect(second.game.number).toBe(2);
    expect((await request("/history?game=1&section=chat", second.game.token)).body.items).toContainEqual(expect.objectContaining({ text: "remember after restart" }));
    expect((await request("/replays")).body.filter((r: any) => r.id === joins[0].game.id)).toHaveLength(1);
  }, 15000);
});
