// @ts-check
// Only declared, non-secret experiment settings cross this boundary. Never send
// environment dumps, prompts, config files, credentials, or executable paths.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiError } from "@castellan/cli";
import { routes } from "@castellan/shared";
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
// Every LLM keeper uses the turns in turns.mjs: first turn = instruction + observation in prep,
// later turns = observation only while running, one private conversation per match.
const shared = "turns-mjs-protocol; first-turn-in-prep; observation-only-later-turns; instruction-prompt-sha256";
const policies = {
  cursor: ["isolated-home-config-and-workspace; no-cross-match-session", `${shared}; resume-between-decisions`],
  codex: ["auto-memory-disabled; isolated-match-session", `${shared}; resume-between-decisions`],
  "claude-code": ["auto-memory-disabled; isolated-workspace", `${shared}; stop-hook-session`],
  opencode: ["isolated-home; no-cross-match-session", `${shared}; resume-between-decisions`],
  "deepseek-harness": ["isolated-session-store; no-cross-match-session", `${shared}; resume-between-decisions`],
  "minimax-code": ["isolated-home-and-session-store; no-cross-match-session", `${shared}; resume-between-decisions`],
  antigravity: ["fresh-player-conversation; own-tool-output-reads", `${shared}; one-agy-conversation`],
  jev: ["stateless-decisions; no-cross-match-memory", "fresh-state-summary-each-decision; last-5-decisions-in-state; goal-sha256"],
};

/** @param {{ connector: string, args?: string[], prompt?: string, model?: string, effort?: string, connectorVersion?: string | null, env?: NodeJS.ProcessEnv }} launch */
export function launchConfiguration({ connector, args = [], prompt, model, effort, connectorVersion, env = process.env }) {
  const [memoryPolicy, contextPolicy] = policies[connector] ?? [];
  return {
    model: clean(model ?? optionValue(args, ["--model", "-m"]) ?? (connector === "codex" ? codexConfig(args, "model") : undefined) ?? env.CASTELLAN_MODEL),
    effort: clean(effort ?? optionValue(args, ["--effort", "--variant"]) ?? (connector === "codex" ? codexConfig(args, "model_reasoning_effort") : undefined) ?? env.CASTELLAN_EFFORT),
    connector: clean(connector ?? env.CASTELLAN_CONNECTOR),
    connectorVersion: clean(connectorVersion ?? env.CASTELLAN_CONNECTOR_VERSION),
    // This hashes exactly the task string handed to the harness, not a claim to
    // know its hidden/system prompt. contextPolicy makes the scope explicit.
    promptSha256: typeof prompt === "string" ? createHash("sha256").update(prompt).digest("hex") : null,
    memoryPolicy: clean(memoryPolicy ?? env.CASTELLAN_MEMORY_POLICY),
    contextPolicy: clean(contextPolicy ?? env.CASTELLAN_CONTEXT_POLICY),
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
  if (!env.CASTELLAN_TOKEN) return false;
  try {
    await seat({ env, fetchImpl, redirect: "error" }).report(routes.agentConfig, configuration);
    return true;
  } catch (error) {
    // Avoid printing an error object: fetch/connection errors can carry URLs or
    // request options. Losing metadata must be explicit but not stop gameplay.
    warn(error instanceof ApiError && error.status ? `castellan: experiment configuration was not recorded (HTTP ${error.status}).`
      : "castellan: experiment configuration was not recorded (server unavailable).");
  }
  return false;
}

/**
 * @param {import("@castellan/shared").AgentActivity["state"]} state
 * @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, retryAt?: string }} [options]
 */
export async function reportActivity(state, { env = process.env, fetchImpl = fetch, retryAt } = {}) {
  if (!env.CASTELLAN_TOKEN) return;
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
  const version = process.env.CASTELLAN_CONNECTOR_VERSION || await connectorVersion(binary);
  await reportConfiguration(launchConfiguration({ connector, args, prompt, connectorVersion: version }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  console.error("castellan: experiment configuration was not recorded (metadata reporter failed).");
});
