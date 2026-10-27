import { replayMeta } from "./social";
import type { SeriesSummary } from "../packages/shared/src/protocol";
import { publishedApi, publishedRoutes } from "../packages/shared/src/http";

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" };
const error = (message: string, status: number) => Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
const replayPattern = new RegExp(`^${publishedRoutes.replays}/([a-zA-Z0-9_-]+)$`);
const seriesPattern = new RegExp(`^${publishedRoutes.series}/([a-zA-Z0-9_-]+)(/replay.json)?$`);

/** A replay payload is stored in ordered pieces (see migrations/0002). */
const chunksOf = (db: D1Database, id: string) => db.prepare("SELECT chunk FROM replay_chunks WHERE id = ? ORDER BY n").bind(id);
const joined = (rows: D1Result) => (rows.results as { chunk: string }[]).map((r) => r.chunk).join("");

/** The public Worker only reads D1. Publishing uses Wrangler on the host computer. */
async function readAPI(path: string, db: D1Database): Promise<Response> {
  if (path === publishedRoutes.replays || path === publishedRoutes.series) {
    const query = `SELECT summary_json FROM ${path === publishedRoutes.replays ? "replays" : "series"} ORDER BY saved_at DESC, id`;
    const { results } = await db.prepare(query).all<{ summary_json: string }>();
    return new Response(`[${results.map((r) => r.summary_json).join(",")}]`, { headers: jsonHeaders });
  }
  const replay = replayPattern.exec(path);
  if (replay) {
    const [row, payload] = await db.batch([
      db.prepare("SELECT content_hash FROM replays WHERE id = ?").bind(replay[1]),
      chunksOf(db, replay[1]),
    ]);
    const hash = (row.results[0] as { content_hash: string } | undefined)?.content_hash;
    return hash && payload.results.length ? new Response(joined(payload), { headers: { ...jsonHeaders, etag: `"${hash}"` } }) : error("Replay not found", 404);
  }
  const series = seriesPattern.exec(path);
  if (series) {
    const raw = await db.prepare("SELECT summary_json FROM series WHERE id = ?").bind(series[1]).first<string>("summary_json");
    if (!raw) return error("Series not found", 404);
    if (!series[2]) return new Response(raw, { headers: jsonHeaders });
    const summary: SeriesSummary = JSON.parse(raw);
    const rows = await db.batch(summary.games.map((game) => chunksOf(db, game.roomId)));
    if (rows.some((row) => !row.results.length)) return error("Series is incomplete", 503);
    return new Response(`{"format":"castellan-series-v1","series":${raw},"games":[${rows.map(joined).join(",")}]}`, { headers: jsonHeaders });
  }
  return error("Not found", 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const preview = /^\/og\/([a-zA-Z0-9_-]+)\.png$/.exec(url.pathname);
    if (preview && (request.method === "GET" || request.method === "HEAD")) {
      let results: { chunk: string }[];
      try { ({ results } = await env.DB.prepare("SELECT chunk FROM replay_images WHERE id = ? ORDER BY n").bind(preview[1]).all<{ chunk: string }>()); }
      catch {
        console.error(JSON.stringify({ event: "preview_read_failed", id: preview[1] }));
        return error("Preview temporarily unavailable", 503);
      }
      if (!results.length) return new Response("Not found", { status: 404, headers: { "cache-control": "public, max-age=300" } });
      const png = Uint8Array.from(atob(results.map((r) => r.chunk).join("")), (c) => c.charCodeAt(0));
      // Pages link the picture with its hash, so each address always shows the same one.
      const headers = { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" };
      return new Response(request.method === "HEAD" ? null : png, { headers });
    }
    const replayPage = /^\/replay\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
    if (replayPage && request.method === "GET") {
      const page = await env.ASSETS.fetch(request);
      try {
        const row = await env.DB.prepare("SELECT summary_json, image_hash FROM replays WHERE id = ?").bind(replayPage[1]).first<{ summary_json: string; image_hash: string | null }>();
        if (!row || !page.headers.get("content-type")?.includes("text/html")) return page;
        const meta = replayMeta(JSON.parse(row.summary_json), request.url, row.image_hash);
        return new HTMLRewriter()
          .on("title", { element: el => { el.setInnerContent(meta.title); } })
          .on('meta[property="og:title"], meta[name="twitter:title"]', { element: el => { el.setAttribute("content", meta.title); } })
          .on('meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]', { element: el => { el.setAttribute("content", meta.description); } })
          .on('meta[property="og:url"]', { element: el => { el.setAttribute("content", meta.url); } })
          .on('meta[property="og:image"], meta[name="twitter:image"]', { element: el => { if (meta.image) el.setAttribute("content", meta.image); } })
          .transform(page);
      } catch {
        console.error(JSON.stringify({ event: "replay_preview_failed", id: replayPage[1] }));
        return page;
      }
    }
    if (!url.pathname.startsWith(`${publishedApi}/`)) return env.ASSETS.fetch(request);
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
