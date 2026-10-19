# Public site

Cloudflare Worker `castellan` serves the React build at
https://rts.emersoftware.cl. D1 stores both the catalogue and complete replay
JSON. Games and agents keep running on the local Fastify server.

## Publish from this computer

```sh
pnpm publish:replays --dry-run  # validate and preview counts; no remote writes
pnpm publish:replays           # publish finished agent games and complete series
pnpm publish:replays --only 02eb6795 --version v26 # publish just this selected battle
pnpm cloud:deploy                   # rebuild and deploy the website/Worker
pnpm cloud:verify https://rts.emersoftware.cl  # compare every public replay with local data
```

Publishing data does not require rebuilding the website. Commands use the current
Wrangler login; no publishing credentials or write endpoints exist in the web
application. Publication first reads what D1 holds and uploads only new or changed
battles; unchanged rows are not rewritten. It does not delete previously published games.
Public API caches expire within 60 seconds.

Use `--only <id,...>` for curated releases: publishing without it includes all
eligible local recordings, including old games removed from the public catalog.
The selected IDs must exist and be publishable; series are included only when
all their games are selected. Add `--dry-run` to preview the selection.

Sources are `replays/*.json.gz` and the existing `packages/web/public/featured`
catalogue. Local replay payloads take precedence; existing editorial titles and
original `savedAt` values are retained. Built-in bots, legacy bot names and
`demo:*` recordings are excluded. Series are reconstructed only from all three
finished portable replays, never from private checkpoint files containing tokens.
Published replays include their recorded chat and scripts, like the local viewer.

Editorial titles live in `cloudflare/titles.json`, keyed by replay or series ID.
They override bundled titles and survive repeat publication. New recordings
without an editorial title get a descriptive player/map title automatically.

The importer validates the whole input before uploading it. It uses SQL files
with properly escaped JSON through Wrangler. D1 caps one imported statement at
100 KB and a row at 2 MB, so each replay payload is stored in ordered ~80 KB pieces
(`replay_chunks`) that the Worker joins on read; any size of recording publishes.

The battles page lists every version of the rules with a version selector. The
browser re-simulates each replay with the current engine, which keeps older rules
(behaviour changes are gated by ruleset fields); a replay that no longer matches its
recorded hashes shows "desync at <tick>".

## Setup and local verification

```sh
pnpm install
pnpm exec wrangler login
pnpm cloud:migrate                 # apply versioned migrations to remote D1
pnpm exec wrangler d1 migrations apply DB --local
pnpm publish:replays --local
pnpm cloud:dev                     # independent public site, http://localhost:8787
pnpm cloud:typecheck
pnpm exec vitest run cloudflare/test packages/web/test
```

`pnpm build:cloudflare` selects `.env.cloudflare` and the `/api/*` read API.
The ordinary `pnpm build`, `pnpm server` and `pnpm web` retain local match hosting.
Static featured recordings are excluded from Cloudflare uploads by `.assetsignore`.
The public site uses D1 as its sole catalogue/replay source. SPA deep links are
served by Static Assets; missing API records return JSON 404s.

The D1 ID and custom domain are in `wrangler.jsonc`. Check `wrangler whoami` before
deploying from a different computer. To revert a Worker deployment, use
`pnpm exec wrangler rollback`; this does not roll back D1 data or migrations.
