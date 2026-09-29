import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { cli, runtimeDir, VERSION, verifyRuntime } from "./runtime.mjs";
import { loadKey } from "./key.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export function options(args) {
  const { values } = parseArgs({ args, options: {
    model: { type: "string", default: "deepseek-flash" },
    effort: { type: "string", default: "low" },
    check: { type: "boolean", default: false },
  } });
  if (!/^[\w.-]+$/.test(values.model)) throw new Error("Invalid DeepSeek model id");
  if (!["off", "low", "high", "max"].includes(values.effort)) throw new Error("effort must be off, low, high or max");
  return values;
}

export async function preparePlayer({ root, token, server = "http://localhost:4400", key, model = "deepseek-flash", effort = "low", env = process.env, baseURL }) {
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
  ]);
  const patch = ids.filter((id) => id.startsWith("tool-") || extraDisabled.has(id)).map((id) => ({ id, disabled: true }));
  patch.push(
    { id: "tools", config: { mode: "native" } },
    { id: "session-persistence-jsonl", config: { root: join(home, "sessions"), compression: "none" } },
    { id: "agent-default-model", config: { provider: "deepseek-official", model, reasoningEffort: effort } },
    { id: "llm-deepseek", config: { apiKeyEnv: "DEEPSEEK_API_KEY", reasoningEffort: effort, ...(baseURL ? { baseURL } : {}) } },
    { id: "sandbox-policy", config: { mode: "read-only", workspaceRoot: workspace } },
    { id: "approval", config: { policy: "never" } },
    { id: "system-prompt", config: { personaPrefix: "You are playing Age of Agents through its MCP tools.", personaSuffix: "" } },
    { insert: [
      { id: "mcp-aoa", name: "@deepseek-ai/dsh-mcp-client", config: { serverName: "aoa", transport: "stdio", command: process.execPath,
        args: [resolve(here, "../../mcp/bin/aoa-mcp.mjs")], env: { AOA_SERVER: server, AOA_TOKEN: token }, cwd: workspace, failOnStartupError: true, toolCallTimeoutMs: 60000 } },
      { id: "aoa-game-tools", name: join(here, "game-tools.mjs") },
    ] },
  );
  const patchPath = join(root, "aoa.patch.json");
  await writeFile(patchPath, JSON.stringify(patch, null, 2), { mode: 0o600 });
  // Do not inherit provider credentials, user profile overrides or instrumentation.
  const childEnv = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SYSTEMROOT", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"].filter((k) => env[k]).map((k) => [k, env[k]]));
  Object.assign(childEnv, { DSH_HOME: home, DSH_TELEMETRY_DISABLED: "1", DEEPSEEK_API_KEY: key ?? "", AOA_SERVER: server, AOA_TOKEN: token });
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

export async function main(args = process.argv.slice(2), env = process.env) {
  const opts = options(args);
  if (!opts.check && !env.AOA_TOKEN) throw new Error("set AOA_TOKEN (see aoa new or aoa run-series)");
  const key = opts.check ? undefined : await loadKey(env);
  if (!opts.check && !key) throw new Error("set DEEPSEEK_API_KEY or run node connectors/loop-keepers/deepseek/key.mjs");
  await verifyRuntime();
  const runs = join(homedir(), ".local", "state", "aoa", "deepseek");
  await mkdir(runs, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(runs, "run-"));
  const player = await preparePlayer({ root, token: env.AOA_TOKEN ?? "check-only", server: env.AOA_SERVER, key, ...opts, env });
  let prompt = await readFile(resolve(here, "../claude-code/PLAY.md"), "utf8");
  if (env.AOA_RESUME) prompt = `You were restarted in the middle of the match: call state first, then keep playing.\n\n${prompt}`;
  // Optional experiment instruction for this player only; kept across relaunches.
  if (env.AOA_DIRECTIVE) {
    prompt += `\n\n${env.AOA_DIRECTIVE}`;
    await writeFile(join(root, "run.json"), JSON.stringify({ ...player.metadata, directive: env.AOA_DIRECTIVE }, null, 2), { mode: 0o600 });
  }
  console.error(`aoa deepseek: ${opts.model} (${opts.effort}), dsh ${VERSION}; logs ${root}${env.AOA_DIRECTIVE ? `; directive: ${env.AOA_DIRECTIVE}` : ""}`);
  const launchArgs = opts.check ? [...player.args, "--dump-config"] : [...player.args, "--json", prompt];
  const child = spawn(process.execPath, launchArgs, { cwd: player.workspace, env: player.env, stdio: ["ignore", opts.check ? "pipe" : "inherit", "inherit"] });
  if (opts.check) child.stdout.resume(); // Composed config contains a game token; never print it.
  const interrupt = () => child.kill("SIGINT"), terminate = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt); process.on("SIGTERM", terminate);
  let code;
  try { code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", (code) => resolve(code ?? 1)); }); }
  finally { process.off("SIGINT", interrupt); process.off("SIGTERM", terminate); }
  if (!opts.check) console.error(`aoa deepseek usage: ${JSON.stringify(await usage(root))}`);
  else if (!code) console.log(`DeepSeek Harness ${VERSION}: profile valid (no model request made)`);
  return code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then((code) => { process.exitCode = code; }, (error) => { console.error(error.message); process.exitCode = 1; });
