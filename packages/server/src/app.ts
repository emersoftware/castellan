/**
 * The HTTP API: the only contract between the game and its players. Connectors
 * (MCP, CLI, anything else) are thin clients of these routes, grouped by who may call them.
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { publishedApi, rules, type Ruleset } from "@castellan/shared";
import { ReplayArchive } from "./archive";
import { serverAnalytics } from "./analytics";
import { Rooms } from "./rooms";
import { SeriesStore } from "./series";
import { lobbyRoutes } from "./routes/lobby";
import { playerRoutes } from "./routes/player";
import { publicRoutes } from "./routes/public";
import { spectatorRoutes } from "./routes/spectator";

export interface ServerOptions {
  replayDir: string;
  /** Built web client to serve at `/` (optional). */
  webDir?: string;
  ruleset?: Ruleset;
  tickRate?: number;
  prepMs?: number;
}

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const ruleset = opts.ruleset ?? rules;
  const rooms = new Rooms();
  const archive = new ReplayArchive(opts.replayDir);
  await mkdir(opts.replayDir, { recursive: true });
  const series = new SeriesStore(join(opts.replayDir, "series"), (room) => rooms.add(room), (replay) => archive.save(replay));
  await series.load();

  // Player/spectator capabilities can be in WebSocket/query URLs. Never log
  // queries, headers or bodies, including when LOG=1 enables access logging.
  const app = Fastify({ logger: process.env.LOG === "1" ? { serializers: { req: (req) => ({ method: req.method, url: req.url?.split("?")[0] }) } } : false, bodyLimit: 64 * 1024 });
  await app.register(cors, { origin: true });
  await app.register(websocket);
  const analytics = serverAnalytics(app);

  await app.register(publicRoutes, { rooms, series, archive });
  await app.register(spectatorRoutes, { rooms });
  await app.register(lobbyRoutes, { rooms, series, archive, analytics, ruleset, tickRate: opts.tickRate, prepMs: opts.prepMs });
  await app.register(playerRoutes, { rooms, series, ruleset, tickRate: opts.tickRate });

  if (opts.webDir && existsSync(opts.webDir)) {
    await app.register(fastifyStatic, { root: opts.webDir, wildcard: true });
    app.setNotFoundHandler((req, reply) => (req.method === "GET" && !req.url.startsWith(publishedApi) ? reply.sendFile("index.html") : reply.code(404).send({ error: "not found" })));
  }

  app.addHook("onClose", async () => {
    await series.close();
    await rooms.close();
  });
  return app;
}
