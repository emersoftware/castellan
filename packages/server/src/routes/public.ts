/** What anyone may read: the server's health, maps, rooms, series and finished matches. */
import type { FastifyPluginAsync } from "fastify";
import { MAPS, routes } from "@castellan/shared";
import type { ReplayArchive } from "../archive";
import type { Rooms } from "../rooms";
import type { SeriesStore } from "../series";

export const publicRoutes: FastifyPluginAsync<{ rooms: Rooms; series: SeriesStore; archive: ReplayArchive }> = async (app, { rooms, series, archive }) => {
  app.get(routes.health, async () => ({ ok: true }));

  app.get(routes.maps, async () => Object.values(MAPS).map(({ name, description, width, height, walls, wallStyle, neutralWalls, seats }) => ({ name, description, width, height, walls, ...(wallStyle ? { wallStyle } : {}), ...(neutralWalls?.length ? { neutralWalls } : {}), players: seats ?? 2 })));

  app.get(routes.rooms, async () => rooms.list().map((r) => r.summary()));

  app.get(`${routes.rooms}/:id`, async (req, reply) => {
    const room = rooms.get((req.params as { id: string }).id);
    return room ? room.summary() : reply.code(404).send({ error: "no such room" });
  });

  app.get(routes.series, async () => series.list());
  app.get(`${routes.series}/:id`, async (req, reply) => series.summary((req.params as { id: string }).id) ?? reply.code(404).send({ error: "no such series" }));
  app.get(`${routes.series}/:id/replay.json`, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!series.summary(id)) return reply.code(404).send({ error: "no such series" });
    return series.replay(id) ?? reply.code(409).send({ error: "series replay is available after all three games finish" });
  });

  app.get(routes.replays, async () => archive.list());

  app.get(`${routes.replays}/:id`, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!/^[\w-]+$/.test(id)) return reply.code(400).send({ error: "bad id" });
    const replay = await archive.read(id);
    if (replay === undefined) return reply.code(404).send({ error: "no such replay" });
    reply.header("content-type", "application/json");
    return replay;
  });
};
