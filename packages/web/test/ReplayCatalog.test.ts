import { afterEach, expect, it, vi } from "vitest";
import { api } from "../src/api";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const entry = (id: string, createdAt: string) => ({ id, createdAt, players: [], outcome: { reason: "timeout" }, finalTick: 100, tickRate: 10 });
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

it("shows newer local battles first while keeping bundled titles without duplicates", async () => {
  const previous = { ...entry("old", "2026-09-26T00:00:00Z"), title: "The comeback" };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => response(url === "/featured/index.json"
    ? [previous] : [entry("new", "2026-09-29T00:00:00Z"), previous])));
  const result = await api.replays();
  expect(result.map((r) => r.id)).toEqual(["new", "old"]);
  expect(result[1].title).toBe("The comeback");
});

it("keeps the entire bundled catalog available on a static host without the local API", async () => {
  const games = [entry("a", "2026-09-26T00:00:00Z"), entry("b", "2026-09-29T00:00:00Z")];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/featured/index.json"
    ? response(games) : new Response("<!doctype html>", { headers: { "content-type": "text/html" } })));
  expect((await api.replays()).map((r) => r.id)).toEqual(["b", "a"]);
});

it("uses the source file date instead of the match start time", async () => {
  const games = [
    { ...entry("started-later", "2026-09-29T00:00:00Z"), savedAt: "2026-09-29T01:00:00Z" },
    { ...entry("saved-later", "2026-09-28T00:00:00Z"), savedAt: "2026-09-29T02:00:00Z" },
  ];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => response(url === "/featured/index.json" ? games : [])));
  expect((await api.replays()).map((r) => r.id)).toEqual(["saved-later", "started-later"]);
});

it("excludes mixed and all-bot matches from both catalogs, including legacy bot names", async () => {
  const names = ["bot:eco", "rush", "eco-a", "kite", "turtle", "Claude Opus 5.5 Low"];
  const games = names.map((name, i) => ({ ...entry(String(i), "2026-09-29T00:00:00Z"), players: [{ id: "p1", name }, { id: "p2", name: "GPT-6 Astra" }] }));
  const flagged = { ...entry("flagged", "2026-09-29T00:00:00Z"), players: [{ id: "p1", name: "Custom", bot: "rush" }] };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => response(url === "/featured/index.json" ? games.slice(0, 2) : [...games, flagged])));
  expect((await api.replays()).map((r) => r.id)).toEqual(["5"]);
});

it("uses only the public D1 API in the Cloudflare build, including series", async () => {
  vi.stubEnv("VITE_PUBLIC_REPLAYS", "true");
  const fetcher = vi.fn(async (url: string) => response(url === "/api/replays" ? [entry("one", "2026-10-01T00:00:00Z")] : {}));
  vi.stubGlobal("fetch", fetcher);
  expect((await api.replays())[0].source).toBe("published");
  await api.replay("one");
  await api.series();
  await api.seriesSummary("series-one");
  await api.seriesReplay("series-one");
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/replays", "/api/replays/one", "/api/series", "/api/series/series-one", "/api/series/series-one/replay.json"]);
});

it("surfaces public catalogue failures instead of falling back to an old bundled list", async () => {
  vi.stubEnv("VITE_PUBLIC_REPLAYS", "true");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("Unavailable", { status: 503 })));
  await expect(api.replays()).rejects.toThrow("503");
});

it("reports an unavailable local catalogue instead of pretending it is empty", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("Unavailable", { status: 503 })));
  await expect(api.replays()).rejects.toThrow("Battle catalogue unavailable");
});
