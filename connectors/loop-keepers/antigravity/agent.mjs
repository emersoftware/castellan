import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { connectorVersion, launchConfiguration, reportConfiguration } from "../metadata.mjs";

if (!process.env.AOA_AGY_PROJECT) throw new Error("Use antigravity/play.sh to prepare the player's project.");
const args = process.argv.slice(2);
if (args.some((arg) => /^(--conversation|--continue|--project|--new-project|-c)(=|$)/.test(arg))) {
  throw new Error("Player conversations and projects are managed by play.sh.");
}
const agy = process.env.AOA_AGY_BIN || "agy";
// Create the conversation before gameplay so only its own persisted tool outputs
// can be read. Do not grant the shared brain directory (other players live there).
const bootstrap = await new Promise((resolve, reject) => {
  const child = spawn(agy, ["--project", process.env.AOA_AGY_PROJECT,
    ...args, "--print-timeout", "60s", "--output-format", "json",
    "-p", "Reply READY only. Do not call any tools. Your next message will contain the task."],
  { stdio: ["ignore", "pipe", "inherit"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.on("error", reject);
  child.on("exit", (code) => {
    try {
      const result = JSON.parse(output);
      if (code !== 0 || result.status !== "SUCCESS" || !/^[a-f0-9-]{36}$/.test(result.conversation_id)) {
        throw new Error(result.error || `Antigravity initialization failed (${code})`);
      }
      resolve(result);
    } catch (e) { reject(e); }
  });
});
const conversation = bootstrap.conversation_id;
const dataDir = join(homedir(), ".gemini/antigravity-cli");
const projectPath = join(homedir(), ".gemini/config/projects", `${process.env.AOA_AGY_PROJECT}.json`);
const project = JSON.parse(await readFile(projectPath, "utf8"));
project.permissionGrants.permissionGrants.allow = ["mcp(aoa/*)",
  `read_file(${join(dataDir, "mcp/aoa")})`,
  `read_file(${join(dataDir, "brain", conversation, ".system_generated/steps")})`];
await writeFile(projectPath, JSON.stringify(project, null, 2), { mode: 0o600 });
let prompt = await readFile(new URL("../claude-code/PLAY.md", import.meta.url), "utf8");
prompt += "\nAntigravity: read tool schemas and large tool outputs with view_file when they are saved to a file. These reads are permitted for your own conversation. Do not delegate to subagents; play directly. For a private message to one player use chat with to set to their player id (e.g. p2). Use channel=team only when you actually have a teammate.\n";
// Optional experiment instruction for this player only (see connectors/README.md).
if (process.env.AOA_DIRECTIVE) {
  console.error(`aoa antigravity: directive: ${process.env.AOA_DIRECTIVE}`);
  prompt += `\n${process.env.AOA_DIRECTIVE}\n`;
}
if (process.env.AOA_RESUME) prompt = `You were restarted in the middle of the match: call state first, then keep playing.\n\n${prompt}`;
await reportConfiguration(launchConfiguration({ connector: "antigravity", args, prompt,
  connectorVersion: process.env.AOA_CONNECTOR_VERSION || await connectorVersion(agy) }));
const child = spawn(agy, [
  "--project", process.env.AOA_AGY_PROJECT,
  "--print-timeout", "15m",
  ...args,
  "--conversation", conversation,
  "-p", prompt,
], { stdio: ["ignore", "inherit", "inherit"] });
child.on("error", (e) => { console.error(e.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
