import type { Outcome, PlayerTiming, ReplayFile } from "@aoa/shared";

export interface RoomSummary {
  id: string;
  status: "waiting" | "prep" | "running" | "finished";
  tick: number;
  timeMs: number;
  createdAt: string;
  prepEndsAt?: string;
  map?: string;
  mode?: "teams" | "ffa";
  chat?: boolean;
  timing?: Record<string, PlayerTiming>;
  players: { id: string; name: string; bot?: string; connected: boolean; token?: string; side?: number; team?: number }[];
  outcome?: Outcome;
}

export interface ReplaySummary {
  id: string;
  title?: string;
  createdAt: string;
  players: { id: string; name: string; team?: number }[];
  outcome: Outcome;
  finalTick: number;
  tickRate: number;
  map?: string;
  /** Where it comes from: bundled with the site, or your local server. */
  source: "featured" | "local";
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new Error(`${res.status} ${res.url}`);
  return res.json() as Promise<T>;
}

/** A replay dropped into the page (never uploaded anywhere). */
let dropped: ReplayFile | null = null;
export function setDroppedReplay(r: ReplayFile) {
  dropped = r;
}

export const api = {
  room: (id: string) => fetch(`/rooms/${id}`).then((r) => json<RoomSummary>(r)),

  /** Featured replays ship with the site; a local server adds yours. */
  async replays(): Promise<ReplaySummary[]> {
    const featured = await fetch("/featured/index.json")
      .then((r) => json<Omit<ReplaySummary, "source">[]>(r))
      .then((l) => l.map((x) => ({ ...x, source: "featured" as const })))
      .catch(() => []);
    const local = await fetch("/replays")
      .then((r) => json<Omit<ReplaySummary, "source">[]>(r))
      .then((l) => l.map((x) => ({ ...x, source: "local" as const })))
      .catch(() => []);
    const seen = new Set(featured.map((f) => f.id));
    return [...featured, ...local.filter((l) => !seen.has(l.id))];
  },

  async replay(id: string): Promise<ReplayFile> {
    if (id === "dropped") {
      if (!dropped) throw new Error("no replay file loaded");
      return dropped;
    }
    try {
      return await fetch(`/featured/${id}.json`).then((r) => json<ReplayFile>(r));
    } catch {
      return fetch(`/replays/${id}`).then((r) => json<ReplayFile>(r));
    }
  },
};

/** Reads a replay file (.json or .json.gz) chosen or dropped by the user. */
export async function readReplayFile(file: File): Promise<ReplayFile> {
  let text: string;
  if (file.name.endsWith(".gz")) {
    const stream = file.stream().pipeThrough(new DecompressionStream("gzip"));
    text = await new Response(stream).text();
  } else text = await file.text();
  const r = JSON.parse(text) as ReplayFile;
  if (r.format !== 1 || !Array.isArray(r.orders)) throw new Error("not an Age of Agents replay");
  return r;
}

export function spectateUrl(id: string) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/spectate/${id}`;
}

export const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Each player's colour index (0 blue, 1 red, 2 verdigris, 3 amethyst): its place in the list, as in AoE. */
export function playerColors(players: { id: string }[]): Record<string, number> {
  return Object.fromEntries(players.map((p, i) => [p.id, i % 4]));
}

/** The winning players (empty = draw), for outcomes with or without teams. */
export function winnersOf(o: Outcome): string[] {
  return o.winners ?? (o.winner ? [o.winner] : []);
}
