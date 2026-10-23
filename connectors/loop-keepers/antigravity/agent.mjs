import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectorVersion, launchConfiguration, reportConfiguration } from "../metadata.mjs";
import { promptOf } from "../turns.mjs";
import { drivePlayer } from "./runtime.mjs";

/**
 * What this harness adds to the shared prompt: how to call the game tools through the command transport
 * (with their `schemas`; absent over MCP) and that its own saved tool outputs may be read.
 * @param {string} cwd
 * @param {string | undefined} schemas
 */
function harnessInstructions(cwd, schemas) {
  const toolPath = join(cwd, "bin/castellan-tool");
  const transport = schemas === undefined ? "" : `\nAntigravity command transport: call run_command with one command: ${toolPath} <tool> '<JSON object>'. Always provide the JSON object, including '{}' for no arguments. The game tools' exact names, descriptions and JSON schemas from the game MCP server are included below; they are also available at ${join(cwd, ".agents/tool-schemas.json")} with view_file. For example: ${toolPath} state '{}'. Pass code inline inside the JSON for run/script/script_test; there are no file arguments. Shell-quote the JSON as a literal. Do not use shell substitutions, redirections, other programs or the native MCP dispatcher. Only this executable is pre-approved. If the command shows an explicit order-result preview, it already includes acknowledgements, rejections and mineral changes; the connector will supply a fresh complete observation for your next turn. Read the saved complete result if you need that observation within this turn. For other saved results, read the file with view_file before using the result; it contains the complete untruncated response.\n`;
  return transport + "\nAntigravity: complete saved tool outputs are available with view_file when needed; these reads are permitted for your own conversation.\n" + (schemas === undefined ? "" : `\n\nGame tool schemas:\n${schemas}`);
}

async function play({ env = process.env, args = process.argv.slice(2), cwd = process.cwd(), ...runtime } = {}) {
  if (!env.CASTELLAN_TOKEN) throw new Error("set CASTELLAN_TOKEN");
  if (!env.CASTELLAN_AGY_PROJECT) throw new Error("Use antigravity/play.sh to prepare the player's project.");
  if (args.some(arg => /^(--conversation|--continue|--project|--new-project|--input-format|--print|--prompt|--prompt-interactive|-p|-i|-c)(=|$)/.test(arg))) {
    throw new Error("Player conversations, prompts and projects are managed by play.sh.");
  }
  const agy = env.CASTELLAN_AGY_BIN || "agy";
  const transport = env.CASTELLAN_AGY_TRANSPORT || "cli";
  if (transport !== "mcp" && transport !== "cli") throw new Error("CASTELLAN_AGY_TRANSPORT must be mcp or cli.");
  const projectPath = join(homedir(), ".gemini/config/projects", `${env.CASTELLAN_AGY_PROJECT}.json`);
  const onConversation = async conversation => {
    const dataDir = join(homedir(), ".gemini/antigravity-cli");
    const project = JSON.parse(await readFile(projectPath, "utf8"));
    project.permissionGrants.permissionGrants.allow = [
      ...(transport === "cli" ? [
        `command(${join(cwd, "bin/castellan-tool")})`,
        `read_file(${join(cwd, "tool-output")})`,
        `read_file(${join(cwd, ".agents/tool-schemas.json")})`,
      ] : ["mcp(castellan/*)", `read_file(${join(dataDir, "mcp/castellan")})`]),
      `read_file(${join(dataDir, "brain", conversation, ".system_generated/steps")})`,
    ];
    await writeFile(projectPath, JSON.stringify(project, null, 2), { mode: 0o600 });
  };
  // The shared instruction plus only what this harness needs to reach the tools at all.
  const schemas = transport === "cli" ? await readFile(join(cwd, ".agents/tool-schemas.json"), "utf8") : undefined;
  const prompt = promptOf(env) + harnessInstructions(cwd, schemas);
  if (env.CASTELLAN_DIRECTIVE) console.error(`castellan antigravity: directive: ${env.CASTELLAN_DIRECTIVE}`);
  const configuration = launchConfiguration({ connector: "antigravity", args, prompt, env,
    connectorVersion: env.CASTELLAN_CONNECTOR_VERSION || await connectorVersion(agy) });
  configuration.memoryPolicy = "isolated-player-conversation; same-conversation-between-decisions-and-process-recovery; own-tool-output-reads";
  if (transport === "cli") configuration.contextPolicy += "; restricted-cli-mcp-bridge";
  await reportConfiguration(configuration, { env, fetchImpl: runtime.fetchImpl });
  return drivePlayer({ env, args, prompt, cwd, onConversation, ...runtime });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  play().then(code => { process.exitCode = code; }, error => { console.error(`castellan antigravity: ${error.message}`); process.exitCode = 1; });
}
