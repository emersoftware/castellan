import { expect, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/** Players must already be connected: /status neither joins nor consumes events. */
export async function waitForStatus(app: FastifyInstance, token: string, status = "running") {
  await vi.waitFor(async () => {
    const response = await app.inject({ url: "/status", headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe(status);
  }, { timeout: 6000, interval: 20 });
}

/** A finished room can precede both the replay file and its catalog entry. */
export async function waitForReplay(app: FastifyInstance, id: string) {
  await vi.waitFor(async () => {
    expect((await app.inject(`/replays/${id}`)).statusCode).toBe(200);
    const index = await app.inject("/replays");
    expect(index.statusCode).toBe(200);
    expect(index.json()).toContainEqual(expect.objectContaining({ id }));
  }, { timeout: 6000, interval: 20 });
}
