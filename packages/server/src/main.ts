import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { localReplays } from "@castellan/shared/local-data";
import { buildServer } from "./app";

// The server process reads its environment here only; buildServer and the modules below take options.
const root = resolve(fileURLToPath(import.meta.url), "../../../..");
const localEnv = resolve(root, "packages/server/.env.local");
if (existsSync(localEnv)) loadEnvFile(localEnv);
const env = process.env;
const port = Number(env.PORT ?? 4400);
const app = await buildServer({
  replayDir: resolve(localReplays()),
  webDir: env.WEB_DIR ?? resolve(root, "packages/web/dist"),
  tickRate: env.TICK_RATE ? Number(env.TICK_RATE) : undefined,
  prepMs: env.PREP_MS ? Number(env.PREP_MS) : undefined,
  // Access logs never include queries, headers or bodies.
  accessLog: env.LOG === "1",
  customStats: env.CASTELLAN_CUSTOM_STATS === "1",
  analytics: { key: env.POSTHOG_PROJECT_TOKEN, host: env.POSTHOG_HOST, environment: env.NODE_ENV },
});
await app.listen({ port, host: env.HOST ?? "0.0.0.0" });
console.log(`Castellan server on http://localhost:${port}`);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, async () => {
  if (stopping) return;
  stopping = true;
  try { await app.close(); process.exit(0); }
  catch (error) { console.error("Unable to save server progress:", error); process.exit(1); }
});
