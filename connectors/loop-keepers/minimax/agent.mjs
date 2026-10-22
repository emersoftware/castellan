// @ts-check
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { cli, VERSION, verifyRuntime } from "./runtime.mjs";
import { loadKey } from "./key.mjs";
import { launchConfiguration, reportConfiguration } from "../metadata.mjs";
import { serverUrl } from "../game.mjs";
import { MIN_INTERVAL_MS, promptOf } from "../turns.mjs";
import { exitOf, lineReader, playSeat } from "../decisions.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MODEL = "MiniMax-M3.1-Flash";
export function options(args) {
  const { values } = parseArgs({ args, options: {
    model: { type: "string", default: DEFAULT_MODEL },
    effort: { type: "string", default: "low" },
    check: { type: "boolean", default: false },
  } });
  if (values.model !== DEFAULT_MODEL) throw new Error(`This connector supports ${DEFAULT_MODEL}; another model needs its own verified catalog settings.`);
  if (!["low", "medium", "high", "xhigh", "max"].includes(values.effort)) throw new Error("effort must be low, medium, high, xhigh or max");
  return values;
}

/** The official CLI owns tools, model requests and session persistence. */
export async function preparePlayer({ root, token, server = serverUrl(), key = "", model = DEFAULT_MODEL, effort = "low", env = process.env, baseURL = "https://api.minimax.io/anthropic" }) {
  const workspace = join(root, "workspace"), home = join(root, "home"), data = join(root, "mcode");
  for (const path of [workspace, home, data]) await mkdir(path, { recursive: true, mode: 0o700 });
  // JSON is valid YAML. mcode's supported BYOK configuration stores the key in
  // plaintext; keep it in this private attempt only, never in replay metadata.
  const configPath = join(data, "config.yaml");
  const config = {
    minimaxModelSource: "minimax_api_key",
    minimax_api: { apiKey: key, baseURL },
    // The npm build still ships the Preview ID. Declare the released ID using
    // the official source catalog's model settings, without changing the CLI.
    provider: { minimax: { models: { [model]: {
      name: model, reasoning: true, tool_call: true,
      limit: { context: 512000, output: 128000 },
      thinking: { effortOptions: ["default", "low", "medium", "high", "xhigh", "max"], defaultEffort: "default" },
      thinking_config: { mode: "forced_on" },
      variants: { thinking: { thinking: { type: "adaptive" } } },
      options: { reasoningSummary: "auto" },
    } } } },
    agents: { default: { tools: [], builtinTools: [], skills: [], features: { mavis: false, delegation: false, webSearch: false } } },
    memory: { enabled: false, proactive: false },
    askUser: { enabled: false },
    skills: { external: { enabled: false } },
    skillEvolve: { enabled: false },
    mcpToolSearch: { enabled: false },
    telemetry: { enabled: false, metrics: false, diagnostics: false },
    sessionTitle: { enabled: false },
    beta: Object.fromEntries(["autoMemory", "skillEvolve", "skillEvolveBuiltinMr", "skillProposal", "browserBridge", "filePanelBrowser",
      "filePanelBrowserMultiTab", "browserUseTooling", "browserUseAutoOpenPanel", "browserAgentCursor", "desktopPlanMode",
      "peek", "keepAlive", "promptOverride", "asr", "taskHistoryProjectGrouping", "threadGoal", "mcodeTools", "codexOAuth"].map(name => [name, false])),
  };
  await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  await writeFile(join(data, "mcp.json"), JSON.stringify({ mcpServers: { castellan: {
    command: process.execPath, args: [resolve(here, "../../mcp/bin/castellan-mcp.mjs")],
    env: { CASTELLAN_SERVER: server, CASTELLAN_TOKEN: token }, enabled: true, timeout: 60000,
  } } }, null, 2), { mode: 0o600 });
  const childEnv = Object.fromEntries(["PATH", "TMPDIR", "LANG", "LC_ALL", "SYSTEMROOT", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"]
    .filter(k => env[k]).map(k => [k, env[k]]));
  Object.assign(childEnv, { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local", "share"),
    MINIMAX_DATA_DIR: data, CASTELLAN_SERVER: server, CASTELLAN_TOKEN: token });
  const metadata = { harness: "minimax-code", version: VERSION, model, effort, workspace, data,
    builtinTools: ["skill", "task_query", "task_output", "task_stop"] };
  await writeFile(join(root, "run.json"), JSON.stringify(metadata, null, 2), { mode: 0o600 });
  return { root, workspace, data, home, configPath, env: childEnv, metadata,
    // A native tool loop can span the whole match. The game-status watcher
    // terminates it on elimination/end; a short exec timeout cuts off play.
    args: [cli, "exec", "--config", configPath, "--cwd", workspace, "--model", `minimax/${model}`,
      "--effort", effort, "--permission", "full", "--output-format", "stream-json"] };
}

/** The session and result of one mcode run, from its stream-json output (`push` chunks or complete `line`s). */
export function decisionEvents() {
  let session, result;
  /** @param {string} raw */
  const line = raw => {
    if (!raw.trim()) return;
    let event; try { event = JSON.parse(raw); } catch { return; }
    if (event.schemaVersion !== 1) return;
    if (event.sessionId) session = event.sessionId;
    if (event.type === "exec.completed") result = event.result;
  };
  const lines = lineReader(line);
  return { push: lines.push, line, finish() { lines.end(); return { session, result }; } };
}

export async function main(args = process.argv.slice(2), env = process.env, { fetchImpl = fetch, spawnImpl = spawn,
  minIntervalMs = MIN_INTERVAL_MS, pollMs = 2000 } = {}) {
  const opts = options(args);
  if (!opts.check && !env.CASTELLAN_TOKEN) throw new Error("set CASTELLAN_TOKEN (see castellan new or castellan run-series)");
  const key = opts.check ? "check-only" : await loadKey(env);
  if (!key) throw new Error("set MINIMAX_API_KEY or run node connectors/loop-keepers/minimax/key.mjs");
  await verifyRuntime();
  const runs = join(homedir(), ".local", "state", "castellan", "minimax");
  await mkdir(runs, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(runs, "run-"));
  const player = await preparePlayer({ root, token: env.CASTELLAN_TOKEN ?? "check-only", server: serverUrl(env.CASTELLAN_SERVER), key, ...opts, env });
  if (opts.check) {
    const child = spawnImpl(process.execPath, [cli, "provider", "list", "--json"], { cwd: player.workspace, env: player.env, stdio: ["ignore", "pipe", "inherit"] });
    child.stdout?.resume();
    const code = await new Promise((done, reject) => { child.on("error", reject); child.on("close", c => done(c ?? 1)); });
    if (!code) console.log(`MiniMax Code ${VERSION}: configuration loaded (no model request made; MCP tested separately)`);
    return code;
  }
  const prompt = promptOf(env);
  if (env.CASTELLAN_DIRECTIVE) await writeFile(join(root, "run.json"), JSON.stringify({ ...player.metadata, directive: env.CASTELLAN_DIRECTIVE }, null, 2), { mode: 0o600 });
  console.error(`castellan minimax: ${opts.model} (${opts.effort}), mcode ${VERSION}; logs ${root}`);
  await reportConfiguration(launchConfiguration({ connector: "minimax-code", model: opts.model, effort: opts.effort, connectorVersion: VERSION, prompt, env }), { env, fetchImpl });
  const totals = { decisions: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, incomplete: false };
  try {
    return await playSeat({ name: "minimax", prompt, env, fetchImpl, minIntervalMs, pollMs, maxFailures: 3, backoffMs: failures => 2000 * failures,
      decide: async (turn, { session, signal }) => {
        const events = decisionEvents();
        const child = spawnImpl(process.execPath, [...player.args, ...(session ? ["--session", session] : []), "--input", "-"],
          { cwd: player.workspace, env: player.env, stdio: ["pipe", "pipe", "inherit"] });
        child.stdin.on("error", () => {}); // Early CLI failure may close stdin.
        child.stdin.end(turn);
        const code = await exitOf(child, signal, events.line);
        const decision = events.finish();
        const result = decision.result;
        if (result) {
          totals.decisions++;
          for (const field of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"]) totals[field] += result.usage?.[field] ?? 0;
          if (result.usageIncomplete || !result.usage) totals.incomplete = true;
        } else totals.incomplete = true;
        await writeFile(join(root, "usage.json"), JSON.stringify(totals, null, 2), { mode: 0o600 });
        const kept = decision.session || session;
        if (code !== 0 || result?.status !== "succeeded" || !kept) throw Object.assign(new Error(`mcode decision incomplete (exit ${code}, status ${result?.status ?? "missing"})`), { session: kept });
        return { session: kept };
      } });
  } finally {
    console.error(`castellan minimax usage: ${JSON.stringify(totals)}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then(code => { process.exitCode = code; }, error => { console.error(error.message); process.exitCode = 1; });
