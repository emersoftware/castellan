// @ts-check
/** @import { Effort } from "@castellan/shared" */
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { launchConfiguration, reportActivity, reportConfiguration } from "../metadata.mjs";
import { serverUrl } from "../game.mjs";
import { MIN_INTERVAL_MS, promptOf } from "../turns.mjs";
import { lineReader, playSeat } from "../decisions.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const exec = promisify(execFile);
/**
 * Effort suffixes of Cursor model ids.
 * @type {Effort[]}
 */
export const efforts = ["low", "medium", "high", "xhigh", "max"];

export function options(args) {
  const { values } = parseArgs({ args, options: { model: { type: "string", default: "grok-4.7" }, effort: { type: "string" } } });
  if (!/^[\w.-]+$/.test(values.model) || values.model === "auto") throw new Error("Use an explicit Cursor model id from `agent models`");
  if (values.effort && !efforts.some(known => known === values.effort)) throw new Error("Invalid effort");
  const suffix = values.model.match(new RegExp(`-(${efforts.join("|")})(-fast)?$`));
  if (suffix && values.effort && suffix[1] !== values.effort) throw new Error("Model id and --effort disagree");
  /** @type {Effort | undefined} */
  const fallback = values.model === "grok-4.7" ? "low" : undefined;
  const effort = suffix?.[1] ?? values.effort ?? fallback;
  return { model: !suffix && effort ? `${values.model}-${effort}` : values.model, effort };
}

// Reuse the user's existing login, without copying credentials into the match
// directory or exposing them in arguments, stdout, metadata or game prompts.
async function loadCredential(env = process.env) {
  if (env.CURSOR_AUTH_TOKEN?.trim()) return { CURSOR_AUTH_TOKEN: env.CURSOR_AUTH_TOKEN.trim() };
  if (env.CURSOR_API_KEY?.trim()) return { CURSOR_API_KEY: env.CURSOR_API_KEY.trim() };
  if (platform() === "darwin" && env.AGENT_CLI_CREDENTIAL_STORE !== "file") {
    try {
      const { stdout } = await exec("/usr/bin/security", ["find-generic-password", "-s", "cursor-access-token", "-a", "cursor-user", "-w"], { timeout: 5000 });
      if (stdout.trim()) return { CURSOR_AUTH_TOKEN: stdout.trim() };
    } catch { /* generic error below; never print credential command output */ }
  } else {
    const path = platform() === "win32" ? join(env.APPDATA || join(homedir(), "AppData/Roaming"), "Cursor/auth.json")
      : platform() === "darwin" ? join(homedir(), ".cursor/auth.json") : join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "cursor/auth.json");
    try {
      const auth = JSON.parse(await readFile(path, "utf8"));
      if (auth.accessToken) return { CURSOR_AUTH_TOKEN: auth.accessToken };
      if (auth.apiKey) return { CURSOR_API_KEY: auth.apiKey };
    } catch { /* generic error below */ }
  }
  throw new Error("Cursor login unavailable. Run `agent login` or set CURSOR_AUTH_TOKEN / CURSOR_API_KEY");
}

