/**
 * The HTTP API: the only contract between the game and its players. Connectors
 * (MCP, CLI, anything else) are thin clients of these routes.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { transform } from "esbuild";
import { validateScript } from "@aoa/sandbox";
import { mapsForRuleset, playerGuide, v9, viewToText, type Order, type ReplayFile, type Ruleset } from "@aoa/shared";
import { BOTS } from "@aoa/sim";
import { Room } from "./room";
import { SeriesStore, type HistorySection } from "./series";

export interface ServerOptions {
  replayDir: string;
  /** Built web client to serve at `/` (optional). */
  webDir?: string;
  ruleset?: Ruleset;
  tickRate?: number;
  prepMs?: number;
  logger?: boolean;
}

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const ruleset = opts.ruleset ?? v9;
  const maps = mapsForRuleset(ruleset);
  const rooms = new Map<string, Room>();
  const tokens = new Map<string, { room: Room; player: string }>();
  await mkdir(opts.replayDir, { recursive: true });
  const register = (room: Room) => {
    rooms.set(room.id, room);
    for (const p of room.players) tokens.set(p.token, { room, player: p.id });
  };
  const series = new SeriesStore(join(opts.replayDir, "series"), register, (replay) => saveReplay(opts.replayDir, replay));
  await series.load();

  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 64 * 1024 });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  const auth = (req: FastifyRequest, reply: FastifyReply) => {
    const h = req.headers.authorization ?? "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : ((req.query as Record<string, string>)?.token ?? "");
    const who = tokens.get(token);
    if (!who) {
      reply.code(401).send({ error: "missing or invalid token (Authorization: Bearer <token>)" });
      return null;
    }
    who.room.touch(who.player);
    who.room.beginCall(who.player);
    (req as FastifyRequest & { aoa?: typeof who }).aoa = who;
    return who;
  };
  // Every answered call closes the player's timing window (see Room.beginCall).
  app.addHook("onResponse", async (req) => {
    const who = (req as FastifyRequest & { aoa?: { room: Room; player: string }; waitedMs?: number }).aoa;
    if (who) who.room.endCall(who.player, (req as FastifyRequest & { waitedMs?: number }).waitedMs ?? 0);
  });
  const int = (v: unknown, fallback: number) => (v === undefined || v === "" || !Number.isFinite(Number(v)) ? fallback : Math.trunc(Number(v)));
  const wantsText = (req: FastifyRequest) => (req.query as Record<string, string>)?.format === "text";

  // ───────────────────────── lobby ─────────────────────────

  app.get("/health", async () => ({ ok: true }));

  const createRoom = async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as {
      players?: { name?: string; bot?: string; team?: number }[]; seed?: number; prepMs?: number; tickRate?: number; botLatencyMs?: number;
      map?: string; sides?: "random" | "fixed"; chat?: boolean; mode?: "teams" | "ffa";
    };
    const map = maps[body.map ?? "open"];
    if (!map) return reply.code(400).send({ error: `unknown map ${body.map}; available: ${Object.keys(maps).join(", ")}` });
    if (body.mode !== undefined && body.mode !== "teams" && body.mode !== "ffa") return reply.code(400).send({ error: 'mode must be "teams" or "ffa"' });
    if (body.mode === "ffa" && body.players?.some((p) => p.team !== undefined)) return reply.code(400).send({ error: "ffa does not accept teams" });
    // One player per seat; four-seat maps support 2v2 (default) or free-for-all.
    const seats = map.seats ?? 2;
    const players = (body.players ?? []).slice(0, seats).map((p, i) => ({
      name: String(p.name ?? p.bot ?? `player${i + 1}`).slice(0, 32), bot: p.bot, team: seats === 4 ? p.team : undefined,
    }));
    while (players.length < seats) players.push({ name: `player${players.length + 1}`, bot: undefined, team: undefined });
    if (seats === 4 && players.some((p) => p.team !== undefined)) {
      const count = (t: number) => players.filter((p) => p.team === t).length;
      if (count(0) !== 2 || count(1) !== 2) return reply.code(400).send({ error: "4-seat maps are 2v2: give two players team 0 and two team 1 (or no teams: list order)" });
    }
    for (const p of players) if (p.bot && !BOTS[p.bot]) return reply.code(400).send({ error: `unknown bot ${p.bot}; available: ${Object.keys(BOTS).join(", ")}` });
    const config = {
      ruleset: { ...ruleset, map },
      players,
      mode: body.mode,
      sides: body.sides === "fixed" ? "fixed" as const : "random" as const,
      chat: body.chat === true,
      seed: int(body.seed, Math.floor(Math.random() * 2 ** 31)),
      tickRate: int(body.tickRate, opts.tickRate ?? 10),
      prepMs: int(body.prepMs, opts.prepMs ?? ruleset.prepMs),
      botLatencyMs: int(body.botLatencyMs, 3000),
    };
    if (req.routeOptions.url === "/series") return series.create(config);
    const room = await Room.create({ ...config, onFinish: (replay) => void saveReplay(opts.replayDir, replay) });
    register(room);
    return {
      ...room.summary(),
      players: room.players.map((p) => ({ id: p.id, name: p.name, bot: p.bot?.name, side: p.side, team: p.team, token: p.bot ? undefined : p.token })),
      watch: `/watch/${room.id}`,
    };
  };
  app.post("/rooms", createRoom);
  app.post("/series", createRoom);
  app.get("/series", async () => series.list());
  app.get("/series/current", async (req, reply) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    return series.current(token) ?? reply.code(401).send({ error: "a valid series participant token is required" });
  });
  app.get("/series/:id", async (req, reply) => series.summary((req.params as { id: string }).id) ?? reply.code(404).send({ error: "no such series" }));
  app.get("/series/:id/replay.json", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!series.summary(id)) return reply.code(404).send({ error: "no such series" });
    return series.replay(id) ?? reply.code(409).send({ error: "series replay is available after all three games finish" });
  });

  app.get("/maps", async () => Object.values(maps).map(({ name, description, width, height, walls, seats }) => ({ name, description, width, height, walls, players: seats ?? 2 })));

  app.get("/rooms", async () => [...rooms.values()].map((r) => r.summary()).reverse());

  app.get("/rooms/:id", async (req, reply) => {
    const room = rooms.get((req.params as { id: string }).id);
    return room ? room.summary() : reply.code(404).send({ error: "no such room" });
  });

  app.get("/replays", async () => readIndex(opts.replayDir));

  app.get("/replays/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!/^[\w-]+$/.test(id)) return reply.code(400).send({ error: "bad id" });
    const file = join(opts.replayDir, `${id}.json.gz`);
    if (!existsSync(file)) return reply.code(404).send({ error: "no such replay" });
    reply.header("content-type", "application/json");
    return gunzipSync(await readFile(file)).toString("utf8");
  });

  app.get("/spectate/:id", { websocket: true }, (socket, req) => {
    const room = rooms.get((req.params as { id: string }).id);
    if (!room) return socket.close(4404, "no such room");
    const off = room.addSpectator({ send: (m) => socket.readyState === 1 && socket.send(JSON.stringify(m)) });
    socket.on("close", off);
  });

  // ───────────────────────── players ─────────────────────────

  // With a token: the rules of that player's room (its map). Without: the defaults.
  app.get("/rules", async (req) => {
    const h = req.headers.authorization ?? "";
    const room = tokens.get(h.startsWith("Bearer ") ? h.slice(7) : "")?.room;
    const r = room?.ruleset ?? ruleset;
    const guide = playerGuide(r, { chat: room?.chat ?? false, teams: room?.teams, series: room?.seriesProgress?.(), tickRate: room?.tickRate ?? opts.tickRate ?? 10 });
    if (wantsText(req)) return guide;
    return { ruleset: r, guide };
  });

  app.get("/state", async (req, reply) => {
    const who = auth(req, reply);
    if (!who) return;
    const q = req.query as Record<string, string>;
    const v = who.room.view(who.player, q.since === undefined ? undefined : int(q.since, 0));
    return wantsText(req) ? viewToText(v) : v;
  });

  app.get("/history", async (req, reply) => {
    const who = auth(req, reply);
    if (!who) return;
    const q = req.query as Record<string, string>;
    const section = q.section ?? "summary";
    if (!["summary", "events", "chat", "scripts", "orders"].includes(section)) return reply.code(400).send({ error: "section must be summary, events, chat, scripts or orders" });
    const game = q.game === undefined ? undefined : Number(q.game);
    const offset = q.offset === undefined ? 0 : Number(q.offset);
    const limit = q.limit === undefined ? 50 : Number(q.limit);
    if ((game !== undefined && (!Number.isInteger(game) || game < 1 || game > 3)) || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) return reply.code(400).send({ error: "game must be 1..3, offset >= 0, limit 1..100 (integers)" });
    try {
      const history = await series.history(who.room.id, who.player, game, section as HistorySection, offset, limit);
      return wantsText(req) ? JSON.stringify(history, null, 2) : history;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("only completed previous")) return reply.code(403).send({ error: error.message });
      throw error;
    }
  });

  app.post("/act", async (req, reply) => {
    const who = auth(req, reply);
    if (!who) return;
    const body = req.body as { orders?: unknown; since?: number } | undefined;
    const orders = Array.isArray(body?.orders) ? (body!.orders as Order[]).slice(0, 50) : null;
    if (!orders) return reply.code(400).send({ error: 'body must be {"orders":[...]} (max 50)' });
    const scripts = await Promise.all(orders.map((o) => (o?.type === "script" ? prepareScript(o.code, "js", ruleset) : null)));
    const prepared = orders.map((o, i) => (scripts[i]?.ok ? { ...o, code: scripts[i]!.code } : o)) as Order[];
    const { results, tick } = await who.room.act(who.player, prepared);
    const view = who.room.view(who.player, body?.since);
    const capital = { spent: results.reduce((n, r) => n + (r.capital?.spent ?? 0), 0), remaining: view.players.find((p) => p.id === who.player)!.capital };
    const line = results.map((r, i) => `order ${i}: ${r.ok ? "ok" + ("id" in r && r.id ? " " + r.id : "") : "FAILED " + r.reason}${r.capital ? ` · capital spent ${r.capital.spent}, remaining ${r.capital.remaining}${r.capital.pending !== undefined ? ` · build cost ${r.capital.pending} pending until completion` : ""}` : ""}`).join("\n");
    return wantsText(req) ? `${line}\ncapital spent by these orders: ${capital.spent} · remaining now: ${capital.remaining}\n\n${viewToText(view)}` : { results, capital, view };
  });

  app.get("/chat", async (req, reply) => {
    const who = auth(req, reply);
    if (!who) return;
    const log = who.room.conversation(who.player);
    if (!wantsText(req)) return { chat: who.room.chat, messages: log };
    if (!who.room.chat) return "chat is off in this room";
    return log.length ? log.map((m) => `[${m.tick}] ${m.from} ${m.name}${m.from === who.player ? " (you)" : ""}${m.channel === "private" ? ` [private to ${m.to}]` : m.channel === "team" ? " [team]" : ""}: ${m.text}`).join("\n") : "no messages yet";
  });

  app.post("/chat", async (req, reply) => {
    const who = auth(req, reply);
    if (!who) return;
    const { text, channel, to } = (req.body as { text?: unknown; channel?: unknown; to?: unknown } | undefined) ?? {};
    if (typeof text !== "string") return reply.code(400).send({ error: 'body must be {"text":"..."} (max 200 chars)' });
    if (channel !== undefined && channel !== "all" && channel !== "team" && channel !== "private") return reply.code(400).send({ error: 'channel must be "all", "team" or "private"' });
    if (to !== undefined && (typeof to !== "string" || !to.length || to.length >= 64)) return reply.code(400).send({ error: "to must be a player id" });
    const { results } = await who.room.act(who.player, [{ type: "chat", text, channel, to }]);
    const r = results[0];
    return answer(req, reply, who, r.ok ? "message sent" : `FAILED ${r.reason}`, { ok: r.ok, error: r.ok ? undefined : r.reason }, r.ok ? 200 : 400);
  });

  app.get("/scripts/:kind", async (req, reply) => {
    const who = auth(req, reply);
    if (!who) return;
    const s = who.room.script(who.player, (req.params as { kind: string }).kind);
    return s ?? reply.code(404).send({ error: "that kind is not scriptable" });
  });

  app.put("/scripts/:kind", async (req, reply) => {
    const who = auth(req, reply);
    if (!who) return;
    const kind = (req.params as { kind: string }).kind;
    const body = (req.body ?? {}) as { code?: unknown; lang?: string };
    if (body.code !== null && typeof body.code !== "string") return reply.code(400).send({ error: 'body must be {"code":"...","lang":"js"|"ts"} (code null = default)' });
    const prepared = body.code === null ? { ok: true as const, code: null } : await prepareScript(body.code, body.lang === "ts" ? "ts" : "js", ruleset);
    if (!prepared.ok) return reply.code(400).send({ ok: false, error: prepared.error });
    const { results, tick } = await who.room.act(who.player, [{ type: "script", kind, code: prepared.code }]);
    const r = results[0];
    const line = r.ok ? `${kind} script ${prepared.code === null ? "reset to default" : "uploaded"}, applied at tick ${tick}` : `FAILED ${r.reason}`;
    return answer(req, reply, who, line, { ok: r.ok, error: r.ok ? undefined : r.reason, appliedAt: r.ok ? tick : undefined }, r.ok ? 200 : who.room.state === "running" ? 400 : 409);
  });

  app.get("/wait", async (req, reply) => {
    const who = auth(req, reply);
    if (!who) return;
    const q = req.query as Record<string, string>;
    const since = int(q.since, who.room.cursor(who.player));
    const maxMs = Math.min(30, Math.max(0, int(q.max, 20))) * 1000;
    const started = Date.now();
    await who.room.wait(who.player, since, maxMs, q.until ? q.until.split(",") : null);
    (req as FastifyRequest & { waitedMs?: number }).waitedMs = Date.now() - started;
    const v = who.room.view(who.player, since);
    return wantsText(req) ? viewToText(v) : v;
  });

  /** Actions return their result and the current player view. */
  function answer(req: FastifyRequest, reply: FastifyReply, who: { room: Room; player: string }, line: string, body: object, code: number) {
    const view = who.room.view(who.player);
    reply.code(code);
    return wantsText(req) ? `${line}\n\n${viewToText(view)}` : { ...body, view };
  }

  // ───────────────────────── web client ─────────────────────────

  if (opts.webDir && existsSync(opts.webDir)) {
    await app.register(fastifyStatic, { root: opts.webDir, wildcard: true });
    app.setNotFoundHandler((req, reply) => (req.method === "GET" && !req.url.startsWith("/api") ? reply.sendFile("index.html") : reply.code(404).send({ error: "not found" })));
  }

  app.addHook("onClose", async () => {
    await series.close();
    for (const r of rooms.values()) r.close();
  });
  return app;
}

