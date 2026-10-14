/** Explicit paid-model diagnostic. Never joins a room or uses a player token. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { preparePlayer } from "./play.mjs";
import { startToolBridge } from "./tool.mjs";

function stopGroup(child, signal) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, signal); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
}

/** One prompt, with a host deadline independent of agy's own timeout. */
async function invoke(agy, args, { cwd, env, timeoutMs }) {
  const child = spawn(agy, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", diagnostic = "", failure, escalation;
  const terminate = (reason) => {
    if (failure) return;
    failure = reason;
    stopGroup(child, "SIGTERM");
    escalation = setTimeout(() => stopGroup(child, "SIGKILL"), 250);
  };
  const onInt = () => terminate(new Error("Antigravity preflight interrupted."));
  const onTerm = () => terminate(new Error("Antigravity preflight terminated."));
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  const deadline = setTimeout(() => terminate(new Error(`Antigravity preflight timed out after ${timeoutMs} ms.`)), timeoutMs);
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (output.length > 1024 * 1024) terminate(new Error("Antigravity preflight output exceeded 1 MiB."));
  });
  child.stderr.on("data", (chunk) => { diagnostic = (diagnostic + chunk).slice(-4000); });
  try {
    const code = await new Promise((resolveExit, reject) => {
      child.once("error", reject);
      child.once("close", resolveExit);
    });
    if (failure) throw failure;
    let result;
    try { result = JSON.parse(output); }
    catch { throw new Error(`Antigravity preflight returned invalid JSON (exit ${code}).`); }
    if (code !== 0 || result.status !== "SUCCESS") {
      throw new Error(`Antigravity preflight failed (exit ${code}): ${String(result.error || diagnostic || result.status).slice(0, 1000)}`);
    }
    return result;
  } finally {
    clearTimeout(deadline);
    clearTimeout(escalation);
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
    // Includes any descendants left alive after the top-level CLI exited.
    stopGroup(child, "SIGKILL");
  }
}

export async function runPreflight({ model, effort = "low", transport = "cli", agy, timeoutMs = 60_000, env = process.env }) {
  if (typeof model !== "string" || !model.trim()) throw new Error("Provide --model from agy models.");
  if (!["low", "medium", "high", "xhigh", "max"].includes(effort)) throw new Error("Unsupported --effort.");
  if (!["cli", "mcp"].includes(transport)) throw new Error("--transport must be cli or mcp.");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new Error("Preflight timeout must be between 1 and 60000 ms.");
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "aap-")));
  const projectId = `aoa-preflight-${randomUUID()}`;
  const projectDir = join(homedir(), ".gemini/config/projects");
  const projectPath = join(projectDir, `${projectId}.json`);
  const token = randomUUID(); // Disposable diagnostic capability, never a player's.
  const calls = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url || "/", "http://localhost").pathname;
    if (req.headers.authorization !== `Bearer ${token}` || req.method !== "GET" || !["/rules", "/state"].includes(path)) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("Preflight permits only authenticated rules and state reads.");
      return;
    }
    const tool = path.slice(1), nonce = randomUUID();
    calls.push({ tool, nonce });
    res.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" });
    res.end(JSON.stringify({ tool, nonce, diagnostic: "No match exists. Return this nonce exactly." }));
  });
  let bridge;
  const started = Date.now();
  try {
    await new Promise((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolveListen);
    });
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    if (transport === "cli") bridge = await startToolBridge({ socketPath: join(workspace, "tools.sock"), server: endpoint, token });
    const project = await preparePlayer({ workspace, projectId, server: endpoint, token, transport, bridge });
    if (transport === "mcp") project.permissionGrants.permissionGrants.allow.push(`read_file(${join(homedir(), ".gemini/antigravity-cli/mcp/aoa")})`);
    await mkdir(projectDir, { recursive: true });
    await writeFile(projectPath, JSON.stringify(project, null, 2), { flag: "wx", mode: 0o600 });
    const tool = join(workspace, "bin/aoa-tool");
    const instructions = transport === "cli"
      ? `Use run_command twice, calling ${tool} rules '{}' and then ${tool} state '{}'.`
      : "Call the aoa MCP rules tool once, then the aoa MCP state tool once.";
    const prompt = `This is a connection diagnostic, not a game. ${instructions} Return both tool names and the exact nonce from each response. You may read the aoa tool schemas if necessary. Do not guess values, delegate, read unrelated files, or send any other actions. If either tool is unavailable, say so and stop.`;
    const childEnv = { ...env };
    delete childEnv.AOA_TOKEN;
    delete childEnv.AOA_SERVER;
    delete childEnv.AOA_RESUME;
    const result = await invoke(agy || env.AOA_AGY_BIN || "agy", [
      "--project", projectId, "--model", model, "--effort", effort,
      "--output-format", "json", "--print-timeout", `${timeoutMs}ms`, "-p", prompt,
    ], { cwd: workspace, env: childEnv, timeoutMs });
    const missing = ["rules", "state"].filter((name) => !calls.some((call) => call.tool === name));
    if (missing.length) throw new Error(`Antigravity preflight failed: no real calls to ${missing.join(", ")}, despite SUCCESS. The player was not connected.`);
    const response = typeof result.response === "string" ? result.response : "";
    const unread = ["rules", "state"].filter((name) => !calls.some((call) => call.tool === name && response.includes(call.nonce)));
    if (unread.length) throw new Error(`Antigravity preflight failed: response did not confirm the actual ${unread.join(", ")} nonce.`);
    return { ok: true, model, effort, transport, calls: Object.fromEntries(["rules", "state"].map((name) => [name, calls.filter((call) => call.tool === name).length])), durationMs: Date.now() - started };
  } finally {
    try { await bridge?.close(); }
    finally {
      server.closeAllConnections();
      if (server.listening) await new Promise((done) => server.close(done));
      await Promise.all([rm(projectPath, { force: true }), rm(workspace, { recursive: true, force: true })]);
    }
  }
}

async function main() {
  const args = process.argv.slice(2), options = { transport: process.env.AOA_AGY_TRANSPORT || "cli" };
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log("Usage: node preflight.mjs --model <id> [--effort low] [--transport cli|mcp]\nRuns one paid model prompt against a disposable diagnostic server. Does not join a game. Inherits AGY_ADC_AUTH and AOA_AGY_BIN. Deadline: 60 seconds.");
    return;
  }
  for (let i = 0; i < args.length; i += 2) {
    if (!["--model", "--effort", "--transport"].includes(args[i]) || !args[i + 1]) throw new Error("Use --model <id>, --effort <level>, and --transport cli|mcp.");
    options[args[i].slice(2)] = args[i + 1];
  }
  console.log(JSON.stringify(await runPreflight(options)));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
