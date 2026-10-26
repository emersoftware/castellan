/** Opening rooms and series. A new room answers with its players' tokens and its host's spectator link. */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { BOTS } from "@castellan/bots";
import { MAPS, isRoomMode, routes, type KindSpec, type RoomMode, type Ruleset } from "@castellan/shared";
import type { serverAnalytics } from "../analytics";
import type { ReplayArchive } from "../archive";
import { agentConfiguration } from "../experiment";
import { Room, type RoomOptions } from "../room";
import type { Rooms } from "../rooms";
import type { SeriesStore } from "../series";
import { int } from "./query";

export interface LobbyOptions {
  rooms: Rooms;
  series: SeriesStore;
  archive: ReplayArchive;
  analytics: ReturnType<typeof serverAnalytics>;
  /** The server's rules and its defaults for a room's clock and preparation. */
  ruleset: Ruleset;
  tickRate?: number;
  prepMs?: number;
  customStats?: boolean;
}

export const lobbyRoutes: FastifyPluginAsync<LobbyOptions> = async (app, { rooms, series, archive, analytics, ruleset, tickRate, prepMs, customStats }) => {
  const createRoom = async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as {
      players?: { name?: string; bot?: string; team?: number; agent?: unknown }[]; seed?: number; prepMs?: number; tickRate?: number; botLatencyMs?: number;
      map?: string; sides?: "random" | "fixed"; chat?: boolean; mode?: RoomMode;
      stats?: { label: string; kinds: Record<string, Record<string, unknown>>; upgrades: Ruleset["upgrades"] };
    };
    // Experiments only (`customStats`): play today's engine with another version's stats.
    if (body.stats && !customStats) return reply.code(400).send({ error: "custom stats are disabled on this server" });
    const map = MAPS[body.map ?? "open"];
    if (!map) return reply.code(400).send({ error: `unknown map ${body.map}; available: ${Object.keys(MAPS).join(", ")}` });
    if (body.mode !== undefined && !isRoomMode(body.mode)) return reply.code(400).send({ error: 'mode must be "teams" or "ffa"' });
    if (body.mode === "ffa" && body.players?.some((p) => p.team !== undefined)) return reply.code(400).send({ error: "ffa does not accept teams" });
    // Four-seat maps support 2v2 (default), four-player FFA, or an explicit
    // three-player FFA with one empty corner. Other lobby defaults stay full.
    const seats = map.seats ?? 2;
    if (seats === 6 && (body.mode === "teams" || body.players?.some(p => p.team !== undefined))) {
      return reply.code(400).send({ error: "6-seat maps support free-for-all only" });
    }
    if (seats === 6 && body.players && body.players.length !== seats) {
      return reply.code(400).send({ error: "6-seat maps need exactly six players (or omit players for six empty seats)" });
    }
    const mode = body.mode ?? (seats === 6 ? "ffa" : undefined);
    const playerCount = seats === 4 && body.mode === "ffa" && body.players?.length === 3 ? 3 : seats;
    let players;
    try { players = (body.players ?? []).slice(0, seats).map((p, i) => ({
      name: String(p.name ?? p.bot ?? `player${i + 1}`).slice(0, 32), bot: p.bot, team: seats === 4 ? p.team : undefined,
      agent: p.agent === undefined ? undefined : agentConfiguration(p.agent),
    })); } catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
    while (players.length < playerCount) players.push({ name: `player${players.length + 1}`, bot: undefined, team: undefined, agent: undefined });
    if (seats === 4 && players.some((p) => p.team !== undefined)) {
      const count = (t: number) => players.filter((p) => p.team === t).length;
      if (count(0) !== 2 || count(1) !== 2) return reply.code(400).send({ error: "4-seat maps are 2v2: give two players team 0 and two team 1 (or no teams: list order)" });
    }
    for (const p of players) if (p.bot && !BOTS[p.bot]) return reply.code(400).send({ error: `unknown bot ${p.bot}; available: ${Object.keys(BOTS).join(", ")}` });
    const config: Omit<RoomOptions, "onFinish"> = {
      ruleset: { ...(body.stats ? withStats(ruleset, body.stats) : ruleset), map },
      players,
      mode,
      sides: body.sides === "fixed" ? "fixed" : "random",
      chat: body.chat !== false,
      seed: int(body.seed, Math.floor(Math.random() * 2 ** 31)),
      tickRate: int(body.tickRate, tickRate ?? 10),
      prepMs: int(body.prepMs, prepMs ?? ruleset.prepMs),
      botLatencyMs: int(body.botLatencyMs, 3000),
    };
    const properties = { map: map.name, mode: mode ?? (seats === 4 ? "teams" : "duel"), player_count: players.length, rules_version: config.ruleset.version };
    if (req.routeOptions.url === routes.series) {
      const created = await series.create(config);
      analytics.capture(req, "series_created", `series:${created.id}`, { ...properties, series_id: created.id });
      return created;
    }
    const room = await Room.create({ ...config, onFinish: (replay) => archive.save(replay) });
    rooms.add(room);
    analytics.capture(req, "match_created", `room:${room.id}`, { ...properties, room_id: room.id });
    return {
      ...room.summary(),
      players: room.players.map((p) => ({ id: p.id, name: p.name, bot: p.bot?.name, side: p.side, team: p.team, token: p.bot ? undefined : p.token })),
      watch: `/watch/${room.id}#spectator=${room.spectatorToken}`,
    };
  };
  app.post(routes.rooms, createRoom);
  app.post(routes.series, createRoom);
};

/** Numbers that describe a kind; everything else (capabilities, symbols) stays as today. */
const STATS: (keyof KindSpec)[] = ["hp", "def", "atk", "range", "minRange", "vision", "moveMs", "attackMs", "cost", "aimMs", "trainMs", "buildMs", "requires"];

/** Today's rules with another version's unit stats and research (for experiments). */
function withStats(r: Ruleset, stats: { label: string; kinds: Record<string, Record<string, unknown>>; upgrades: Ruleset["upgrades"] }): Ruleset {
  // A kind the version didn't have (e.g. doors before v7) keeps today's stats.
  const kinds = Object.fromEntries(Object.entries(r.kinds).map(([k, spec]) => {
    if (!stats.kinds[k]) return [k, spec];
    const own: Record<string, unknown> = { ...spec };
    for (const f of STATS) delete own[f];
    return [k, { ...own, ...(stats.kinds[k] ?? {}) }];
  })) as unknown as Ruleset["kinds"];
  return { ...r, version: `${r.version}+stats:${String(stats.label).slice(0, 40)}`, kinds, upgrades: stats.upgrades };
}
