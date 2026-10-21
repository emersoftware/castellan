// @ts-check
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { cli, runtimeDir, VERSION, verifyRuntime } from "./runtime.mjs";
import { loadKey } from "./key.mjs";
import { launchConfiguration, reportActivity, reportConfiguration } from "../metadata.mjs";
import { observedSeat, seat, seatOver, serverUrl } from "../game.mjs";
import { MIN_INTERVAL_MS, promptOf, turnFor } from "../turns.mjs";
/** @import { Effort } from "../../../packages/shared/src/replayMetadata.ts" */

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MODEL = "deepseek-flash";
/** @type {Effort} */
const DEFAULT_EFFORT = "low";
/**
 * DeepSeek Harness reasoning efforts.
 * @type {Effort[]}
 */
export const efforts = ["off", "low", "high", "max"];
export function options(args) {
  const { values } = parseArgs({ args, options: {
    model: { type: "string", default: DEFAULT_MODEL },
    effort: { type: "string", default: DEFAULT_EFFORT },
    check: { type: "boolean", default: false },
  } });
  if (!/^[\w.-]+$/.test(values.model)) throw new Error("Invalid DeepSeek model id");
  if (!efforts.some(known => known === values.effort)) throw new Error("effort must be off, low, high or max");
  return values;
}

/** @param {{ root: string, token: string, server?: string, key?: string, model?: string, effort?: string, env?: NodeJS.ProcessEnv, baseURL?: string }} player */
export async function preparePlayer({ root, token, server = serverUrl(), key, model = DEFAULT_MODEL, effort = DEFAULT_EFFORT, env = process.env, baseURL }) {
  const workspace = join(root, "workspace"), home = join(root, "dsh");
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  await mkdir(home, { recursive: true, mode: 0o700 });
  const base = await readFile(join(runtimeDir, "node_modules/@deepseek-ai/dsh-base/cordis.patch.yml"), "utf8");
  const ids = [...base.matchAll(/^\s*- id: ([\w-]+)/gm)].map((m) => m[1]);
  const extraDisabled = new Set([
    "agent-instructions", "skill-filesystem", "skill", "plan-mode", "goal-round-driver", "subagent",
    "subagent-spawn-in-process", "subagent-fork-in-process", "workflow-ptc", "ptc-runtime",
    "mcp-resources", "spill-policy", "repeat-tool-reminder", "session-title-llm", "hmr", "plugin-manager",
    "web", "web-search-deepseek", "web-fetch-http", "deepseek-account", "llm-deepseek-account", "llm-pi-ai",
    "session-log-deepseek", "plugin-package-inventory-deepseek", "session-telemetry-otel",
    // Without file or shell tools there is nothing to sandbox, and no policy to describe to the model.
    "sandbox", "bash-sandbox", "pwsh-sandbox", "fs-sandbox",
  ]);
  /** @type {object[]} */
  const patch = ids.filter((id) => id.startsWith("tool-") || extraDisabled.has(id)).map((id) => ({ id, disabled: true }));
  patch.push(
    { id: "tools", config: { mode: "native" } },
    { id: "session-persistence-jsonl", config: { root: join(home, "sessions"), compression: "none" } },
    { id: "agent-default-model", config: { provider: "deepseek-official", model, reasoningEffort: effort } },
    { id: "llm-deepseek", config: { apiKeyEnv: "DEEPSEEK_API_KEY", reasoningEffort: effort, ...(baseURL ? { baseURL } : {}) } },
    // No file or shell tools are enabled, so no sandbox or approval policy is described to the model.
    { id: "sandbox-policy", disabled: true },
    { id: "approval", disabled: true },
    { id: "system-prompt", config: { personaPrefix: "", personaSuffix: "" } },
    { insert: [
      { id: "mcp-castellan", name: "@deepseek-ai/dsh-mcp-client", config: { serverName: "castellan", transport: "stdio", command: process.execPath,
        args: [resolve(here, "../../mcp/bin/castellan-mcp.mjs")], env: { CASTELLAN_SERVER: server, CASTELLAN_TOKEN: token }, cwd: workspace, failOnStartupError: true, toolCallTimeoutMs: 60000 } },
      { id: "castellan-game-tools", name: join(here, "game-tools.mjs") },
    ] },
  );
  const patchPath = join(root, "castellan.patch.json");
  await writeFile(patchPath, JSON.stringify(patch, null, 2), { mode: 0o600 });
  // Do not inherit provider credentials, user profile overrides or instrumentation.
  const childEnv = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SYSTEMROOT", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"].filter((k) => env[k]).map((k) => [k, env[k]]));
  Object.assign(childEnv, { DSH_HOME: home, DSH_TELEMETRY_DISABLED: "1", DEEPSEEK_API_KEY: key ?? "", CASTELLAN_SERVER: server, CASTELLAN_TOKEN: token });
  const metadata = { harness: "deepseek-harness", version: VERSION, model, effort, workspace, home };
  await writeFile(join(root, "run.json"), JSON.stringify(metadata, null, 2), { mode: 0o600 });
  return { root, workspace, home, patchPath, env: childEnv, metadata, args: [cli, "--profile", "headless", "--patch", patchPath] };
}

// Provider-reported usage in durable assistant events; no price assumptions.
export async function usage(root) {
  const totals = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  async function scan(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if (entry.name.endsWith(".jsonl")) for (const line of (await readFile(path, "utf8")).split("\n")) {
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type !== "assistant/message" || !e.data?.usage) continue;
        totals.calls++;
        for (const field of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"]) totals[field] += e.data.usage[field] ?? 0;
      }
    }
  }
  await scan(join(root, "dsh", "sessions"));
  await writeFile(join(root, "usage.json"), JSON.stringify(totals, null, 2), { mode: 0o600 });
  return totals;
}

