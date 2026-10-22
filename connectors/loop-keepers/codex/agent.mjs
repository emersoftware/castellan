// @ts-check
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectorVersion, launchConfiguration, reportConfiguration } from "../metadata.mjs";
import { serverUrl } from "../game.mjs";
import { MIN_INTERVAL_MS, promptOf } from "../turns.mjs";
import { exitOf, playSeat } from "../decisions.mjs";

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
  if (env.CASTELLAN_OPEN === "1") { const { playOpen } = await import("../../open-arena/src/agent.mjs"); await playOpen(env.CASTELLAN_ARENA_SEAT); return 0; }
  if (!env.CASTELLAN_TOKEN) throw new Error("set CASTELLAN_TOKEN");
  const root = await mkdtemp(join(tmpdir(), "castellan-codex-"));
  try {
    const { home, workspace } = await isolatedHome(root, env);
    const prompt = promptOf(env);
    await reportConfiguration(launchConfiguration({ connector: "codex", args, prompt, env,
      connectorVersion: env.CASTELLAN_CONNECTOR_VERSION || await connectorVersion(codexBin(env)) }), { env, fetchImpl });
    return await playSeat({ name: "codex", prompt, env, fetchImpl, minIntervalMs, pollMs, decide: async (turn, { session, signal }) => {
      const child = spawnImpl(codexBin(env), codexArgs({ workspace, session, args, prompt: turn }), {
        cwd: workspace, env: { ...env, CASTELLAN_SERVER: serverUrl(env.CASTELLAN_SERVER), CODEX_HOME: home }, stdio: ["ignore", "pipe", "inherit"],
      });
      let thread = session, turnComplete = false;
      const code = await exitOf(child, signal, raw => {
        try {
          const event = JSON.parse(raw);
          if (event.type === "thread.started" && typeof event.thread_id === "string") thread = event.thread_id;
          if (event.type === "turn.completed") turnComplete = true;
        } catch { /* plain CLI diagnostics */ }
      });
      if (code !== 0 || !turnComplete || !thread) throw Object.assign(new Error(`Codex decision incomplete (exit ${code})`), { session: thread });
      return { session: thread };
    } });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) play().then(code => { process.exitCode = code; }, error => { console.error(error.message); process.exitCode = 1; });
