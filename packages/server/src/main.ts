import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { localReplays } from "@castellan/shared/local-data";
import { buildServer } from "./app";

const root = resolve(fileURLToPath(import.meta.url), "../../../..");
const localEnv = resolve(root, "packages/server/.env.local");
if (existsSync(localEnv)) loadEnvFile(localEnv);
const port = Number(process.env.PORT ?? 4400);
const app = await buildServer({
  replayDir: resolve(localReplays()),
  webDir: process.env.WEB_DIR ?? resolve(root, "packages/web/dist"),
  tickRate: process.env.TICK_RATE ? Number(process.env.TICK_RATE) : undefined,
  prepMs: process.env.PREP_MS ? Number(process.env.PREP_MS) : undefined,
});
await app.listen({ port, host: process.env.HOST ?? "0.0.0.0" });
console.log(`Castellan server on http://localhost:${port}`);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, async () => {
  if (stopping) return;
  stopping = true;
  try { await app.close(); process.exit(0); }
  catch (error) { console.error("Unable to save server progress:", error); process.exit(1); }
});
