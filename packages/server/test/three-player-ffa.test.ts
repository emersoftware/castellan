import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { MAPS, rules, type PlayerView, type ReplayFile } from "@castellan/shared";
import { runReplay } from "@castellan/engine";
import { buildServer } from "../src/app";
import { Room, type RoomCheckpoint } from "../src/room";
import { waitForReplay, waitForStatus } from "./support/readiness";

let app: FastifyInstance | undefined;
let room: Room | undefined;
let dir: string | undefined;
afterEach(async () => {
  room?.close(); room = undefined;
  vi.useRealTimers();
  await app?.close(); app = undefined;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

const players = ["One", "Two", "Three"].map(name => ({ name }));

it.each(["fixed", "random"] as const)("starts exactly three opponents in distinct %s corners and publishes their verified replay", async sides => {
  dir = await mkdtemp(join(tmpdir(), "castellan-three-player-"));
  app = await buildServer({ replayDir: dir, ruleset: { ...rules, fourSeatMatchMs: 800 }, prepMs: 0 });
  const created = await app.inject({ method: "POST", url: "/rooms", payload: {
    map: "fortress-quad", mode: "ffa", sides, seed: 419, players,
  } });
  expect(created.statusCode).toBe(200);
  const lobby = created.json<{ id: string; mode: string; players: { id: string; token: string; side: number; team: number }[] }>();
  expect(lobby.mode).toBe("ffa");
  expect(lobby.players.map(p => p.id)).toEqual(["p1", "p2", "p3"]);
  expect(new Set(lobby.players.map(p => p.side)).size).toBe(3);
  expect(new Set(lobby.players.map(p => p.team)).size).toBe(3);
  if (sides === "fixed") expect(lobby.players.map(p => p.side)).toEqual([0, 1, 2]);
  const headers = { authorization: `Bearer ${lobby.players[0].token}` };
  const { guide } = (await app.inject({ url: "/rules", headers })).json<{ guide: string }>();
  expect(guide).toContain("Three-player free-for-all (1v1v1)");
  expect(guide).toContain("The empty corner has no base or personal deposits.");
  expect(guide).not.toContain("Four-player free-for-all");
  const views = await Promise.all(lobby.players.map(async p => (await app!.inject({
    url: "/state", headers: { authorization: `Bearer ${p.token}` },
  })).json<PlayerView>()));
  const castles = views.map(view => {
    expect(view.players).toHaveLength(3);
    expect(view.allies).toEqual([]);
    expect(view.mine.filter(e => e.kind === "king")).toHaveLength(1);
    const own = view.mine.filter(e => e.kind === "castle");
    expect(own).toHaveLength(1);
    return `${own[0].x},${own[0].y}`;
  });
  expect(new Set(castles).size).toBe(3);
  // All three connected players start and finish; there is no fourth seat to join.
  await waitForStatus(app, lobby.players[0].token, "finished");
  await waitForReplay(app, lobby.id);
  const replay = (await app.inject(`/replays/${lobby.id}`)).json<ReplayFile>();
  expect(replay.players.map(p => ({ id: p.id, side: p.side, team: p.team }))).toEqual(lobby.players.map(({ id, side, team }) => ({ id, side, team })));
  expect(Object.keys(replay.experiment!.players)).toEqual(["p1", "p2", "p3"]);
  expect(replay.experiment!.baseGuideSha256).toBe(createHash("sha256").update(guide).digest("hex"));
  expect((await runReplay(replay, () => {})).verified).toBe(true);

  // Three names still fill a 2v2 lobby: only explicit FFA opts into three players.
  const teams = (await app.inject({ method: "POST", url: "/rooms", payload: { map: "fortress-quad", players } })).json();
  expect(teams.players).toHaveLength(4);
  expect(teams.mode).toBe("teams");
});

it("restores three player credentials, corners and queued production without adding a fourth participant", async () => {
  const replays: ReplayFile[] = [];
  room = await Room.create({ ruleset: { ...rules, map: MAPS["fortress-quad"], fourSeatMatchMs: 2000 }, players,
    mode: "ffa", tickRate: 10, seed: 419, sides: "random", prepMs: 0, botLatencyMs: 1000, chat: true,
    onFinish: replay => { replays.push(replay); },
  });
  vi.useFakeTimers();
  for (const p of room.players) room.touch(p.id);
  await vi.advanceTimersByTimeAsync(0);
  const castle = room.view("p1").mine.find(e => e.kind === "castle")!;
  const train = room.act("p1", [{ type: "train", building: castle.id, kind: "worker" }]);
  await vi.advanceTimersByTimeAsync(100);
  expect((await train).results[0].ok).toBe(true);
  const before = room.view("p1");
  const saved: RoomCheckpoint = JSON.parse(JSON.stringify(room.checkpoint()));
  room.close(); room = undefined;
  room = await Room.restore(saved, replay => { replays.push(replay); });
  const restored = room.checkpoint();
  expect(restored.players).toEqual(saved.players);
  expect(restored.hash).toBe(saved.hash);
  expect(restored.experiment).toEqual(saved.experiment);
  expect(room.view("p1").mine.find(e => e.id === castle.id)?.training).toEqual(before.mine.find(e => e.id === castle.id)?.training);
  for (const p of room.players) room.touch(p.id);
  await vi.advanceTimersByTimeAsync(2000);
  expect(replays).toHaveLength(1);
  expect(replays[0].players).toHaveLength(3);
  expect((await runReplay(replays[0], () => {})).verified).toBe(true);
});
