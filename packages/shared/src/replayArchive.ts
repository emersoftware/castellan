const featured = "featured";

/** The finished matches bundled with the site, from the repo root and served at `featuredUrl`; `index` lists an archive's matches. The server's own archive is `localReplays()`. */
export const replayArchive = { featured: `packages/web/public/${featured}`, featuredUrl: `/${featured}`, index: "index.json" };
