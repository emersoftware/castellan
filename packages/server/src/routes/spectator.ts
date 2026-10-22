/** Watching a room: live only with its host's spectator token, by anyone once its match is over. */
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { routes } from "@castellan/shared";
import type { Room } from "../room";
import type { Rooms } from "../rooms";

export const spectatorRoutes: FastifyPluginAsync<{ rooms: Rooms }> = async (app, { rooms }) => {
  const mayWatch = (req: FastifyRequest, room: Room) => {
    if (room.state === "finished") return true;
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : (req.query as Record<string, string>)?.spectator;
    return typeof token === "string" && token === room.spectatorToken;
  };

  // The code each player's scriptable kinds run now (the watch page's unit panel).
  app.get(`${routes.rooms}/:id/scripts`, async (req, reply) => {
    const room = rooms.get((req.params as { id: string }).id);
    if (!room) return reply.code(404).send({ error: "no such room" });
    if (!mayWatch(req, room)) return reply.code(403).send({ error: "live observation requires the host spectator link" });
    return Object.fromEntries(room.players.map((p) => [p.id, room.scripts(p.id)]));
  });

  app.get(`${routes.spectate}/:id`, { websocket: true }, (socket, req) => {
    const room = rooms.get((req.params as { id: string }).id);
    if (!room) return socket.close(4404, "no such room");
    if (!mayWatch(req, room)) return socket.close(4403, "live observation requires the host spectator link");
    const off = room.addSpectator({ send: (m) => socket.readyState === 1 && socket.send(JSON.stringify(m)) });
    socket.on("close", off);
  });
};
