// @ts-check
import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { connectorVersion, launchConfiguration, reportConfiguration } from "../metadata.mjs";
import { configFile, runDirectory, serverUrl } from "../game.mjs";
import { loadKey as loadDeepSeekKey } from "../deepseek/key.mjs";
import { MIN_INTERVAL_MS, promptOf } from "../turns.mjs";
import { exitOf, playSeat } from "../decisions.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MODEL = "openrouter/~deepseek/deepseek-flash-latest";

export function options(args) {
  const { values } = parseArgs({ args, options: {
    model: { type: "string", default: DEFAULT_MODEL },
    variant: { type: "string" },
  } });
  if (!/^[\w.~-]+\/[\w.~:/-]+$/.test(values.model)) throw new Error("model must be provider/model-id");
  if (values.variant !== undefined && !/^[\w-]+$/.test(values.variant)) throw new Error("Invalid variant");
  return values;
}

// OpenRouter key: env, then a private castellan key file, then OpenCode's own stored credential.
export async function loadKey(env = process.env) {
  if (env.OPENROUTER_API_KEY?.trim()) return env.OPENROUTER_API_KEY.trim();
  const file = env.CASTELLAN_OPENROUTER_KEY_FILE || configFile("openrouter-api-key");
  try {
    if ((await stat(file)).mode & 0o077) throw new Error(`OpenRouter key file must be private: chmod 600 ${file}`);
    return (await readFile(file, "utf8")).trim();
  } catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT") throw error; }
  const auth = join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode", "auth.json");
  try { return JSON.parse(await readFile(auth, "utf8")).openrouter?.key?.trim() ?? ""; }
  catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return ""; throw error; }
}

// Anthropic key and workspace: env, then private castellan files. A key not scoped to a workspace needs the workspace id.
async function loadAnthropic(env = process.env) {
  const read = async (value, file, what) => {
    if (value?.trim()) return value.trim();
    try {
      if ((await stat(file)).mode & 0o077) throw new Error(`${what} file must be private: chmod 600 ${file}`);
      return (await readFile(file, "utf8")).trim();
    } catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return ""; throw error; }
  };
  return {
    key: await read(env.ANTHROPIC_API_KEY, env.CASTELLAN_ANTHROPIC_KEY_FILE || configFile("anthropic-api-key"), "Anthropic key"),
    workspace: await read(env.CASTELLAN_ANTHROPIC_WORKSPACE, configFile("anthropic-workspace-id"), "Anthropic workspace"),
  };
}

