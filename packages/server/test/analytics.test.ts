import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/app";

const sdk = vi.hoisted(() => ({ capture: vi.fn(), captureException: vi.fn(), shutdown: vi.fn(), on: vi.fn() }));
vi.mock("posthog-node", () => ({ PostHog: vi.fn(function () { return sdk; }) }));
let app: FastifyInstance, dir: string;
beforeEach(async () => {
  vi.clearAllMocks();
  dir = await mkdtemp(join(tmpdir(), "castellan-analytics-"));
  app = await buildServer({ replayDir: dir, analytics: { key: "phc_test", host: "https://eu.i.posthog.com", environment: "test" } });
});
afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

it("captures successful room/series creation with browser identity and no capabilities or names", async () => {
  const distinctId = "019a1234-0000-7000-8000-000000000001";
  const sessionId = "019a1234-0000-7000-8000-000000000002";
  const result = await app.inject({ method: "POST", url: "/rooms", headers: {
    "x-posthog-distinct-id": distinctId, "x-posthog-session-id": sessionId,
  }, payload: { players: [{ name: "private name" }, { name: "other private name" }] } });
  expect(result.statusCode).toBe(200);
  expect(sdk.capture).toHaveBeenCalledWith(expect.objectContaining({ event: "match_created", distinctId,
    properties: expect.objectContaining({ room_id: result.json().id, $session_id: sessionId, actor_type: "browser", player_count: 2 }),
  }));
  const wire = JSON.stringify(sdk.capture.mock.calls);
  expect(wire).not.toContain("private name");
  for (const player of result.json().players) expect(wire).not.toContain(player.token);
  const series = await app.inject({ method: "POST", url: "/series", payload: {} });
  expect(series.statusCode).toBe(200);
  expect(sdk.capture).toHaveBeenLastCalledWith(expect.objectContaining({ event: "series_created", distinctId: `series:${series.json().id}`,
    properties: expect.objectContaining({ actor_type: "host" }),
  }));
});

it("ignores invalid submissions and preserves successful API responses if analytics fails", async () => {
  expect((await app.inject({ method: "POST", url: "/rooms", payload: { map: "invalid" } })).statusCode).toBe(400);
  expect(sdk.capture).not.toHaveBeenCalled();
  sdk.capture.mockImplementationOnce(() => { throw new Error("offline"); });
  expect((await app.inject({ method: "POST", url: "/rooms", payload: {} })).statusCode).toBe(200);
});

it("captures a generic server exception without leaking request or error contents", async () => {
  app.get("/analytics-test", async () => { throw new Error("private token and script"); });
  const response = await app.inject({ url: "/analytics-test?token=private", headers: { authorization: "Bearer private" } });
  expect(response.statusCode).toBe(500);
  expect(sdk.captureException).toHaveBeenCalledTimes(1);
  expect((sdk.captureException.mock.calls[0][0] as Error).message).toBe("Game API request failed");
  expect(JSON.stringify(sdk.captureException.mock.calls)).not.toContain("private");
  await app.close();
  expect(sdk.shutdown).toHaveBeenCalledWith(2000);
});