/**
 * One decision per dsh run, like the Codex keeper: the first run gets the shared first turn
 * and every later run resumes the same Session with the next observation.
 */
async function main(args = process.argv.slice(2), env = process.env, { fetchImpl = fetch, spawnImpl = spawn,
  minIntervalMs = MIN_INTERVAL_MS, pollMs = 2000 } = {}) {
  const opts = options(args);
  if (!opts.check && !env.CASTELLAN_TOKEN) throw new Error("set CASTELLAN_TOKEN (see castellan new or castellan run-series)");
  const key = opts.check ? undefined : await loadKey(env);
  if (!opts.check && !key) throw new Error("set DEEPSEEK_API_KEY or run node connectors/loop-keepers/deepseek/key.mjs");
  await verifyRuntime();
  const runs = join(homedir(), ".local", "state", "castellan", "deepseek");
  await mkdir(runs, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(runs, "run-"));
  const player = await preparePlayer({ root, token: env.CASTELLAN_TOKEN ?? "check-only", server: serverUrl(env.CASTELLAN_SERVER), key, ...opts, env });
  if (opts.check) {
    const child = spawnImpl(process.execPath, [...player.args, "--dump-config"], { cwd: player.workspace, env: player.env, stdio: ["ignore", "pipe", "inherit"] });
    child.stdout?.resume(); // Composed config contains a game token; never print it.
    const code = await new Promise((resolveCode, reject) => { child.on("error", reject); child.on("exit", (c) => resolveCode(c ?? 1)); });
    if (!code) console.log(`DeepSeek Harness ${VERSION}: profile valid (no model request made)`);
    return code;
  }
  const prompt = promptOf(env);
  if (env.CASTELLAN_DIRECTIVE) await writeFile(join(root, "run.json"), JSON.stringify({ ...player.metadata, directive: env.CASTELLAN_DIRECTIVE }, null, 2), { mode: 0o600 });
  console.error(`castellan deepseek: ${opts.model} (${opts.effort}), dsh ${VERSION}; logs ${root}${env.CASTELLAN_DIRECTIVE ? `; directive: ${env.CASTELLAN_DIRECTIVE}` : ""}`);
  await reportConfiguration(launchConfiguration({ connector: "deepseek-harness", model: opts.model,
    effort: opts.effort, connectorVersion: VERSION, prompt, env }), { env, fetchImpl });
  let child, session, watcher, stopped = false, finished = false, lastDeliveredTick = 0, failures = 0;
  const abort = new AbortController();
  const stop = () => { stopped = true; abort.abort(); child?.kill("SIGTERM"); };
  const game = seat({ env, fetchImpl, signal: abort.signal });
  const delay = ms => sleep(ms, undefined, { signal: abort.signal });
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  const watch = async () => {
    if (stopped) return;
    try { if (seatOver(await game.status())) { finished = true; stop(); return; } } catch { /* next poll */ }
    if (!stopped) watcher = setTimeout(watch, pollMs);
  };
  watcher = setTimeout(watch, pollMs);
  try {
    while (!stopped) {
      const started = Date.now();
      try {
        const observation = await game.observation(lastDeliveredTick);
        const seen = observedSeat(observation);
        if (seatOver(seen)) { finished = true; break; }
        const turn = turnFor(observation, { delivered: Boolean(session), prompt, resumed: Boolean(env.CASTELLAN_RESUME) });
        if (!turn) { await delay(1000); continue; }
        await reportActivity("deciding", { env, fetchImpl });
        child = spawnImpl(process.execPath, [...player.args, "--json", ...(session ? ["--session-id", session] : []), turn],
          { cwd: player.workspace, env: player.env, stdio: ["ignore", "pipe", "inherit"] });
        let pending = "", final = false;
        const line = raw => {
          try {
            const event = JSON.parse(raw);
            if (event.type === "session" && typeof event.sessionId === "string") session = event.sessionId;
            if (event.type === "final") final = true;
          } catch { /* diagnostics */ }
        };
        child.stdout.on("data", chunk => {
          process.stdout.write(chunk);
          const lines = (pending + chunk).split("\n"); pending = lines.pop() ?? ""; lines.forEach(line);
        });
        const code = await new Promise((resolveCode, reject) => { child.on("error", reject); child.on("close", resolveCode); });
        line(pending); child = undefined;
        if (stopped) break;
        if (code !== 0 || !final || !session) throw new Error(`dsh decision incomplete (exit ${code})`);
        if (Number.isFinite(seen.tick)) lastDeliveredTick = seen.tick;
        failures = 0;
        await reportActivity("between_decisions", { env, fetchImpl });
        await delay(Math.max(0, minIntervalMs - (Date.now() - started)));
      } catch (error) {
        if (stopped) break;
        failures++;
        const ms = Math.min(30_000, 2000 * failures);
        console.error(`castellan deepseek: ${/** @type {Error} */ (error).message}; retry in ${ms / 1000}s, preserving session and observation cursor`);
        await reportActivity("connector_retry", { env, fetchImpl, retryAt: new Date(Date.now() + ms).toISOString() });
        await delay(ms).catch(() => {});
      }
    }
    return finished ? 0 : 1;
  } finally {
    stop(); clearTimeout(watcher);
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
    console.error(`castellan deepseek usage: ${JSON.stringify(await usage(root))}`);
    await reportActivity("stopped", { env, fetchImpl });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then((code) => { process.exitCode = code; }, (error) => { console.error(error.message); process.exitCode = 1; });
