import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "@aoa/server";
import { rules } from "@aoa/shared";

/** A real game server on a random port with a short match. */
export async function startServer() {
  const replayDir = await mkdtemp(join(tmpdir(), "aoa-cli-"));
  let app: Awaited<ReturnType<typeof buildServer>> | undefined;
  const close = async () => {
    await app?.close();
    await rm(replayDir, { recursive: true, force: true });
  };
  try {
    app = await buildServer({ replayDir, ruleset: { ...rules, matchMs: 4000 }, tickRate: 20, prepMs: 0 });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    return { app, url: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`, close };
  } catch (error) {
    await close();
    throw error;
  }
}
