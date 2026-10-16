/**
 * The HTTP API: the only contract between the game and its players. Connectors
 * (MCP, CLI, anything else) are thin clients of these routes.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { transform } from "esbuild";
import { MAPS, declaredAgent, playerGuide, publishedApi, replayArchive, replayPlayerSummaries, routes, rules, viewToText, type ExperimentManifest, type Order, type ReplayFile, type ReplayPlayerSummary, type Ruleset } from "@aoa/shared";
import { BOTS } from "@aoa/sim";
import { Room } from "./room";
import { SeriesStore, type HistorySection } from "./series";
import { agentConfiguration } from "./experiment";
import { runOnceIsolated, validateScriptIsolated } from "./script-isolation";

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
  const ruleset = opts.ruleset ?? rules;
  const maps = MAPS;
  const rooms = new Map<string, Room>();
  const tokens = new Map<string, { room: Room; player: string }>();
  await mkdir(opts.replayDir, { recursive: true });
  const register = (room: Room) => {
    rooms.set(room.id, room);
    for (const p of room.players) tokens.set(p.token, { room, player: p.id });
  };
  const series = new SeriesStore(join(opts.replayDir, "series"), register, (replay) => saveReplay(opts.replayDir, replay));
  await series.load();

  // Player/spectator capabilities can be in WebSocket/query URLs. Never log
  // queries, headers or bodies, including when LOG=1 enables access logging.
  const app = Fastify({ logger: opts.logger ? { serializers: { req: (req) => ({ method: req.method, url: req.url?.split("?")[0] }) } } : false, bodyLimit: 64 * 1024 });
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
    try {
      const declared = declaredAgent(req.headers);
      if (declared !== undefined) who.room.configureAgent(who.player, agentConfiguration(declared), true);
    } catch (error) { reply.code(400).send({ error: (error as Error).message }); return null; }
    who.room.touch(who.player);
    who.room.beginCall(who.player);
    Object.assign(req, { aoa: who, aoaCall: { entry: who.room.openCall(who.player, `${req.method} ${req.routeOptions.url}`), startedAt: Date.now() } });
    return who;
  };
  // Every answered call closes the player's timing window (see Room.beginCall).
  app.addHook("onResponse", async (req, reply) => {
    const who = (req as FastifyRequest & { aoa?: { room: Room; player: string }; waitedMs?: number }).aoa;
    if (who) {
      who.room.endCall(who.player, (req as FastifyRequest & { waitedMs?: number }).waitedMs ?? 0);
      const call = (req as FastifyRequest & { aoaCall: { entry: ExperimentManifest["calls"][number]; startedAt: number } }).aoaCall;
      Object.assign(call.entry, { answeredTick: who.room.tick, durationMs: Date.now() - call.startedAt, status: reply.statusCode,
        failed: reply.statusCode >= 400 || (req as FastifyRequest & { toolFailed?: boolean }).toolFailed === true });
      who.room.recordCall(call.entry);
    }
  });
  const int = (v: unknown, fallback: number) => (v === undefined || v === "" || !Number.isFinite(Number(v)) ? fallback : Math.trunc(Number(v)));
  const wantsText = (req: FastifyRequest) => (req.query as Record<string, string>)?.format === "text";

  // ───────────────────────── lobby ─────────────────────────

  app.get(routes.health, async () => ({ ok: true }));

  // Harness metadata must not connect/start a player or consume its observation cursor.
  app.post(routes.agentConfig, async (req, reply) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const who = tokens.get(token);
    if (!who) return reply.code(401).send({ error: "a valid player token is required" });
    if (who.room.state === "finished") return reply.code(409).send({ error: "match over" });
    try { who.room.configureAgent(who.player, agentConfiguration(req.body)); }
    catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
    return { ok: true };
  });

  app.post(routes.agentStatus, async (req, reply) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const who = tokens.get(token);
    if (!who) return reply.code(401).send({ error: "a valid player token is required" });
    if (who.room.state === "finished") return reply.code(409).send({ error: "match over" });
    try { who.room.recordAgentActivity(who.player, req.body); }
    catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
    return { ok: true };
  });

  const createRoom = async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as {
      players?: { name?: string; bot?: string; team?: number; agent?: unknown }[]; seed?: number; prepMs?: number; tickRate?: number; botLatencyMs?: number;
      map?: string; sides?: "random" | "fixed"; chat?: boolean; mode?: "teams" | "ffa";
      stats?: { label: string; kinds: Record<string, Record<string, unknown>>; upgrades: Ruleset["upgrades"] };
    };
    // Experiments only (server started with AOA_CUSTOM_STATS=1): play today's engine with another version's stats.
    if (body.stats && process.env.AOA_CUSTOM_STATS !== "1") return reply.code(400).send({ error: "custom stats are disabled on this server" });
    const map = maps[body.map ?? "open"];
    if (!map) return reply.code(400).send({ error: `unknown map ${body.map}; available: ${Object.keys(maps).join(", ")}` });
    if (body.mode !== undefined && body.mode !== "teams" && body.mode !== "ffa") return reply.code(400).send({ error: 'mode must be "teams" or "ffa"' });
    if (body.mode === "ffa" && body.players?.some((p) => p.team !== undefined)) return reply.code(400).send({ error: "ffa does not accept teams" });
    // Four-seat maps support 2v2 (default), four-player FFA, or an explicit
    // three-player FFA with one empty corner. Other lobby defaults stay full.
    const seats = map.seats ?? 2;
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
    const config = {
      ruleset: { ...(body.stats ? withStats(ruleset, body.stats) : ruleset), map },
      players,
      mode: body.mode,
      sides: body.sides === "fixed" ? "fixed" as const : "random" as const,
      chat: body.chat !== false,
      seed: int(body.seed, Math.floor(Math.random() * 2 ** 31)),
      tickRate: int(body.tickRate, opts.tickRate ?? 10),
      prepMs: int(body.prepMs, opts.prepMs ?? ruleset.prepMs),
      botLatencyMs: int(body.botLatencyMs, 3000),
    };
    if (req.routeOptions.url === routes.series) return series.create(config);
    const room = await Room.create({ ...config, onFinish: (replay) => void saveReplay(opts.replayDir, replay) });
    register(room);
    return {
      ...room.summary(),
      players: room.players.map((p) => ({ id: p.id, name: p.name, bot: p.bot?.name, side: p.side, team: p.team, token: p.bot ? undefined : p.token })),
      watch: `/watch/${room.id}#spectator=${room.spectatorToken}`,
    };
  };
  app.post(routes.rooms, createRoom);
  app.post(routes.series, createRoom);
  app.get(routes.series, async () => series.list());
  app.get(routes.currentSeries, async (req, reply) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    return series.current(token) ?? reply.code(401).send({ error: "a valid series participant token is required" });
  });
  app.get(`${routes.series}/:id`, async (req, reply) => series.summary((req.params as { id: string }).id) ?? reply.code(404).send({ error: "no such series" }));
  app.get(`${routes.series}/:id/replay.json`, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!series.summary(id)) return reply.code(404).send({ error: "no such series" });
    return series.replay(id) ?? reply.code(409).send({ error: "series replay is available after all three games finish" });
  });

  app.get(routes.maps, async () => Object.values(maps).map(({ name, description, width, height, walls, wallStyle, neutralWalls, seats }) => ({ name, description, width, height, walls, ...(wallStyle ? { wallStyle } : {}), ...(neutralWalls?.length ? { neutralWalls } : {}), players: seats ?? 2 })));

  app.get(routes.rooms, async () => [...rooms.values()].map((r) => r.summary()).reverse());

  app.get(`${routes.rooms}/:id`, async (req, reply) => {
    const room = rooms.get((req.params as { id: string }).id);
    return room ? room.summary() : reply.code(404).send({ error: "no such room" });
  });

  // Observer view of the code each player's scriptable kinds run now (the watch page's unit panel).
  app.get(`${routes.rooms}/:id/scripts`, async (req, reply) => {
    const room = rooms.get((req.params as { id: string }).id);
    if (!room) return reply.code(404).send({ error: "no such room" });
    if (room.state !== "finished" && !spectatorAllowed(req, room)) return reply.code(403).send({ error: "live observation requires the host spectator link" });
    const kinds = Object.entries(room.ruleset.kinds).filter(([, k]) => k.scriptable).map(([kind]) => kind);
    return Object.fromEntries(room.players.map((p) => [p.id, Object.fromEntries(kinds.map((kind) => [kind, room.script(p.id, kind)]))]));
  });

  const replayMetadata = new Map<string, { rulesVersion?: string; map?: string; players: ReplayPlayerSummary[] }>();
  app.get(routes.replays, async () => Promise.all((await readIndex(opts.replayDir)).map(async entry => {
    const path = join(opts.replayDir, `${entry.id}.json.gz`);
    const savedAt = await stat(path).then(file => file.mtime.toISOString()).catch(() => entry.createdAt);
    const key = `${entry.id}:${savedAt}`;
    let metadata = replayMetadata.get(key);
    if ((!entry.rulesVersion || entry.players.some(player => player.effort === undefined)) && !metadata) {
      try {
        const replay: ReplayFile = JSON.parse(gunzipSync(await readFile(path)).toString("utf8"));
        metadata = { rulesVersion: replay.ruleset.version, map: replay.ruleset.map.name, players: replayPlayerSummaries(replay) };
        replayMetadata.set(key, metadata);
      } catch { /* An unavailable historical recording stays unknown, never current. */ }
    }
    return { ...entry, ...metadata, savedAt };
  })));


  app.get(`${routes.replays}/:id`, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!/^[\w-]+$/.test(id)) return reply.code(400).send({ error: "bad id" });
    const file = join(opts.replayDir, `${id}.json.gz`);
    if (!existsSync(file)) return reply.code(404).send({ error: "no such replay" });
    reply.header("content-type", "application/json");
    return gunzipSync(await readFile(file)).toString("utf8");
  });

  app.get(`${routes.spectate}/:id`, { websocket: true }, (socket, req) => {
    const room = rooms.get((req.params as { id: string }).id);
    if (!room) return socket.close(4404, "no such room");
    if (room.state !== "finished" && !spectatorAllowed(req, room)) return socket.close(4403, "live observation requires the host spectator link");
    const off = room.addSpectator({ send: (m) => socket.readyState === 1 && socket.send(JSON.stringify(m)) });
    socket.on("close", off);
  });

  function spectatorAllowed(req: FastifyRequest, room: Room): boolean {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : (req.query as Record<string, string>)?.spectator;
    return typeof token === "string" && token === room.spectatorToken;
  }

  // ───────────────────────── players ─────────────────────────

  // With a token: the rules of that player's room (its map). Without: the defaults.
  app.get(routes.rules, async (req) => {
    const h = req.headers.authorization ?? "";
    const room = tokens.get(h.startsWith("Bearer ") ? h.slice(7) : "")?.room;
    const r = room?.ruleset ?? ruleset;
    const guide = playerGuide(r, { chat: room?.chat ?? true, teams: room?.teams, playerCount: room?.players.length, series: room?.seriesProgress?.(), tickRate: room?.tickRate ?? opts.tickRate ?? 10 });
    if (wantsText(req)) return guide;
    return { ruleset: r, guide };
  });

  // For harness supervisors: checks a token's match without counting as a player call or connection.
  app.get(routes.status, async (req, reply) => {
    const h = req.headers.authorization ?? "";
    const who = tokens.get(h.startsWith("Bearer ") ? h.slice(7) : "");
    if (!who) return reply.code(401).send({ error: "missing or invalid token (Authorization: Bearer <token>)" });
    return { room: who.room.id, player: who.player, status: who.room.state, tick: who.room.tick, alive: who.room.isAlive(who.player) };
  });

  app.get(routes.state, async (req, reply) => {
    const who = auth(req, reply);
    if (!who) return;
    const q = req.query as Record<string, string>;
    const v = who.room.view(who.player, q.since === undefined ? undefined : int(q.since, 0));
    return wantsText(req) ? viewToText(v) : v;
  });

  app.get(routes.history, async (req, reply) => {
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

  app.post(routes.act, async (req, reply) => {
    const who = auth(req, reply);
    if (!who) return;
    const body = req.body as { orders?: unknown; since?: number } | undefined;
    const orders = Array.isArray(body?.orders) ? (body!.orders as Order[]).slice(0, 50) : null;
    if (!orders) return reply.code(400).send({ error: 'body must be {"orders":[...]} (max 50)' });
    const scripts = await Promise.all(orders.map((o) => (o?.type === "script" ? prepareScript(o.code, "js", ruleset) : null)));
    const prepared = orders.map((o, i) => (scripts[i]?.ok ? { ...o, code: scripts[i]!.code } : o)) as Order[];
    const { results, tick } = await who.room.act(who.player, prepared);
    (req as FastifyRequest & { toolFailed?: boolean }).toolFailed = results.some((r) => !r.ok);
    const view = who.room.view(who.player, body?.since);
    const mineral = { spent: results.reduce((n, r) => n + (r.mineral?.spent ?? 0), 0), remaining: view.players.find((p) => p.id === who.player)!.mineral };
    const line = results.map((r, i) => `order ${i}: ${r.ok ? "ok" + ("id" in r && r.id ? " " + r.id : "") : "FAILED " + r.reason}${r.mineral ? ` · mineral spent ${r.mineral.spent}, remaining ${r.mineral.remaining}${r.mineral.pending !== undefined ? ` · build cost ${r.mineral.pending} pending until completion` : ""}` : ""}`).join("\n");
    return wantsText(req) ? `${line}\nmineral spent by these orders: ${mineral.spent} · remaining now: ${mineral.remaining}\n\n${viewToText(view)}` : { results, mineral, view };
  });

  // A one-shot player script: reads the full JSON view and rules, returns orders applied like /act.
  app.post(routes.run, async (req, reply) => {
    const who = auth(req, reply);
    if (!who) return;
    const body = req.body as { code?: unknown; lang?: unknown } | undefined;
    if (typeof body?.code !== "string" || !body.code.trim()) return reply.code(400).send({ error: 'body must be {"code":"...","lang"?:"js"|"ts"}' });
    let code = body.code;
    if (body.lang === "ts") {
      try { code = (await transform(code, { loader: "ts", format: "esm" })).code; }
      catch (e) { return reply.code(400).send({ error: String((e as Error).message).slice(0, 300) }); }
    }
    const view = who.room.view(who.player);
    const out = await runOnceIsolated(code, { view, rules: who.room.ruleset ?? ruleset });
    if (out.operationalFailure && out.error) who.room.recordOperationalFailure(who.player, out.error);
    const allowed = new Set(["move", "attack", "gather", "build", "train", "upgrade", "stop"]);
    const orders = out.orders.filter((o): o is Order => !!o && typeof o === "object" && allowed.has((o as Order).type));
    const rejected = out.orders.length - orders.length;
    const { results, tick } = orders.length ? await who.room.act(who.player, orders) : { results: [], tick: who.room.tick };
    const result = { ...(out.error ? { error: out.error } : {}), tick, orders, results, ...(rejected ? { rejected } : {}), value: out.value, logs: out.logs };
    (req as FastifyRequest & { toolFailed?: boolean }).toolFailed = !!out.error || rejected > 0 || results.some((r) => !r.ok);
    if (!wantsText(req)) return result;
    return [
      out.error ? `run FAILED: ${out.error} (no orders applied)` : `run ok · ${orders.length} order(s)${rejected ? ` · ${rejected} ignored (run accepts move, attack, gather, build, train, upgrade, stop)` : ""}`,
      ...results.map((r, i) => `order ${i} ${JSON.stringify(orders[i])}: ${r.ok ? "ok" + ("id" in r && r.id ? " " + r.id : "") : "FAILED " + r.reason}`),
      ...(out.value !== null ? [`returned: ${JSON.stringify(out.value)}`] : []),
      ...(out.logs.length ? ["logs:", ...out.logs.map((l) => `  ${l}`)] : []),
    ].join("\n");
  });

  app.get(routes.chat, async (req, reply) => {
    const who = auth(req, reply);
    if (!who) return;
    const log = who.room.conversation(who.player);
    if (!wantsText(req)) return { chat: who.room.chat, messages: log };
    if (!who.room.chat) return "chat is off in this room";
    return log.length ? log.map((m) => `[${m.tick}] ${m.from}${m.name === m.from ? "" : ` ${m.name}`}${m.from === who.player ? " (you)" : ""}${m.channel === "private" ? ` [private to ${m.to}]` : m.channel === "team" ? " [team]" : ""}: ${m.text}`).join("\n") : "no messages yet";
  });

  app.post(routes.chat, async (req, reply) => {
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

  app.get(`${routes.scripts}/:kind`, async (req, reply) => {
    const who = auth(req, reply);
    if (!who) return;
    const s = who.room.script(who.player, (req.params as { kind: string }).kind);
    return s ?? reply.code(404).send({ error: "that kind is not scriptable" });
  });

  app.put(`${routes.scripts}/:kind`, async (req, reply) => {
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

  app.post(`${routes.scripts}/:kind/test`, async (req, reply) => {
    const who = auth(req, reply);
    if (!who) return;
    const kind = (req.params as { kind: string }).kind;
    const body = (req.body ?? {}) as { code?: unknown; lang?: string };
    if (typeof body.code !== "string") return reply.code(400).send({ error: "code must be a script body" });
    const prepared = await prepareScript(body.code, body.lang === "ts" ? "ts" : "js", who.room.ruleset);
    if (!prepared.ok) return reply.code(400).send({ ok: false, error: prepared.error });
    const result = who.room.testScript(who.player, kind, prepared.code!);
    if (!result.ok) reply.code(400);
    return { ...result, freshMemory: true, actionsApplied: false,
      note: "Probe of owned units in the current visible context with fresh memory; proposed actions only. Does not advance the game or install the script." };
  });

  app.get(routes.wait, async (req, reply) => {
    const who = auth(req, reply);
    if (!who) return;
    const q = req.query as Record<string, string>;
    const since = int(q.since, who.room.cursor(who.player));
    const maxMs = Math.min(30, Math.max(0, int(q.max, 5))) * 1000;
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
    app.setNotFoundHandler((req, reply) => (req.method === "GET" && !req.url.startsWith(publishedApi) ? reply.sendFile("index.html") : reply.code(404).send({ error: "not found" })));
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
  const check = await validateScriptIsolated(js, ruleset.script);
  return check.ok ? { ok: true, code: js } : { ok: false, error: check.error };
}

interface ReplayIndexEntry {
  id: string;
  createdAt: string;
  players: ReplayPlayerSummary[];
  outcome: ReplayFile["outcome"];
  finalTick: number;
  tickRate: number;
  rulesVersion?: string;
  map?: string;
}

const replayWrites = new Map<string, Promise<void>>();
export function saveReplay(dir: string, replay: ReplayFile): Promise<void> {
  const write = (replayWrites.get(dir) ?? Promise.resolve()).catch(() => {}).then(async () => {
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${replay.id}.json.gz`);
    await writeFile(`${path}.tmp`, gzipSync(JSON.stringify(replay)));
    await rename(`${path}.tmp`, path);
    const index = (await readIndex(dir)).filter((r) => r.id !== replay.id);
    index.unshift({ id: replay.id, createdAt: replay.createdAt, players: replayPlayerSummaries(replay), outcome: replay.outcome, finalTick: replay.finalTick, tickRate: replay.tickRate, rulesVersion: replay.ruleset.version, map: replay.ruleset.map.name });
    const indexPath = join(dir, replayArchive.index);
    await writeFile(`${indexPath}.tmp`, JSON.stringify(index, null, 1));
    await rename(`${indexPath}.tmp`, indexPath);
  });
  replayWrites.set(dir, write);
  return write;
}

async function readIndex(dir: string): Promise<ReplayIndexEntry[]> {
  try {
    return JSON.parse(await readFile(join(dir, replayArchive.index), "utf8"));
  } catch {
    return [];
  }
}

/** Numbers that describe a kind; everything else (capabilities, symbols) stays as today. */
const STATS = ["hp", "def", "atk", "range", "minRange", "vision", "moveMs", "attackMs", "cost", "aimMs", "trainMs", "buildMs", "requires"];

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
