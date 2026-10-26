import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { MAPS, rules, type PlayerView, type ReplayFile } from "@castellan/shared";
import { runReplay } from "@castellan/engine";
import { buildServer } from "../src/app";
import { Room, type RoomCheckpoint } from "../src/room";
import { waitForReplay, waitForStatus } from "./support/readiness";

let app: FastifyInstance | undefined, directory: string | undefined;
let room: Room | undefined;
afterEach(async () => {
  room?.close(); room = undefined;
  vi.useRealTimers();
  await app?.close(); app = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

it("restores all six identities, placements and pending production from a running checkpoint", async () => {
  room = await Room.create({ ruleset: { ...rules, map: MAPS.hex, fourSeatMatchMs: 5000 },
    players: Array.from({ length: 6 }, (_, i) => ({ name: `P${i}` })), mode: "ffa", sides: "random",
    tickRate: 10, seed: 71, prepMs: 0, botLatencyMs: 1000, chat: true, onFinish: () => {},
  });
  vi.useFakeTimers();
  for (const p of room.players) room.touch(p.id);
  await vi.advanceTimersByTimeAsync(300);
  expect(room.tick).toBeGreaterThan(0);
  const castle = room.view("p6").mine.find(e => e.kind === "castle")!;
  const training = room.act("p6", [{ type: "train", building: castle.id, kind: "wizard" }]);
  await vi.advanceTimersByTimeAsync(100);
  expect((await training).results[0].ok).toBe(true);
  const before = room.view("p6").mine.find(e => e.id === castle.id)!;
  const saved: RoomCheckpoint = JSON.parse(JSON.stringify(room.checkpoint()));
  room.close(); room = undefined;
  room = await Room.restore(saved, () => {});
  expect(room.checkpoint().hash).toBe(saved.hash);
  expect(room.checkpoint().players).toEqual(saved.players);
  expect(room.view("p6").mine.find(e => e.id === castle.id)).toMatchObject({ x: before.x, y: before.y, training: before.training });
});

it.each([
  { map: "hex", sides: "fixed" }, { map: "hex", sides: "random" },
  { map: "fortress-hex", sides: "fixed" }, { map: "fortress-hex", sides: "random" },
] as const)("$map serves six independent $sides seats, runs all workers and saves a strict replay", async ({ map, sides }) => {
  directory = await mkdtemp(join(tmpdir(), "castellan-six-"));
  app = await buildServer({ replayDir: directory, prepMs: 0, ruleset: { ...rules, fourSeatMatchMs: 800 } });
  // Omitted mode on six-seat maps defaults to FFA; it must never silently become 2v2.
  const created = await app.inject({ method: "POST", url: "/rooms", payload: { map, sides, seed: 71,
    players: Array.from({ length: 6 }, (_, i) => ({ name: `Seat ${i + 1}` })),
  } });
  expect(created.statusCode).toBe(200);
  const lobby = created.json<{ id: string; mode: string; players: { id: string; token: string; side: number; team: number }[] }>();
  expect(lobby.mode).toBe("ffa");
  expect(lobby.players).toHaveLength(6);
  expect(lobby.players.map(p => p.side).sort()).toEqual([0, 1, 2, 3, 4, 5]);
  expect(new Set(lobby.players.map(p => p.team)).size).toBe(6);
  const headers = (token: string) => ({ authorization: `Bearer ${token}` });
  const { guide } = (await app.inject({ url: "/guide", headers: headers(lobby.players[0].token) })).json();
  expect(guide).toContain("Six-player free-for-all");
  expect(guide).toContain("last player standing wins");
  expect(guide).toContain(map === "hex" ? "no prebuilt walls or doors" : "three doors, one centered on each wall");
  expect(guide).not.toContain("one base per corner");
  for (const player of lobby.players) {
    const state = (await app.inject({ url: "/state", headers: headers(player.token) })).json<PlayerView>();
    expect(state.players).toHaveLength(6);
    expect(state.allies).toEqual([]);
    const { x, y } = MAPS[map].origins![player.side];
    expect(state.mine.find(e => e.kind === "castle")).toMatchObject({ x, y });
    expect(state.mine.filter(e => e.kind === "door")).toHaveLength(map === "hex" ? 0 : 3);
    expect(state.mine.filter(e => e.kind === "wall")).toHaveLength(map === "hex" ? 0 : 34);
  }
  await waitForStatus(app, lobby.players[0].token, "finished");
  await waitForReplay(app, lobby.id);
  const replay = (await app.inject(`/replays/${lobby.id}`)).json<ReplayFile>();
  expect(replay.ruleset.map).toEqual(MAPS[map]);
  expect(replay.players.map(p => p.side)).toEqual(lobby.players.map(p => p.side));
  expect(Object.keys(replay.experiment!.players)).toHaveLength(6);
  expect(replay.experiment!.operationalFailures ?? []).toEqual([]);
  expect((await runReplay(replay, () => {})).verified).toBe(true);
});

it.each(["hex", "fortress-hex"])("%s rejects team play and incomplete or overflowing six-player lobbies instead of silently truncating them", async map => {
  directory = await mkdtemp(join(tmpdir(), "castellan-six-lobby-"));
  app = await buildServer({ replayDir: directory });
  for (const payload of [
    { mode: "teams" }, { players: [{ name: "A", team: 0 }] },
    { players: Array.from({ length: 5 }, () => ({ name: "A" })) },
    { players: Array.from({ length: 7 }, () => ({ name: "A" })) },
  ]) expect((await app.inject({ method: "POST", url: "/rooms", payload: { map, ...payload } })).statusCode).toBe(400);
  const empty = (await app.inject({ method: "POST", url: "/rooms", payload: { map } })).json();
  expect(empty.players).toHaveLength(6);
  expect(empty.status).toBe("waiting");
});
