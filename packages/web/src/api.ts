import { publishedRoutes, replayArchive, routes, type MatchStatus, type Outcome, type PlayerTiming, type ReplayFile, type ReplayPlayerSummary, type RoomMode, type SeriesReplay, type SeriesSummary } from "@castellan/shared";
import { analyticsHeaders } from "./analytics";
import { catalogBattles } from "./replayCatalog";

/** Only send browser identity to our API, never to third-party/static URLs. */
function apiFetch(path: string, init?: RequestInit) {
  const identity = analyticsHeaders();
  if (!Object.keys(identity).length) return init ? fetch(path, init) : fetch(path);
  const headers = new Headers(identity);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  return fetch(path, { ...init, headers });
}

const published = () => import.meta.env.VITE_PUBLIC_REPLAYS === "true";
const seriesPath = () => published() ? publishedRoutes.series : routes.series;

export interface RoomSummary {
  id: string;
  status: MatchStatus;
  tick: number;
  timeMs: number;
  createdAt: string;
  prepEndsAt?: string;
  map?: string;
  mode?: RoomMode;
  chat?: boolean;
  timing?: Record<string, PlayerTiming>;
  players: { id: string; name: string; bot?: string; connected: boolean; token?: string; side?: number; team?: number }[];
  outcome?: Outcome;
}

export interface ReplaySummary {
  id: string;
  title?: string;
  createdAt: string;
  /** Modification time of the original replay file, captured before bundling. */
  savedAt?: string;
  players: (ReplayPlayerSummary & { bot?: string })[];
  outcome: Outcome;
  finalTick: number;
  tickRate: number;
  map?: string;
  rulesVersion?: string;
  /** Bundled locally, recorded by the local server, or published to D1. */
  source: "featured" | "local" | "published";
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new Error(`${res.status} ${res.url}`);
  return res.json() as Promise<T>;
}

/** A replay dropped into the page (never uploaded anywhere). */
let dropped: ReplayFile | null = null;
let droppedSeries: SeriesReplay | null = null;
export function setDroppedReplay(r: ReplayFile) {
  dropped = r;
}
export function setDroppedSeries(r: SeriesReplay) { droppedSeries = r; }

/** Per player, per kind: the script it runs (null for a kind without one). */
export type LiveScripts = Record<string, Record<string, { code: string; custom: boolean } | null>>;

export const api = {
  /** A recorded match bundled with the landing, also available without an API. */
  showcase: (id: string) => fetch(`/showcase/${id}.json`).then((r) => json<ReplayFile>(r)),
  series: () => apiFetch(seriesPath()).then((r) => json<SeriesSummary[]>(r)),
  seriesSummary: (id: string) => id === "dropped" && droppedSeries ? Promise.resolve(droppedSeries.series) : apiFetch(`${seriesPath()}/${id}`).then((r) => json<SeriesSummary>(r)),
  seriesReplay: (id: string) => id === "dropped" && droppedSeries ? Promise.resolve(droppedSeries) : apiFetch(`${seriesPath()}/${id}/replay.json`).then((r) => json<SeriesReplay>(r)),
  room: (id: string) => apiFetch(`${routes.rooms}/${id}`).then((r) => json<RoomSummary>(r)),
  /** Live room: the code each player's scriptable kinds run now. */
  roomScripts: (id: string) => apiFetch(`${routes.rooms}/${id}/scripts`, { headers: spectatorToken() ? { authorization: `Bearer ${spectatorToken()}` } : {} }).then((r) => json<LiveScripts>(r)),

  /** Featured replays ship with the site; a local server adds yours. Only the battles the catalog lists. */
  async replays(): Promise<ReplaySummary[]> {
    if (published()) {
      const entries = await apiFetch(publishedRoutes.replays).then((r) => json<Omit<ReplaySummary, "source">[]>(r));
      return catalogBattles(entries.map((entry) => ({ ...entry, source: "published" as const })));
    }
    const responses = await Promise.allSettled([
      fetch(`${replayArchive.featuredUrl}/${replayArchive.index}`).then(r => json<Omit<ReplaySummary, "source">[]>(r)),
      apiFetch(routes.replays).then(r => json<Omit<ReplaySummary, "source">[]>(r)),
    ]);
    if (responses.every(r => r.status === "rejected")) throw new Error("Battle catalogue unavailable");
    const featured = responses[0].status === "fulfilled" ? responses[0].value.map(x => ({ ...x, source: "featured" as const })) : [];
    const local = responses[1].status === "fulfilled" ? responses[1].value.map(x => ({ ...x, source: "local" as const })) : [];
    const seen = new Set(featured.map((f) => f.id));
    return catalogBattles([...featured, ...local.filter((l) => !seen.has(l.id))]);
  },

  async replay(id: string): Promise<ReplayFile> {
    const seriesGame = droppedSeries?.games.find((g) => g.id === id);
    if (seriesGame) return seriesGame;
    if (id === "dropped") {
      if (!dropped) throw new Error("no replay file loaded");
      return dropped;
    }
    if (published()) return apiFetch(`${publishedRoutes.replays}/${id}`).then((r) => json<ReplayFile>(r));
    try {
      return await fetch(`${replayArchive.featuredUrl}/${id}.json`).then((r) => json<ReplayFile>(r));
    } catch {
      return apiFetch(`${routes.replays}/${id}`).then((r) => json<ReplayFile>(r));
    }
  },
};

/** Reads a replay file (.json or .json.gz) chosen or dropped by the user. */
export async function readReplayFile(file: File): Promise<ReplayFile | SeriesReplay> {
  let text: string;
  if (file.name.endsWith(".gz")) {
    const stream = file.stream().pipeThrough(new DecompressionStream("gzip"));
    text = await new Response(stream).text();
  } else text = await file.text();
  const r = JSON.parse(text) as ReplayFile | SeriesReplay;
  if (r.format === "castellan-series-v1") {
    if (r.series?.totalGames !== 3 || r.series.status !== "finished" || !Array.isArray(r.games) || r.games.length !== 3 || r.games.some((g) => g.format !== 1 || !Array.isArray(g.orders))) throw new Error("not a complete three-game series replay");
    return r;
  }
  if (r.format !== 1 || !Array.isArray(r.orders)) throw new Error("not an Castellan replay");
  return r;
}

export function spectateUrl(id: string) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${routes.spectate}/${id}${spectatorToken() ? `?spectator=${encodeURIComponent(spectatorToken()!)}` : ""}`;
}

/** The host capability is in the fragment, so it is not sent in page requests/referrers. */
export function spectatorToken(): string | null {
  return new URLSearchParams(location.hash.slice(1)).get("spectator");
}

export const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Each player's colour index (0 blue, 1 red, 2 verdigris, 3 amethyst): its place in the list, as in AoE. */
export function playerColors(players: { id: string }[]): Record<string, number> {
  return Object.fromEntries(players.map((p, i) => [p.id, i % 4]));
}

/** The winning players (empty = no winner), for outcomes with or without teams. */
export function winnersOf(o: Outcome): string[] {
  return o.winners ?? (o.winner ? [o.winner] : []);
}
