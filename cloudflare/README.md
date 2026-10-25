# Public site

The Cloudflare Worker `castellan` serves the React build at
https://rts.emersoftware.cl. D1 stores the catalogue and the complete replay
JSON. Games and agents still run on the local Fastify server.

## Update the landing in one command

`packages/web/src/featured.json` selects the hero FFA, duel and 2v2. Both the
hero builder and the battle cards read it. Omitted options retain their current IDs.

```sh
# Verify all three recordings without writing files or contacting Cloudflare.
pnpm landing:update --teams NEW_ID --replay-dir /path/to/replays --dry-run

# Prepare the selection and hero locally for review.
pnpm landing:update --teams NEW_ID --replay-dir /path/to/replays

# Build, publish the three selected recordings, deploy and verify the public result.
pnpm landing:update --teams NEW_ID --replay-dir /path/to/replays --deploy
```

Use `--hero ID` and `--duel ID` to replace those slots too. The default archive
is `REPLAY_DIR` or `~/.local/share/castellan/replays`. Editorial titles remain in
`cloudflare/titles.json`; without one, publication generates a player/map title.

Before any writes, the command checks current rules, the slot's player/team
counts, harness metadata and running decisions for every seat, absence of
recorded operational failures or premature harness stops, and strict replay
hashes and outcomes. It re-simulates the three games sequentially; verification
still takes time. Unrelated archive files are not parsed.

Local preparation installs the public projection of the hero (no private
experiment metadata), switches the selection, then builds the hero frames.
Unchanged files and cached hero frames are reused. Old hero files remain available.
Deployment builds and typechecks before remote writes, publishes only the selected
IDs, compares their public payloads and summaries, deploys, then checks the public
entry bundle and hero manifest against the local build. It does not launch games,
commit or push. Review and commit the resulting selection and generated assets
through the normal repository workflow.

Any failure stops the command without automatic retries. Prepared files remain
for inspection; a failure after data publication can leave the new replays in the
catalogue while the previous landing remains deployed. Publication is additive
and repeatable. If public verification sees a stale API cache, wait for its
60-second expiry and rerun explicitly.

## Publish from this computer

```sh
pnpm publish:replays --dry-run  # validate and preview counts; no remote writes
pnpm publish:replays           # publish finished agent games and complete series
pnpm publish:replays --only 02eb6795 --version v26 # publish just this selected battle
pnpm cloud:deploy                   # rebuild and deploy the website/Worker
pnpm cloud:verify https://rts.emersoftware.cl  # compare every public replay with local data
pnpm cloud:verify https://rts.emersoftware.cl --only ID1,ID2 # verify a curated release
```

Publishing data needs no website rebuild. The commands use the current
Wrangler login. The web application has no publishing credentials or write endpoints.
Publication reads what D1 holds, then uploads only new or changed battles.
It never rewrites unchanged rows or deletes published games.
Public API caches expire within 60 seconds.

Use `--only <id,...>` for curated releases. Without it, publication includes every
eligible local recording, even old games removed from the public catalog.
The selected IDs must exist and be publishable. A series goes in only when
you select all its games. Add `--dry-run` to preview the selection.

The source is the local replay archive (`~/.local/share/castellan/replays/*.json.gz`,
or `REPLAY_DIR`); `cloudflare/titles.json` holds editorial titles. A battle is dated by
when its match ended. The importer skips built-in bots (also by their bare names)
and `demo:*` recordings. It rebuilds a series only from all 3 finished portable
replays, never from private checkpoint files, because those contain tokens.
Published replays include their recorded chat and scripts, like the local viewer.

Editorial titles live in `cloudflare/titles.json`, keyed by replay or series ID.
They override bundled titles and survive repeat publication. A new recording
without an editorial title gets a descriptive player/map title automatically.

The importer validates the whole input before uploading. It sends SQL files
with properly escaped JSON through Wrangler. D1 caps 1 imported statement at
100 KB and 1 row at 2 MB. So each replay payload goes into ordered ~80 KB pieces
(`replay_chunks`) that the Worker joins on read. Any size of recording publishes.

The battles page lists every rules version with a version selector. The
browser re-simulates each replay with the current engine. The engine keeps older rules,
because ruleset fields gate behaviour changes. A replay that no longer matches its
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

`pnpm build:cloudflare` selects `.env.cloudflare` and the `/api/*` read API,
writing `packages/web/dist-cloudflare`, which Wrangler serves and deploys.
The ordinary `pnpm build` writes `packages/web/dist`. Cloudflare builds therefore
leave an existing local server (including a tunnel) on its local API configuration.
`pnpm server` and `pnpm web` keep local match hosting.
`.assetsignore` keeps the asset build's signature file out of Cloudflare uploads.
The public site reads its catalogue and replays only from D1. Static Assets serves
SPA deep links. Missing API records return JSON 404s.

`wrangler.jsonc` holds the D1 ID and the custom domain. Run `wrangler whoami` before
deploying from another computer. To revert a Worker deployment, run
`pnpm exec wrangler rollback`. It does not roll back D1 data or migrations.
