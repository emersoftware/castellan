import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectorVersion, launchConfiguration, reportConfiguration } from "../metadata.mjs";
import { seat } from "../game.mjs";
import { drivePlayer } from "./runtime.mjs";

export async function play({ env = process.env, args = process.argv.slice(2), cwd = process.cwd(), ...runtime } = {}) {
  if (!env.AOA_TOKEN) throw new Error("set AOA_TOKEN");
  if (!env.AOA_AGY_PROJECT) throw new Error("Use antigravity/play.sh to prepare the player's project.");
  if (args.some(arg => /^(--conversation|--continue|--project|--new-project|--input-format|--print|--prompt|--prompt-interactive|-p|-i|-c)(=|$)/.test(arg))) {
    throw new Error("Player conversations, prompts and projects are managed by play.sh.");
  }
  const agy = env.AOA_AGY_BIN || "agy";
  const transport = env.AOA_AGY_TRANSPORT || "cli";
  if (transport !== "mcp" && transport !== "cli") throw new Error("AOA_AGY_TRANSPORT must be mcp or cli.");
  const projectPath = join(homedir(), ".gemini/config/projects", `${env.AOA_AGY_PROJECT}.json`);
  const onConversation = async conversation => {
    const dataDir = join(homedir(), ".gemini/antigravity-cli");
    const project = JSON.parse(await readFile(projectPath, "utf8"));
    project.permissionGrants.permissionGrants.allow = [
      ...(transport === "cli" ? [
        `command(${join(cwd, "bin/aoa-tool")})`,
        `read_file(${join(cwd, "tool-output")})`,
        `read_file(${join(cwd, ".agents/tool-schemas.json")})`,
      ] : ["mcp(aoa/*)", `read_file(${join(dataDir, "mcp/aoa")})`]),
      `read_file(${join(dataDir, "brain", conversation, ".system_generated/steps")})`,
    ];
    await writeFile(projectPath, JSON.stringify(project, null, 2), { mode: 0o600 });
  };
  let prompt = await readFile(new URL("../claude-code/PLAY.md", import.meta.url), "utf8");
  if (transport === "cli") {
    prompt = prompt.replace("played through the `aoa` MCP tools", "played through the `aoa-tool` command transport");
    const toolPath = join(cwd, "bin/aoa-tool");
    prompt += `\nAntigravity command transport: call run_command with one command: ${toolPath} <tool> '<JSON object>'. Always provide the JSON object, including '{}' for no arguments. The eight tools' exact names, descriptions and JSON schemas from the game MCP server are included below; they are also available at ${join(cwd, ".agents/tool-schemas.json")} with view_file. For example: ${toolPath} state '{}'. Pass code inline inside the JSON for run/script/script_test; there are no file arguments. Shell-quote the JSON as a literal. Do not use shell substitutions, redirections, other programs or the native MCP dispatcher. Only this executable is pre-approved. If the command shows an explicit order-result preview, it already includes acknowledgements, rejections and mineral changes; the connector will supply a fresh complete observation for your next turn. Read the saved complete result if you need that observation within this turn. For other saved results, read the file with view_file before using the result; it contains the complete untruncated response.\n`;
  }
  prompt += "\nAntigravity: complete saved tool outputs are available with view_file when needed; follow the transport instructions above for previews. These reads are permitted for your own conversation. Do not delegate to subagents; play directly. For a private message to one player use chat with to set to their player id (e.g. p2). Use channel=team only when you actually have a teammate.\n";
  if (env.AOA_DIRECTIVE) {
    console.error(`aoa antigravity: directive: ${env.AOA_DIRECTIVE}`);
    prompt += `\n${env.AOA_DIRECTIVE}\n`;
  }
  // Room mechanics and tool schemas are stable context; include them once so the
  // player does not need two preparatory tool/file round trips before deciding.
  prompt += `\n\nRoom guide:\n${await seat({ env, fetchImpl: runtime.fetchImpl, redirect: "error" }).guide()}`;
  if (transport === "cli") prompt += `\n\nGame tool schemas:\n${await readFile(join(cwd, ".agents/tool-schemas.json"), "utf8")}`;
  const configuration = launchConfiguration({ connector: "antigravity", args, prompt, env,
    connectorVersion: env.AOA_CONNECTOR_VERSION || await connectorVersion(agy) });
  configuration.memoryPolicy = "isolated-player-conversation; same-conversation-between-decisions-and-process-recovery; own-tool-output-reads";
  configuration.contextPolicy = "persistent-stream-json; instruction-prompt-sha256; live-observations-excluded" + (transport === "cli" ? "; restricted-cli-mcp-bridge" : "");
  await reportConfiguration(configuration, { env, fetchImpl: runtime.fetchImpl });
  return drivePlayer({ env, args, prompt, cwd, onConversation, ...runtime });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  play().then(code => { process.exitCode = code; }, error => { console.error(`aoa antigravity: ${error.message}`); process.exitCode = 1; });
}
