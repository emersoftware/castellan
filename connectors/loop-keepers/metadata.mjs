// @ts-check
// Only declared, non-secret experiment settings cross this boundary. Never send
// environment dumps, prompts, config files, credentials, or executable paths.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { routes } from "../../packages/shared/src/http.ts";
import { seat } from "./game.mjs";

/** The value of the last `--name value` or `--name=value` among args. */
function optionValue(args, names) {
  let result;
  for (let i = 0; i < args.length; i++) {
    for (const name of names) {
      if (args[i] === name && args[i + 1] && !args[i + 1].startsWith("-")) result = args[++i];
      else if (args[i]?.startsWith(`${name}=`)) result = args[i].slice(name.length + 1);
    }
  }
  return result;
}

function codexConfig(args, key) {
  let result;
  for (let i = 0; i < args.length; i++) {
    let config;
    if (args[i] === "-c" || args[i] === "--config") config = args[++i];
    else if (args[i].startsWith("--config=")) config = args[i].slice(9);
    else if (args[i].startsWith("-c") && args[i].length > 2) config = args[i].slice(2);
    const match = config?.match(new RegExp(`^${key}\\s*=\\s*["']?([^"']+?)["']?$`));
    if (match) result = match[1];
  }
  return result;
}

const clean = value => typeof value === "string" && value.trim() ? value.trim().slice(0, 256) : null;
const policies = {
  cursor: ["isolated-home-config-and-workspace; no-cross-match-session", "resume-between-decisions; fresh-after-process-restart; aoa-launch-prompt-sha256"],
  codex: ["auto-memory-disabled; isolated-match-session", "resume-between-decisions; fresh-after-process-failure; instruction-prompt-sha256; live-observations-excluded"],
  "claude-code": ["auto-memory-disabled; isolated-workspace", "stop-hook-session; aoa-launch-prompt-sha256"],
  opencode: ["isolated-home; no-cross-match-session", "fresh-context-on-relaunch; aoa-launch-prompt-sha256"],
  "deepseek-harness": ["isolated-session-store; no-cross-match-session", "fresh-context-on-relaunch; aoa-launch-prompt-sha256"],
  antigravity: ["fresh-player-conversation; own-tool-output-reads", "bootstrap-ready-then-aoa-launch-prompt-sha256"],
};

/** @param {{ connector: string, args?: string[], prompt?: string, model?: string, effort?: string, connectorVersion?: string | null, env?: NodeJS.ProcessEnv }} launch */
export function launchConfiguration({ connector, args = [], prompt, model, effort, connectorVersion, env = process.env }) {
  const [memoryPolicy, contextPolicy] = policies[connector] ?? [];
  return {
    model: clean(model ?? optionValue(args, ["--model", "-m"]) ?? (connector === "codex" ? codexConfig(args, "model") : undefined) ?? env.AOA_MODEL),
    effort: clean(effort ?? optionValue(args, ["--effort", "--variant"]) ?? (connector === "codex" ? codexConfig(args, "model_reasoning_effort") : undefined) ?? env.AOA_EFFORT),
    connector: clean(connector ?? env.AOA_CONNECTOR),
    connectorVersion: clean(connectorVersion ?? env.AOA_CONNECTOR_VERSION),
    // This hashes exactly the task string handed to the harness, not a claim to
    // know its hidden/system prompt. contextPolicy makes the scope explicit.
    promptSha256: typeof prompt === "string" ? createHash("sha256").update(prompt).digest("hex") : null,
    memoryPolicy: clean(memoryPolicy ?? env.AOA_MEMORY_POLICY),
    contextPolicy: clean(contextPolicy ?? env.AOA_CONTEXT_POLICY),
  };
}

export function connectorVersion(binary) {
  if (!binary) return Promise.resolve(null);
  return new Promise(resolveVersion => {
    execFile(binary, ["--version"], { timeout: 1500, maxBuffer: 1024, windowsHide: true }, (error, stdout) => {
      resolveVersion(error ? null : stdout.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0] ?? null);
    });
  });
}

export async function reportConfiguration(configuration, { env = process.env, fetchImpl = fetch, warn = console.error } = {}) {
  if (!env.AOA_TOKEN) return false;
  try {
    const res = await seat({ env, fetchImpl, redirect: "error" }).report(routes.agentConfig, configuration);
    if (res.ok) return true;
    warn(`aoa: experiment configuration was not recorded (HTTP ${res.status}).`);
  } catch {
    // Avoid printing an error object: fetch/connection errors can carry URLs or
    // request options. Losing metadata must be explicit but not stop gameplay.
    warn("aoa: experiment configuration was not recorded (server unavailable).");
  }
  return false;
}

/**
 * @param {import("../../packages/shared/src/protocol.ts").AgentActivity["state"]} state
 * @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, retryAt?: string }} [options]
 */
export async function reportActivity(state, { env = process.env, fetchImpl = fetch, retryAt } = {}) {
  if (!env.AOA_TOKEN) return;
  try {
    await seat({ env, fetchImpl, redirect: "error" }).report(routes.agentStatus, { state, ...(retryAt ? { retryAt } : {}) });
  } catch { /* telemetry never stops a player */ }
}

async function main() {
  const [connector, ...args] = process.argv.slice(2);
  let prompt = "";
  process.stdin.setEncoding("utf8");
  for await (const part of process.stdin) prompt += part;
  const binary = connector === "claude-code" ? "claude" : connector === "codex" ? "codex" : undefined;
  const version = process.env.AOA_CONNECTOR_VERSION || await connectorVersion(binary);
  await reportConfiguration(launchConfiguration({ connector, args, prompt, connectorVersion: version }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  console.error("aoa: experiment configuration was not recorded (metadata reporter failed).");
});
