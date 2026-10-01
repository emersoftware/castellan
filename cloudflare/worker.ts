import type { SeriesSummary } from "../packages/shared/src/protocol";

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" };
const error = (message: string, status: number) => Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });

/** The public Worker only reads D1. Publishing uses Wrangler on the host computer. */
async function readAPI(path: string, db: D1Database): Promise<Response> {
  if (path === "/api/replays" || path === "/api/series") {
    const table = path === "/api/replays" ? "replays" : "series";
    const { results } = await db.prepare(`SELECT summary_json FROM ${table} ORDER BY saved_at DESC, id`).all<{ summary_json: string }>();
    return new Response(`[${results.map((r) => r.summary_json).join(",")}]`, { headers: jsonHeaders });
  }
  const replay = /^\/api\/replays\/([a-zA-Z0-9_-]+)$/.exec(path);
  if (replay) {
    const row = await db.prepare("SELECT replay_json, content_hash FROM replays WHERE id = ?").bind(replay[1]).first<{ replay_json: string; content_hash: string }>();
    return row ? new Response(row.replay_json, { headers: { ...jsonHeaders, etag: `"${row.content_hash}"` } }) : error("Replay not found", 404);
  }
  const series = /^\/api\/series\/([a-zA-Z0-9_-]+)(\/replay.json)?$/.exec(path);
  if (series) {
    const raw = await db.prepare("SELECT summary_json FROM series WHERE id = ?").bind(series[1]).first<string>("summary_json");
    if (!raw) return error("Series not found", 404);
    if (!series[2]) return new Response(raw, { headers: jsonHeaders });
    const summary: SeriesSummary = JSON.parse(raw);
    const rows = await db.batch<{ replay_json: string }>(summary.games.map((game) => db.prepare("SELECT replay_json FROM replays WHERE id = ?").bind(game.roomId)));
    if (rows.some((row) => row.results.length !== 1)) return error("Series is incomplete", 503);
    return new Response(`{"format":"aoa-series-v1","series":${raw},"games":[${rows.map((row) => row.results[0].replay_json).join(",")}]}`, { headers: jsonHeaders });
  }
  return error("Not found", 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405, headers: { allow: "GET, HEAD", "cache-control": "no-store" } });
    }
    // Query strings do not create unbounded copies of the same cached catalogue.
    const key = new Request(`${url.origin}${url.pathname}`);
    const cache = caches.default;
    try {
      const bypass = request.headers.get("cache-control")?.includes("no-cache");
      let response = bypass ? undefined : await cache.match(key);
      if (!response) {
        response = await readAPI(url.pathname, env.DB);
        if (response.ok) {
          response.headers.set("cache-control", "public, max-age=0, s-maxage=60, must-revalidate");
          ctx.waitUntil(cache.put(key, response.clone()).catch(() => console.warn(JSON.stringify({ event: "cache_write_failed", path: url.pathname }))));
        }
      }
      if (response.ok && response.headers.has("etag") && request.headers.get("if-none-match") === response.headers.get("etag")) {
        return new Response(null, { status: 304, headers: response.headers });
      }
      return request.method === "HEAD" ? new Response(null, response) : response;
    } catch {
      console.error(JSON.stringify({ event: "catalog_read_failed", path: url.pathname }));
      return error("Catalogue temporarily unavailable", 503);
    }
  },
} satisfies ExportedHandler<Env>;