export async function preparePlayer({ root, credential, env = process.env }) {
  const workspace = join(root, "workspace"), home = join(root, "home"), configDir = join(home, ".cursor");
  await mkdir(join(workspace, ".cursor"), { recursive: true, mode: 0o700 });
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  const permissions = { allow: ["Mcp(castellan:*)"], deny: ["Shell(*)", "Read(**)", "Write(**)", "WebFetch(*)"] };
  await writeFile(join(configDir, "cli-config.json"), JSON.stringify({ version: 1, editor: { vimMode: false }, approvalMode: "allowlist", permissions }), { mode: 0o600 });
  await writeFile(join(workspace, ".cursor/cli.json"), JSON.stringify({ permissions }), { mode: 0o600 });
  const childEnv = Object.fromEntries(["PATH", "TMPDIR", "LANG", "LC_ALL", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"].filter(k => env[k]).map(k => [k, env[k]]));
  Object.assign(childEnv, { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local/share"),
    CURSOR_CONFIG_DIR: configDir, CURSOR_DATA_DIR: configDir, AGENT_CLI_CREDENTIAL_STORE: "memory", DIRENV_DISABLE: "1", ...credential });
  return { root, workspace, home, env: childEnv };
}

export async function connectTools(player, { token, server }) {
  await writeFile(join(player.workspace, ".cursor/mcp.json"), JSON.stringify({ mcpServers: { castellan: {
    command: process.execPath, args: [resolve(here, "../../mcp/bin/castellan-mcp.mjs")],
    env: { CASTELLAN_SERVER: server, CASTELLAN_TOKEN: token },
  } } }), { mode: 0o600 });
}

export function cursorArgs({ model, session, prompt }) {
  return ["--print", "--trust", "--approve-mcps", "--output-format", "stream-json", "--model", model,
    ...(session ? ["--resume", session] : []), prompt];
}

// These require user/account changes, not an unbounded retry loop. Never
// downgrade to Auto or change the requested effort when access is denied.
export function failureKind(text) {
  if (/ActionRequiredError|authentication required|not logged in|unauthenticated|invalid.*(?:token|api.?key)|token.*expired|usage limit|quota exceeded|insufficient.*(?:credit|balance)|payment required|model.*(?:unavailable|not found|not supported)|permission denied/i.test(text)) return "access";
  return "temporary";
}

export async function play({ env = process.env, args = process.argv.slice(2), fetchImpl = fetch, spawnImpl = spawn,
  credentialImpl = loadCredential, minIntervalMs = MIN_INTERVAL_MS, pollMs = 2000, retryMs = 2000, maxFailures = 8, idleTimeoutMs = 180_000, exitGraceMs = 2000,
  output = chunk => process.stdout.write(chunk), warn = text => console.error(text) } = {}) {
  const opts = options(args);
  if (!env.CASTELLAN_TOKEN) throw new Error("set CASTELLAN_TOKEN (see castellan new or castellan run-series)");
  const credential = await credentialImpl(env);
  const root = await mkdtemp(join(tmpdir(), "castellan-cursor-"));
  // The preflight runs before the seat loop; a signal must stop it too.
  const preflight = new AbortController();
  const stop = () => preflight.abort();
  let seated = false;
  const redact = text => Object.values(credential).concat(env.CASTELLAN_TOKEN).reduce((s, secret) => secret ? s.split(secret).join("[REDACTED]") : s, text);
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    const player = await preparePlayer({ root, credential, env });
    /** @param {string} prompt @param {string | undefined} resume @param {AbortSignal} signal */
    const decision = async (prompt, resume, signal, emit = true) => {
      let stderr = "", id, timedOut = false;
      /** @type {{ type: string, subtype?: string, is_error?: boolean } | undefined} */
      let finalEvent;
      let timer;
      const startedAt = Date.now();
      const armIdleTimer = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { timedOut = true; terminate(); }, idleTimeoutMs);
      };
      const child = spawnImpl(env.CASTELLAN_CURSOR_BIN || "agent", cursorArgs({ model: opts.model, session: resume, prompt }), {
        cwd: player.workspace, env: player.env, stdio: ["ignore", "pipe", "pipe"], detached: platform() !== "win32",
      });
      const consume = raw => {
        if (emit && raw) output(redact(raw) + "\n");
        try {
          const e = JSON.parse(raw);
          // An active stream is not a stuck turn. In particular, killing Grok
          // mid-reasoning discards work and can repeat indefinitely on resume.
          if (["system", "user", "thinking", "assistant", "tool_call", "result", "error"].includes(e.type)) armIdleTimer();
          if (typeof e.session_id === "string") id = e.session_id;
          if (e.type === "result") finalEvent = e;
          if (e.type === "error") stderr += JSON.stringify(e);
        } catch { /* non-JSON CLI output is not completion */ }
      };
      const lines = lineReader(consume);
      child.stdout.on("data", chunk => lines.push(chunk));
      child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-16_384); });
      const active = child;
      let killTimer;
      const kill = signal => {
        try {
          if (active.pid && platform() !== "win32") process.kill(-active.pid, signal);
          else active.kill(signal);
        } catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ESRCH") throw error; }
      };
      // A helper (e.g. the MCP server) can outlive the CLI and keep its pipes
      // open, so "close" may never arrive. Settle on "exit" after a grace
      // period, and on termination even if the process group is already gone.
      let settle, forceTimer;
      const forceSettle = code => { active.stdout?.destroy(); active.stderr?.destroy(); settle?.(code); };
      const terminate = () => {
        kill("SIGTERM");
        killTimer ??= setTimeout(() => kill("SIGKILL"), 3000);
        forceTimer ??= setTimeout(() => forceSettle(null), 3000 + exitGraceMs);
      };
      armIdleTimer();
      const onAbort = () => terminate();
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) terminate();
      try {
        const code = await new Promise((resolveCode, reject) => {
          let exitTimer;
          settle = c => { clearTimeout(exitTimer); resolveCode(c); };
          active.on("error", reject);
          active.on("close", c => settle(c));
          active.on("exit", c => { exitTimer = setTimeout(() => forceSettle(c), exitGraceMs); });
        });
        lines.end();
        const success = code === 0 && !timedOut && finalEvent?.type === "result" && finalEvent.subtype === "success" && finalEvent.is_error === false && id;
        return { success: Boolean(success), session: id, fatal: failureKind(stderr + JSON.stringify(finalEvent)) === "access",
          diagnostic: timedOut ? `No Cursor stream activity for ${idleTimeoutMs}ms (elapsed ${Date.now() - startedAt}ms)` : redact(stderr).slice(-1000) };
      } finally {
        clearTimeout(timer); clearTimeout(killTimer); clearTimeout(forceTimer); signal.removeEventListener("abort", onAbort);
        // Cursor can leave MCP/LSP helpers behind even after a successful turn.
        if (active.pid && platform() !== "win32") kill("SIGKILL");
      }
    };

    // Confirm model entitlement BEFORE installing game tools or connecting the
    // seat. No warm-up conversation is reused as the player's match session.
    const warmup = await decision("Reply READY. Do not use tools.", undefined, preflight.signal, false);
    if (preflight.signal.aborted) return 1;
    if (!warmup.success) throw new Error(`Cursor preflight failed; player has not joined. ${warmup.diagnostic || "No successful result; check model access and login."}`);
    await connectTools(player, { token: env.CASTELLAN_TOKEN, server: serverUrl(env.CASTELLAN_SERVER) });
    const base = promptOf(env);
    let version = env.CASTELLAN_CONNECTOR_VERSION;
    if (!version) { try { version = (await exec(env.CASTELLAN_CURSOR_BIN || "agent", ["--version"], { timeout: 5000 })).stdout.trim(); } catch { /* optional metadata */ } }
    await reportConfiguration(launchConfiguration({ connector: "cursor", ...opts, prompt: base, connectorVersion: version, env }), { env, fetchImpl });
    seated = true;
    return await playSeat({ name: "cursor", prompt: base, env, fetchImpl, signal: preflight.signal, minIntervalMs, pollMs, maxFailures,
      backoffMs: failures => Math.min(30_000, retryMs * 2 ** (failures - 1)), warn: text => warn(redact(text)),
      decide: async (turn, { session, signal }) => {
        const result = await decision(turn, session, signal);
        // Keep partial sessions too: orders may already have reached the game.
        const kept = result.session ?? session;
        if (!result.success && result.fatal) throw Object.assign(new Error(`Cursor access error: ${result.diagnostic || "Check your plan/model."}`), { fatal: true, session: kept });
        if (!result.success || !kept) throw Object.assign(new Error(`Cursor decision incomplete${result.diagnostic ? `: ${result.diagnostic}` : ""}`), { session: kept });
        return { session: kept };
      } });
  } finally {
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
    // The seat loop reports its own end; a preflight that stopped never reached it.
    if (!seated) await reportActivity("stopped", { env, fetchImpl });
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) play().then(code => { process.exitCode = code; }, error => { console.error(error.message); process.exitCode = 1; });
