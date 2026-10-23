import { publishedRoutes, routes, type MatchStatus, type Outcome, type PlayerTiming, type ReplayFile, type ReplayPlayerSummary, type RoomMode, type SeriesReplay, type SeriesSummary } from "@castellan/shared";
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
  /** Recorded by your local server, or published to D1. */
  source: "local" | "published";
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new Error(`${res.status} ${res.url}`);
  return res.json() as Promise<T>;
}

/** Per player, per kind: the script it runs (null for a kind without one). */
export type LiveScripts = Record<string, Record<string, { code: string; custom: boolean } | null>>;

export const api = {
  /** A recorded match bundled with the landing, also available without an API. */
  showcase: (id: string) => fetch(`/showcase/${id}.json`).then((r) => json<ReplayFile>(r)),
  series: () => apiFetch(seriesPath()).then((r) => json<SeriesSummary[]>(r)),
  seriesSummary: (id: string) => apiFetch(`${seriesPath()}/${id}`).then((r) => json<SeriesSummary>(r)),
  seriesReplay: (id: string) => apiFetch(`${seriesPath()}/${id}/replay.json`).then((r) => json<SeriesReplay>(r)),
  room: (id: string) => apiFetch(`${routes.rooms}/${id}`).then((r) => json<RoomSummary>(r)),
  /** Live room: the code each player's scriptable kinds run now. */
  roomScripts: (id: string) => apiFetch(`${routes.rooms}/${id}/scripts`, { headers: spectatorToken() ? { authorization: `Bearer ${spectatorToken()}` } : {} }).then((r) => json<LiveScripts>(r)),

  /** Whether the catalogue grows while you watch: a local server records battles and series games; the published one changes only when replays are published. */
  liveCatalogue: () => !published(),
  /** The published catalogue on the public site, your local server's archive otherwise. Only the battles the catalog lists. */
  async replays(): Promise<ReplaySummary[]> {
    const source = published() ? "published" as const : "local" as const;
    const entries = await apiFetch(published() ? publishedRoutes.replays : routes.replays).then((r) => json<Omit<ReplaySummary, "source">[]>(r))
      .catch((error: Error) => { throw published() ? error : new Error(`Battle catalogue unavailable: ${error.message}`); });
    return catalogBattles(entries.map((entry) => ({ ...entry, source })));
  },

  replay: (id: string) => apiFetch(`${published() ? publishedRoutes.replays : routes.replays}/${id}`).then((r) => json<ReplayFile>(r)),
};

export function spectateUrl(id: string) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${routes.spectate}/${id}${spectatorToken() ? `?spectator=${encodeURIComponent(spectatorToken()!)}` : ""}`;
}

/** The host capability is in the fragment, so it is not sent in page requests/referrers. */
function spectatorToken(): string | null {
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