/** Strips TypeScript types (never type-checks) and compile-checks the result. */
async function prepareScript(code: string | null, lang: "js" | "ts", ruleset: Ruleset): Promise<{ ok: true; code: string | null } | { ok: false; error: string }> {
  if (code === null) return { ok: true, code: null };
  let js = code;
  if (lang === "ts") {
    try {
      const out = await transform(`(function (self: any) {\n${code}\n});`, { loader: "ts", format: "esm" });
      const m = /^\(function\s*\(self\)\s*\{\n?([\s\S]*)\n?\}\);?\s*$/.exec(out.code.trim());
      if (!m) return { ok: false, error: "could not strip TypeScript types" };
      js = m[1];
    } catch (e) {
      return { ok: false, error: String((e as Error).message).slice(0, 300) };
    }
  }
  const check = validateScript(js, ruleset.script);
  return check.ok ? { ok: true, code: js } : { ok: false, error: check.error };
}

interface ReplayIndexEntry {
  id: string;
  createdAt: string;
  players: ReplayFile["players"];
  outcome: ReplayFile["outcome"];
  finalTick: number;
  tickRate: number;
}

const replayWrites = new Map<string, Promise<void>>();
export function saveReplay(dir: string, replay: ReplayFile): Promise<void> {
  const write = (replayWrites.get(dir) ?? Promise.resolve()).catch(() => {}).then(async () => {
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${replay.id}.json.gz`);
    await writeFile(`${path}.tmp`, gzipSync(JSON.stringify(replay)));
    await rename(`${path}.tmp`, path);
    const index = (await readIndex(dir)).filter((r) => r.id !== replay.id);
    index.unshift({ id: replay.id, createdAt: replay.createdAt, players: replay.players, outcome: replay.outcome, finalTick: replay.finalTick, tickRate: replay.tickRate });
    const indexPath = join(dir, "index.json");
    await writeFile(`${indexPath}.tmp`, JSON.stringify(index, null, 1));
    await rename(`${indexPath}.tmp`, indexPath);
  });
  replayWrites.set(dir, write);
  return write;
}

async function readIndex(dir: string): Promise<ReplayIndexEntry[]> {
  try {
    return JSON.parse(await readFile(join(dir, "index.json"), "utf8"));
  } catch {
    return [];
  }
}
