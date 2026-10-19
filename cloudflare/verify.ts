import assert from "node:assert/strict";
import { resolve } from "node:path";
import { collectPublication } from "./catalog";
import { pagePath, pages, publishedApi, publishedRoutes } from "../packages/shared/src/http";

const base = process.argv[2] ?? "http://localhost:8787";
const publication = await collectPublication(resolve(import.meta.dirname, ".."));
async function get(path: string) {
  const response = await fetch(new URL(path, base), { headers: { "cache-control": "no-cache" }, signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/, path);
  return response;
}
const replays = await (await get(publishedRoutes.replays)).json();
assert.deepEqual(replays, publication.replays.map((entry) => JSON.parse(JSON.stringify(entry.summary))));
for (let i = 0; i < publication.replays.length; i += 4) {
  await Promise.all(publication.replays.slice(i, i + 4).map(async ({ replay }) => {
    const response = await get(`${publishedRoutes.replays}/${replay.id}`);
    assert.deepEqual(await response.json(), JSON.parse(JSON.stringify(replay)), replay.id);
  }));
}
const series = await (await get(publishedRoutes.series)).json();
assert.equal(series.length, publication.series.length);
for (const { summary } of publication.series) {
  assert.deepEqual(await (await get(`${publishedRoutes.series}/${summary.id}`)).json(), summary);
  const full = await (await get(`${publishedRoutes.series}/${summary.id}/replay.json`)).json();
  assert.equal(full.format, "castellan-series-v1");
  assert.deepEqual(full.series, summary);
  assert.deepEqual(full.games.map((g: { id: string }) => g.id), summary.games.map((g) => g.roomId));
}
for (const path of [`${publishedRoutes.replays}/missing`, `${publishedRoutes.series}/missing`, `${publishedApi}/missing`]) {
  const response = await fetch(new URL(path, base));
  assert.equal(response.status, 404, path);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
}
assert.equal((await fetch(new URL(publishedRoutes.replays, base), { method: "POST", body: "{}" })).status, 405);
for (const path of [pages.home, pages.battles, pagePath(pages.replay, publication.replays[0].replay.id), pagePath(pages.seriesReplay, publication.series[0]?.summary.id ?? "missing")]) {
  const response = await fetch(new URL(path, base));
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/, path);
}
const replayURL = new URL(`${publishedRoutes.replays}/${publication.replays[0].replay.id}`, base);
const response = await fetch(replayURL);
const etag = response.headers.get("etag");
assert.ok(etag, "replay responses must expose an ETag");
// Cloudflare's outer asset cache may answer a conditional request with its
// cached 200 even when the Worker itself would return 304. Accept both while
// still requiring the validator to be present.
assert.ok([200, 304].includes((await fetch(replayURL, { headers: { "if-none-match": etag } })).status));
assert.equal((await fetch(replayURL, { method: "HEAD" })).status, 200);
console.log(`Verified ${publication.replays.length} exact replay payloads, ${publication.series.length} series, deep links, missing records, read-only API and conditional requests at ${base}.`);
