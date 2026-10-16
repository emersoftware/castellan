const featured = "featured";

/** Where finished matches are kept, from the repo root: the server's own archive and the copies bundled with the site (served at `featuredUrl`). Each lists its matches in `index`. */
export const replayArchive = { local: "replays", featured: `packages/web/public/${featured}`, featuredUrl: `/${featured}`, index: "index.json" };