/** @param {{ root: string, token: string, server?: string, key?: string, workspace?: string, model?: string, variant?: string, env?: NodeJS.ProcessEnv }} player */
export async function preparePlayer({ root, token, server = serverUrl(), key, workspace: anthropicWorkspace, model = DEFAULT_MODEL, variant, env = process.env }) {
  const workspace = join(root, "workspace"), home = join(root, "home");
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  await mkdir(home, { recursive: true, mode: 0o700 });
  // Only the castellan MCP tools; every built-in (shell, files, web, subagents, skills) is off and denied.
  const config = {
    $schema: "https://opencode.ai/config.json",
    autoupdate: false, share: "disabled", snapshot: false, formatter: false, lsp: false,
    enabled_providers: [model.split("/")[0]],
    mcp: { castellan: { type: "local", command: [process.execPath, resolve(here, "../../mcp/bin/castellan-mcp.mjs")],
      environment: { CASTELLAN_SERVER: server, CASTELLAN_TOKEN: token }, timeout: 60000 } },
    tools: { "*": false, "castellan_*": true },
    permission: { "*": "deny", "castellan_*": "allow" },
  };
  // OpenCode's built-in OpenRouter variants stop at "low"; "none" turns reasoning off.
  const [provider, ...rest] = model.split("/");
  const modelConfig = {};
  if (variant === "none" && provider === "openrouter") modelConfig.variants = { none: { reasoning: { effort: "none" } } };
  // CASTELLAN_OPENROUTER_PROVIDER pins OpenRouter to the listed upstream providers, without fallback (e.g. "deepseek").
  if (env.CASTELLAN_OPENROUTER_PROVIDER && provider === "openrouter") modelConfig.options = { provider: { order: env.CASTELLAN_OPENROUTER_PROVIDER.split(","), allow_fallbacks: false } };
  // OpenCode's DeepSeek catalog has no effort variants; the API takes reasoning_effort.
  if (variant && provider === "deepseek") modelConfig.variants = { [variant]: { reasoningEffort: variant } };
  // Anthropic's API takes adaptive thinking plus an effort level, the same knob as Claude Code's --effort.
  // Declaring the model also covers ids newer than OpenCode's catalog (e.g. claude-opus-5-5).
  if (provider === "anthropic") {
    modelConfig.name = rest.join("/");
    if (variant) modelConfig.variants = { [variant]: { thinking: { type: "adaptive", display: "summarized" }, effort: variant } };
  }
  if (Object.keys(modelConfig).length) config.provider = { [provider]: { models: { [rest.join("/")]: modelConfig } } };
  if (provider === "anthropic" && anthropicWorkspace) {
    config.provider ??= { anthropic: { models: {} } };
    config.provider.anthropic.options = { headers: { "anthropic-workspace-id": anthropicWorkspace } };
  }
  const configPath = join(root, "opencode.json");
  await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  // Private HOME: no personal OpenCode config, sessions, AGENTS.md or ~/.claude skills. Provider packages are cached.
  const childEnv = Object.fromEntries(["PATH", "TMPDIR", "LANG", "LC_ALL", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"].filter((k) => env[k]).map((k) => [k, env[k]]));
  Object.assign(childEnv, {
    HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local", "share"), XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_CACHE_HOME: join(homedir(), ".cache", "castellan", "opencode"),
    OPENCODE_CONFIG: configPath, OPENCODE_PURE: "1", OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1", OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_SHARE: "1", OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
    ...(provider === "deepseek" ? { DEEPSEEK_API_KEY: key ?? "" } : provider === "anthropic" ? { ANTHROPIC_API_KEY: key ?? "" } : { OPENROUTER_API_KEY: key ?? "" }),
  });
  const metadata = { harness: "opencode", model, variant: variant ?? null, workspace, home };
  await writeFile(join(root, "run.json"), JSON.stringify(metadata, null, 2), { mode: 0o600 });
  const args = ["run", "--format", "json", "--model", model, ...(variant ? ["--variant", variant] : [])];
  return { root, workspace, home, configPath, env: childEnv, metadata, args };
}

// Sums provider-reported tokens and cost from OpenCode's step_finish events.
export function usage(lines) {
  const totals = { steps: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  for (const line of lines) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    const part = e.part ?? e;
    if (part?.type !== "step-finish" || !part.tokens) continue;
    totals.steps++;
    totals.input += part.tokens.input ?? 0; totals.output += part.tokens.output ?? 0; totals.reasoning += part.tokens.reasoning ?? 0;
    totals.cacheRead += part.tokens.cache?.read ?? 0; totals.cacheWrite += part.tokens.cache?.write ?? 0;
    totals.cost += part.cost ?? 0;
  }
  return totals;
}

// OpenCode labels even OpenRouter's temporary in-flight budget error as
// non-retryable. Preserve its Retry-After instead of spending castellan run's fast
// failure allowance on requests the provider has already asked us to defer.
export function providerRetryAfter(lines, now = Date.now()) {
  for (const line of [...lines].reverse()) {
    let event; try { event = JSON.parse(line); } catch { continue; }
    if (event?.type !== "error") continue;
    const data = event.error?.data;
    if (!data) return null;
    let body; try { body = JSON.parse(data.responseBody); } catch { /* optional */ }
    const metadata = body?.error?.metadata;
    if (data.statusCode !== 429 && !(data.statusCode === 402 && metadata?.reason === "in_flight_budget_exhausted")) return null;
    const retryHeader = headers => Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === "retry-after")?.[1];
    const value = retryHeader(data.responseHeaders) ?? retryHeader(metadata?.headers);
    if (typeof value !== "string" || !value.trim()) return null;
    const seconds = Number(value);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
    if (!Number.isFinite(delay) || delay <= 0 || delay > 2_147_483_647) return null;
    return { delayMs: Math.ceil(delay), reason: data.statusCode === 402 ? "in_flight_budget_exhausted" : "rate_limited" };
  }
  return null;
}

/** Supplies observations, never strategy, like the Codex connector: one decision in flight per seat,
 * and every later decision continues this match's OpenCode session in the same private HOME. */
export async function play({ env = process.env, args = process.argv.slice(2), fetchImpl = fetch, spawnImpl = spawn,
  minIntervalMs = MIN_INTERVAL_MS, pollMs = 2000 } = {}) {
  const opts = options(args);
  if (!env.CASTELLAN_TOKEN) throw new Error("set CASTELLAN_TOKEN (see castellan new or castellan run-series)");
  // deepseek/<model> and anthropic/<model> go straight to their APIs; everything else through OpenRouter.
  const provider = opts.model.split("/")[0];
  const anthropic = provider === "anthropic" ? await loadAnthropic(env) : null;
  const key = anthropic ? anthropic.key : provider === "deepseek" ? await loadDeepSeekKey(env) : await loadKey(env);
  if (!key) throw new Error(anthropic ? "set ANTHROPIC_API_KEY or save it in ~/.config/castellan/anthropic-api-key (mode 600)"
    : provider === "deepseek" ? "set DEEPSEEK_API_KEY or run node connectors/loop-keepers/deepseek/key.mjs"
    : "set OPENROUTER_API_KEY, save it in ~/.config/castellan/openrouter-api-key, or log in with `opencode auth login`");
  const root = await runDirectory("opencode");
  const player = await preparePlayer({ root, token: env.CASTELLAN_TOKEN, server: serverUrl(env.CASTELLAN_SERVER), key, workspace: anthropic?.workspace, ...opts, env });
  const base = promptOf(env);
  // Optional experiment instruction for this player only; kept across relaunches.
  if (env.CASTELLAN_DIRECTIVE) {
    await writeFile(join(root, "run.json"), JSON.stringify({ ...player.metadata, directive: env.CASTELLAN_DIRECTIVE }, null, 2), { mode: 0o600 });
  }
  console.error(`castellan opencode: ${opts.model}${opts.variant ? ` (${opts.variant})` : ""}; logs ${root}${env.CASTELLAN_DIRECTIVE ? `; directive: ${env.CASTELLAN_DIRECTIVE}` : ""}`);
  await reportConfiguration(launchConfiguration({ connector: "opencode", model: opts.model, effort: opts.variant,
    connectorVersion: env.CASTELLAN_CONNECTOR_VERSION || await connectorVersion(env.CASTELLAN_OPENCODE_BIN || "opencode"), prompt: base, env }), { env, fetchImpl });
  const lines = [];
  try {
    return await playSeat({ name: "opencode", prompt: base, env, fetchImpl, minIntervalMs, pollMs, decide: async (turn, { session, signal }) => {
      const child = spawnImpl(env.CASTELLAN_OPENCODE_BIN || "opencode", [...player.args, ...(session ? ["--session", session] : []), turn],
        { cwd: player.workspace, env: player.env, stdio: ["ignore", "pipe", "inherit"] });
      const output = [];
      const code = await exitOf(child, signal, line => output.push(line));
      lines.push(...output);
      const retry = code !== 0 ? providerRetryAfter(output) : null;
      if (retry) throw Object.assign(new Error(retry.reason), { retryAfterMs: retry.delayMs });
      // Adopt a session only once a decision completed, so a failed first turn resends the full prompt.
      const next = session ?? output.map(l => { try { return JSON.parse(l).sessionID; } catch { return undefined; } }).find(Boolean);
      if (code !== 0 || !next) throw new Error(`OpenCode decision incomplete (exit ${code})`);
      return { session: next };
    } });
  } finally {
    const totals = usage(lines);
    await writeFile(join(root, "events.jsonl"), lines.join("\n"), { mode: 0o600 });
    await writeFile(join(root, "usage.json"), JSON.stringify(totals, null, 2), { mode: 0o600 });
    console.error(`castellan opencode usage: ${JSON.stringify(totals)}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) play().then((code) => { process.exitCode = code; }, (error) => { console.error(error.message); process.exitCode = 1; });
