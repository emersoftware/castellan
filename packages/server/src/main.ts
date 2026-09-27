import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServer } from "./app";

const root = resolve(fileURLToPath(import.meta.url), "../../../..");
const port = Number(process.env.PORT ?? 4400);
const app = await buildServer({
  replayDir: resolve(process.env.REPLAY_DIR ?? resolve(root, "replays")),
  webDir: process.env.WEB_DIR ?? resolve(root, "packages/web/dist"),
  tickRate: process.env.TICK_RATE ? Number(process.env.TICK_RATE) : undefined,
  prepMs: process.env.PREP_MS ? Number(process.env.PREP_MS) : undefined,
  logger: process.env.LOG === "1",
});
await app.listen({ port, host: process.env.HOST ?? "0.0.0.0" });
console.log(`Age of Agents server on http://localhost:${port}`);
