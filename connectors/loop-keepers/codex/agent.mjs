// @ts-check
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { connectorVersion, launchConfiguration, reportConfiguration, reportActivity } from "../metadata.mjs";
import { observedSeat, seat, seatOver, serverUrl } from "../game.mjs";
import { MIN_INTERVAL_MS, promptOf, turnFor } from "../turns.mjs";

const here = dirname(fileURLToPath(import.meta.url));
/** The Codex CLI to run: CASTELLAN_CODEX_BIN, else `codex` on PATH. */
export const codexBin = (env = process.env) => env.CASTELLAN_CODEX_BIN || "codex";

/** `codex exec` cut off from the host: read-only in an empty workspace, without the user's config,
 * rules, project docs, web search or built-in tools, and never asking for approval. */
export function isolatedExec({ workspace, session }) {
  return ["exec", "-s", "read-only", "-C", workspace, ...(session ? ["resume", session] : []),
    "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules",
    ...["shell_tool", "unified_exec", "view_image", "browser_use", "browser_use_external", "in_app_browser", "computer_use",
      "image_generation", "apps", "plugins", "remote_plugin", "hooks", "multi_agent", "memories", "skill_search", "tool_suggest", "goals", "sleep_tool"].flatMap(f => ["--disable", f]),
    "-c", 'web_search="disabled"', "-c", "project_doc_max_bytes=0", "-c", "approval_policy=never"];
}

/** A private CODEX_HOME in root that shares only the user's Codex login, and an empty workspace. */
export async function isolatedHome(root, env = process.env) {
  const home = join(root, "home"), workspace = join(root, "workspace");
  await mkdir(home); await mkdir(workspace);
  await symlink(join(env.CODEX_HOME || join(homedir(), ".codex"), "auth.json"), join(home, "auth.json"));
  return { home, workspace };
}

function codexArgs({ workspace, session, args, prompt }) {
  return [...isolatedExec({ workspace, session }), "--json",
    "-c", 'mcp_servers.castellan.command="node"', "-c", `mcp_servers.castellan.args=${JSON.stringify([resolve(here, "../../mcp/bin/castellan-mcp.mjs")])}`,
    "-c", 'mcp_servers.castellan.env_vars=["CASTELLAN_SERVER","CASTELLAN_TOKEN"]',
    "-c", "mcp_servers.castellan.tool_timeout_sec=60", "-c", 'mcp_servers.castellan.default_tools_approval_mode="approve"', ...args, prompt];
}

/** Supplies observations, never strategy. One decision in flight per seat;
 * every later decision resumes this match's conversation. */
export async function play({ env = process.env, args = process.argv.slice(2), fetchImpl = fetch, spawnImpl = spawn,
  minIntervalMs = MIN_INTERVAL_MS, pollMs = 2000 } = {}) {
  if (!env.CASTELLAN_TOKEN) throw new Error("set CASTELLAN_TOKEN");
  const root = await mkdtemp(join(tmpdir(), "castellan-codex-"));
  let child, session, stopped = false, finished = false, lastDeliveredTick = 0, failures = 0;
  const abort = new AbortController();
  const stop = () => { stopped = true; abort.abort(); child?.kill("SIGTERM"); };
  const game = seat({ env, fetchImpl, signal: abort.signal });
  const delay = ms => sleep(ms, undefined, { signal: abort.signal });
  let watcher;
  try {
    const { home, workspace } = await isolatedHome(root, env);
    const base = promptOf(env);
    await reportConfiguration(launchConfiguration({ connector: "codex", args, prompt: base, env,
      connectorVersion: env.CASTELLAN_CONNECTOR_VERSION || await connectorVersion(codexBin(env)) }), { env, fetchImpl });
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
    const watch = async () => {
      if (stopped) return;
      try {
        if (seatOver(await game.status())) { finished = true; stop(); return; }
      } catch { /* next poll */ }
      if (!stopped) watcher = setTimeout(watch, pollMs);
    };
    watcher = setTimeout(watch, pollMs);
    while (!stopped) {
      const started = Date.now();
      try {
        const observation = await game.observation(lastDeliveredTick);
        const seen = observedSeat(observation);
        if (seatOver(seen)) { finished = true; break; }
        const prompt = turnFor(observation, { delivered: Boolean(session), prompt: base });
        if (!prompt) { await delay(1000); continue; }
        const observedTick = seen.tick;
        await reportActivity("deciding", { env, fetchImpl });
        child = spawnImpl(codexBin(env), codexArgs({ workspace, session, args, prompt }), {
          cwd: workspace, env: { ...env, CASTELLAN_SERVER: serverUrl(env.CASTELLAN_SERVER), CODEX_HOME: home }, stdio: ["ignore", "pipe", "inherit"],
        });
        let pending = "", turnComplete = false;
        const line = raw => {
          try {
            const event = JSON.parse(raw);
            if (event.type === "thread.started" && typeof event.thread_id === "string") session = event.thread_id;
            if (event.type === "turn.completed") turnComplete = true;
          } catch { /* plain CLI diagnostics */ }
        };
        child.stdout.on("data", chunk => {
          process.stdout.write(chunk);
          const lines = (pending + chunk).split("\n"); pending = lines.pop() ?? ""; lines.forEach(line);
        });
        const code = await new Promise((resolveCode, reject) => { child.on("error", reject); child.on("close", resolveCode); });
        line(pending); child = undefined;
        if (stopped) break;
        if (code !== 0 || !turnComplete || !session) throw new Error(`Codex decision incomplete (exit ${code})`);
        if (Number.isFinite(observedTick)) lastDeliveredTick = observedTick;
        failures = 0;
        await reportActivity("between_decisions", { env, fetchImpl });
        await delay(Math.max(0, minIntervalMs - (Date.now() - started)));
      } catch (error) {
        if (stopped) break;
        failures++;
        const ms = Math.min(30_000, 2000 * failures);
        console.error(`castellan codex: ${/** @type {Error} */ (error).message}; retry in ${ms / 1000}s, preserving session and observation cursor`);
        await reportActivity("connector_retry", { env, fetchImpl, retryAt: new Date(Date.now() + ms).toISOString() });
        await delay(ms).catch(() => {});
      }
    }
    return finished ? 0 : 1;
  } finally {
    stop(); clearTimeout(watcher);
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
    await reportActivity("stopped", { env, fetchImpl });
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) play().then(code => { process.exitCode = code; }, error => { console.error(error.message); process.exitCode = 1; });
