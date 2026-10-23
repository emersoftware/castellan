import { afterEach, describe, expect, it, vi } from "vitest";
import { rules } from "@castellan/shared";
import { api } from "../src/api";
import { battleMode } from "../src/components/BattleCard";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const entry = (id: string, createdAt: string) => ({ id, createdAt, rulesVersion: rules.version, players: [], outcome: { reason: "timeout" }, finalTick: 100, tickRate: 10 });
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

it("lists the local archive's battles, newest saved first", async () => {
  const games = [
    { ...entry("started-later", "2026-09-29T00:00:00Z"), savedAt: "2026-09-29T01:00:00Z" },
    { ...entry("saved-later", "2026-09-28T00:00:00Z"), savedAt: "2026-09-29T02:00:00Z" },
  ];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => response(url === "/replays" ? games : [])));
  const result = await api.replays();
  expect(result.map((r) => r.id)).toEqual(["saved-later", "started-later"]);
  expect(result[0].source).toBe("local");
});

it("excludes mixed and all-bot matches, including bot names without the bot flag", async () => {
  const names = ["bot:eco", "rush", "eco-a", "kite", "turtle", "Claude Opus 5.5 Low"];
  const games = names.map((name, i) => ({ ...entry(String(i), "2026-09-29T00:00:00Z"), players: [{ id: "p1", name }, { id: "p2", name: "GPT-6 Astra" }] }));
  const flagged = { ...entry("flagged", "2026-09-29T00:00:00Z"), players: [{ id: "p1", name: "Custom", bot: "rush" }] };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => response(url === "/replays" ? [...games, flagged] : [])));
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

describe("battle modes", () => {
  const battle = (id: string, names: string[], teams: (number | undefined)[], savedAt: string) =>
    ({ id, createdAt: savedAt, savedAt, players: names.map((name, i) => ({ id: `p${i + 1}`, name, team: teams[i] })) });
  it("tells duels, 2v2 and free-for-all apart", () => {
    expect(battleMode(battle("a", ["x", "y"], [0, 1], ""))).toBe("duel");
    expect(battleMode(battle("b", ["x", "y", "z", "w"], [0, 0, 1, 1], ""))).toBe("teams");
    expect(battleMode(battle("c", ["x", "y", "z", "w"], [0, 1, 2, 3], ""))).toBe("ffa");
    expect(battleMode(battle("d", ["x", "y", "z"], [undefined, undefined, undefined], ""))).toBe("ffa");
  });
});
