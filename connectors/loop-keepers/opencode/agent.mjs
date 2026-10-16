import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { connectorVersion, launchConfiguration, reportConfiguration, reportActivity } from "../metadata.mjs";
import { seat, serverUrl } from "../game.mjs";

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

// OpenRouter key: env, then a private aoa key file, then OpenCode's own stored credential.
export async function loadKey(env = process.env) {
  if (env.OPENROUTER_API_KEY?.trim()) return env.OPENROUTER_API_KEY.trim();
  const file = env.AOA_OPENROUTER_KEY_FILE || join(homedir(), ".config", "aoa", "openrouter-api-key");
  try {
    if ((await stat(file)).mode & 0o077) throw new Error(`OpenRouter key file must be private: chmod 600 ${file}`);
    return (await readFile(file, "utf8")).trim();
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const auth = join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode", "auth.json");
  try { return JSON.parse(await readFile(auth, "utf8")).openrouter?.key?.trim() ?? ""; }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}

export async function preparePlayer({ root, token, server = serverUrl(), key, model = DEFAULT_MODEL, variant, env = process.env }) {
  const workspace = join(root, "workspace"), home = join(root, "home");
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  await mkdir(home, { recursive: true, mode: 0o700 });
  // Only the aoa MCP tools; every built-in (shell, files, web, subagents, skills) is off and denied.
  const config = {
    $schema: "https://opencode.ai/config.json",
    autoupdate: false, share: "disabled", snapshot: false, formatter: false, lsp: false,
    enabled_providers: [model.split("/")[0]],
    mcp: { aoa: { type: "local", command: [process.execPath, resolve(here, "../../mcp/bin/aoa-mcp.mjs")],
      environment: { AOA_SERVER: server, AOA_TOKEN: token }, timeout: 60000 } },
    tools: { "*": false, "aoa_*": true },
    permission: { "*": "deny", "aoa_*": "allow" },
  };
  // OpenCode's built-in OpenRouter variants stop at "low"; "none" turns reasoning off.
  const [provider, ...rest] = model.split("/");
  if (variant === "none" && provider === "openrouter") {
    config.provider = { openrouter: { models: { [rest.join("/")]: { variants: { none: { reasoning: { effort: "none" } } } } } } };
  }
  const configPath = join(root, "opencode.json");
  await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  // Private HOME: no personal OpenCode config, sessions, AGENTS.md or ~/.claude skills. Provider packages are cached.
  const childEnv = Object.fromEntries(["PATH", "TMPDIR", "LANG", "LC_ALL", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"].filter((k) => env[k]).map((k) => [k, env[k]]));
  Object.assign(childEnv, {
    HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local", "share"), XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_CACHE_HOME: join(homedir(), ".cache", "aoa", "opencode"),
    OPENCODE_CONFIG: configPath, OPENCODE_PURE: "1", OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1", OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_SHARE: "1", OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
    OPENROUTER_API_KEY: key ?? "",
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
// non-retryable. Preserve its Retry-After instead of spending aoa run's fast
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
  minIntervalMs = 1500, pollMs = 2000 } = {}) {
  const opts = options(args);
  if (!env.AOA_TOKEN) throw new Error("set AOA_TOKEN (see aoa new or aoa run-series)");
  const key = await loadKey(env);
  if (!key) throw new Error("set OPENROUTER_API_KEY, save it in ~/.config/aoa/openrouter-api-key, or log in with `opencode auth login`");
  const runs = join(homedir(), ".local", "state", "aoa", "opencode");
  await mkdir(runs, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(runs, "run-"));
  const player = await preparePlayer({ root, token: env.AOA_TOKEN, server: serverUrl(env.AOA_SERVER), key, ...opts, env });
  let base = await readFile(resolve(here, "../claude-code/PLAY.md"), "utf8");
  if (env.AOA_RESUME) base = `You were restarted in the middle of the match; your earlier conversation is gone.\n\n${base}`;
  // Optional experiment instruction for this player only; kept across relaunches.
  if (env.AOA_DIRECTIVE) {
    base += `\n\n${env.AOA_DIRECTIVE}`;
    await writeFile(join(root, "run.json"), JSON.stringify({ ...player.metadata, directive: env.AOA_DIRECTIVE }, null, 2), { mode: 0o600 });
  }
  console.error(`aoa opencode: ${opts.model}${opts.variant ? ` (${opts.variant})` : ""}; logs ${root}${env.AOA_DIRECTIVE ? `; directive: ${env.AOA_DIRECTIVE}` : ""}`);
  await reportConfiguration(launchConfiguration({ connector: "opencode", model: opts.model, effort: opts.variant,
    connectorVersion: env.AOA_CONNECTOR_VERSION || await connectorVersion(env.AOA_OPENCODE_BIN || "opencode"), prompt: base, env }), { env, fetchImpl });
  let child, session, watcher, stopped = false, finished = false, lastDeliveredTick = 0, failures = 0;
  const lines = [];
  const abort = new AbortController();
  const stop = () => { stopped = true; abort.abort(); child?.kill("SIGTERM"); };
  const game = seat({ env, fetchImpl, signal: abort.signal });
  const delay = ms => sleep(ms, undefined, { signal: abort.signal });
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  // A model request in flight when the match ends would otherwise keep the process alive.
  const watch = async () => {
    if (stopped) return;
    try {
      const status = await game.status();
      if (status.status === "finished" || status.alive === false) { finished = true; stop(); return; }
    } catch { /* next poll */ }
    if (!stopped) watcher = setTimeout(watch, pollMs);
  };
  watcher = setTimeout(watch, pollMs);
  try {
    while (!stopped) {
      const started = Date.now();
      try {
        const observation = await game.observation(lastDeliveredTick);
        if (/ · finished · /.test(observation) || /^YOU\s+.* · OUT$/m.test(observation)) { finished = true; break; }
        if (/ · (waiting|prep) · /.test(observation)) { await delay(1000); continue; }
        const observedTick = Number(observation.match(/^tick (\d+)/)?.[1]);
        const prompt = `${session ? "Next decision. The following is your current observation." : base}\n\n${observation}`;
        await reportActivity("deciding", { env, fetchImpl });
        child = spawnImpl(env.AOA_OPENCODE_BIN || "opencode", [...player.args, ...(session ? ["--session", session] : []), prompt],
          { cwd: player.workspace, env: player.env, stdio: ["ignore", "pipe", "inherit"] });
        const turn = [];
        let pending = "";
        child.stdout.on("data", chunk => {
          process.stdout.write(chunk);
          const parts = (pending + chunk).split("\n"); pending = parts.pop(); turn.push(...parts);
        });
        const code = await new Promise((resolveCode, reject) => { child.on("error", reject); child.on("close", resolveCode); });
        turn.push(pending); child = undefined;
        lines.push(...turn);
        if (stopped) break;
        const retry = code !== 0 ? providerRetryAfter(turn) : null;
        if (retry) {
          await reportActivity("provider_wait", { env, fetchImpl, retryAt: new Date(Date.now() + retry.delayMs).toISOString() });
          console.error(`aoa opencode: ${retry.reason}; waiting ${retry.delayMs / 1000}s (Retry-After); the match keeps running`);
          await delay(retry.delayMs);
          continue;
        }
        // Adopt a session only once a decision completed, so a failed first turn resends the full prompt.
        const id = turn.map(l => { try { return JSON.parse(l).sessionID; } catch { return undefined; } }).find(Boolean);
        if (code !== 0 || !(session ??= id)) throw new Error(`OpenCode decision incomplete (exit ${code})`);
        if (Number.isFinite(observedTick)) lastDeliveredTick = observedTick;
        failures = 0;
        await reportActivity("between_decisions", { env, fetchImpl });
        await delay(Math.max(0, minIntervalMs - (Date.now() - started)));
      } catch (error) {
        if (stopped) break;
        failures++;
        const ms = Math.min(30_000, 2000 * failures);
        console.error(`aoa opencode: ${error.message}; retry in ${ms / 1000}s, preserving session and observation cursor`);
        await reportActivity("connector_retry", { env, fetchImpl, retryAt: new Date(Date.now() + ms).toISOString() });
        await delay(ms).catch(() => {});
      }
    }
    return finished ? 0 : 1;
  } finally {
    stop(); clearTimeout(watcher);
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
    const totals = usage(lines);
    await writeFile(join(root, "events.jsonl"), lines.join("\n"), { mode: 0o600 });
    await writeFile(join(root, "usage.json"), JSON.stringify(totals, null, 2), { mode: 0o600 });
    console.error(`aoa opencode usage: ${JSON.stringify(totals)}`);
    await reportActivity("stopped", { env, fetchImpl });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) play().then((code) => { process.exitCode = code; }, (error) => { console.error(error.message); process.exitCode = 1; });
