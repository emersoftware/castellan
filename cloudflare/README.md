# Public site

Cloudflare Worker `age-of-agents` serves the React build at
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
application. Repeat publication updates changed rows without duplicating matches;
unchanged rows are not rewritten. It does not delete previously published games.
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
with properly escaped JSON through Wrangler. A statement larger than D1's
100,000-byte SQL limit is rejected before any upload; larger future recordings
will need a parameterized importer (D1 itself allows rows up to 2 MB).

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
