import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

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

export async function preparePlayer({ root, token, server = "http://localhost:4400", key, model = DEFAULT_MODEL, variant, env = process.env }) {
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

// Polls the player's match status; once finished, gives the agent a short grace period, then stops it.
export function watchFinish({ server = "http://localhost:4400", token, onFinished, everyMs = 10_000, graceMs = 15_000, fetchImpl = fetch }) {
  let timer, stopped = false;
  const tick = async () => {
    try {
      const res = await fetchImpl(`${server}/status`, { headers: { authorization: `Bearer ${token}` } });
      if (res.ok && (await res.json()).status === "finished") { timer = setTimeout(() => { if (!stopped) onFinished(); }, graceMs); return; }
    } catch { /* server unreachable: keep polling */ }
    if (!stopped) timer = setTimeout(tick, everyMs);
  };
  timer = setTimeout(tick, everyMs);
  return { stop() { stopped = true; clearTimeout(timer); } };
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const opts = options(args);
  if (!env.AOA_TOKEN) throw new Error("set AOA_TOKEN (see aoa new or aoa run-series)");
  const key = await loadKey(env);
  if (!key) throw new Error("set OPENROUTER_API_KEY, save it in ~/.config/aoa/openrouter-api-key, or log in with `opencode auth login`");
  const runs = join(homedir(), ".local", "state", "aoa", "opencode");
  await mkdir(runs, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(runs, "run-"));
  const player = await preparePlayer({ root, token: env.AOA_TOKEN, server: env.AOA_SERVER, key, ...opts, env });
  let prompt = await readFile(resolve(here, "../claude-code/PLAY.md"), "utf8");
  if (env.AOA_RESUME) prompt = `You were restarted in the middle of the match: call state first, then keep playing.\n\n${prompt}`;
  // Optional experiment instruction for this player only; kept across relaunches.
  if (env.AOA_DIRECTIVE) {
    prompt += `\n\n${env.AOA_DIRECTIVE}`;
    await writeFile(join(root, "run.json"), JSON.stringify({ ...player.metadata, directive: env.AOA_DIRECTIVE }, null, 2), { mode: 0o600 });
  }
  console.error(`aoa opencode: ${opts.model}${opts.variant ? ` (${opts.variant})` : ""}; logs ${root}${env.AOA_DIRECTIVE ? `; directive: ${env.AOA_DIRECTIVE}` : ""}`);
  const child = spawn(env.AOA_OPENCODE_BIN || "opencode", [...player.args, prompt], { cwd: player.workspace, env: player.env, stdio: ["ignore", "pipe", "inherit"] });
  const lines = [];
  let pending = "";
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    const parts = (pending + chunk).split("\n");
    pending = parts.pop();
    lines.push(...parts);
  });
  const interrupt = () => child.kill("SIGINT"), terminate = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt); process.on("SIGTERM", terminate);
  // A model request in flight when the match ends would otherwise keep the process alive.
  const watch = watchFinish({ server: env.AOA_SERVER, token: env.AOA_TOKEN, onFinished: terminate });
  let code;
  try { code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", (code) => resolve(code ?? 1)); }); }
  finally { watch.stop(); process.off("SIGINT", interrupt); process.off("SIGTERM", terminate); }
  lines.push(pending);
  const totals = usage(lines);
  await writeFile(join(root, "events.jsonl"), lines.join("\n"), { mode: 0o600 });
  await writeFile(join(root, "usage.json"), JSON.stringify(totals, null, 2), { mode: 0o600 });
  console.error(`aoa opencode usage: ${JSON.stringify(totals)}`);
  return code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then((code) => { process.exitCode = code; }, (error) => { console.error(error.message); process.exitCode = 1; });
