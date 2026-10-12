import { gzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { rules, type SpectatorView } from "@aoa/shared";
import { decodeShowcaseChunk, encodeShowcaseChunk, parseShowcaseManifest, readShowcaseChunk } from "../src/showcaseRecording";

const initial = (): SpectatorView => ({
  tick: 40, timeMs: 4000, matchMs: 600000, status: "running", players: [],
  entities: [
    { id: "worker", owner: "p1", kind: "worker", x: 2, y: 3, hp: 40, maxHp: 40,
      construction: { kind: "wall", x: 3, y: 3, completesAtMs: 5000 },
      actionResult: { tick: 39, source: "order", intent: "build", status: "working" } },
    { id: "king", owner: "p2", kind: "king", x: 5, y: 6, hp: 10, maxHp: 100, vital: true },
  ],
  events: [], projectiles: [], deposits: [{ id: "d1", x: 7, y: 8, amount: 100 }],
});
const finishing = (): SpectatorView => ({
  ...initial(), tick: 41, timeMs: 4100, status: "finished",
  entities: [
    { id: "wall", owner: "p1", kind: "wall", x: 3, y: 3, hp: 300, maxHp: 300 },
    { id: "worker", owner: "p1", kind: "worker", x: 2, y: 4, hp: 30, maxHp: 40,
      actionResult: { tick: 40, source: "script", intent: "move", status: "acted", effect: "move" } },
  ],
  events: [{ type: "death", tick: 40, id: "king", owner: "p2", kind: "king", x: 5, y: 6 }],
  deposits: [{ id: "d1", x: 7, y: 8, amount: 90 }],
  outcome: { winner: "p1", winners: ["p1"], reason: "vital_lost", scores: { p1: 200, p2: 0 } },
});

it("preserves building completion, deaths, births, ordering and nested feedback without rewriting older frames", () => {
  const frames = [initial(), finishing()];
  const saved = structuredClone(frames);
  // The network's JSON boundary is part of the contract, not object identity.
  const decoded = decodeShowcaseChunk(JSON.parse(JSON.stringify(encodeShowcaseChunk(frames))));
  expect(decoded).toEqual(saved);
  expect(decoded[0].entities[0].construction?.kind).toBe("wall");
  expect(decoded[1].entities[1]).not.toHaveProperty("construction");
  expect(decoded[0].entities[0].actionResult?.tick).toBe(39);
  expect(frames).toEqual(saved);
});

it("decodes a later chunk independently, preserving a finished match and its final event", () => {
  const later = finishing();
  const serialized = JSON.stringify(encodeShowcaseChunk([later]));
  expect(decodeShowcaseChunk(JSON.parse(serialized))).toEqual([later]);
});

it.each([true, false])("reads gzip recordings whether fetch has already decompressed them: %s", async compressed => {
  const frames = [initial(), finishing()];
  const text = JSON.stringify(encodeShowcaseChunk(frames));
  const response = new Response(compressed ? new Uint8Array(gzipSync(text)) : text);
  expect(await readShowcaseChunk(response)).toEqual(frames);
});

it("rejects unavailable, corrupt, unsupported and discontinuous recordings", async () => {
  await expect(readShowcaseChunk(new Response("not found", { status: 404 }))).rejects.toThrow("404");
  await expect(readShowcaseChunk(new Response(new Uint8Array([0x1f, 0x8b, 0x00])))).rejects.toThrow();
  expect(() => decodeShowcaseChunk({ format: 2, first: {}, deltas: [] })).toThrow("Invalid showcase");
  const bad = encodeShowcaseChunk([initial()]);
  bad.deltas.push([1, { tick: [0, 43] }]);
  expect(() => decodeShowcaseChunk(bad)).toThrow("Invalid showcase");
  expect(() => encodeShowcaseChunk([initial(), { ...finishing(), tick: 50 }])).toThrow("consecutive");
});

it("rejects a chunk that references a missing entity instead of silently losing the unit", () => {
  const bad = encodeShowcaseChunk([initial()]);
  bad.first.entityOrder = ["nonexistent"];
  expect(() => decodeShowcaseChunk(bad)).toThrow("Invalid showcase");
});

const manifest = () => ({ format: 1, id: "test", tickRate: 10, ruleset: rules,
  players: [{ id: "p1", name: "Player 1" }], startTick: 40, finalTick: 41,
  chunks: [{ url: "40-abcdef.json.gz", firstTick: 40, lastTick: 40 }, { url: "41-fedcba.json.gz", firstTick: 41, lastTick: 41 }] });

it("accepts only a contiguous manifest that covers the entire recording", () => {
  expect(parseShowcaseManifest(manifest())).toEqual(manifest());
  expect(() => parseShowcaseManifest({ ...manifest(), chunks: manifest().chunks.slice(0, 1) })).toThrow("Invalid showcase");
  const gap = manifest();
  gap.chunks[1].firstTick = 42;
  expect(() => parseShowcaseManifest(gap)).toThrow("Invalid showcase");
  const foreign = manifest();
  foreign.chunks[0].url = "https://other.example/replay.json.gz";
  expect(() => parseShowcaseManifest(foreign)).toThrow("Invalid showcase");
});
