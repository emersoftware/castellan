/** A fresh workspace and project per player, with only the game's tools pre-approved. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startToolBridge } from "./tool.mjs";
import { serverUrl } from "../game.mjs";

const here = dirname(fileURLToPath(import.meta.url));

export async function preparePlayer({ workspace, projectId, server, token, transport = "cli", bridge }) {
  if (transport !== "mcp" && transport !== "cli") throw new Error("CASTELLAN_AGY_TRANSPORT must be mcp or cli.");
  await mkdir(join(workspace, ".agents"), { recursive: true });
  const mcp = { mcpServers: { castellan: {
    command: process.execPath,
    args: [resolve(here, "../../mcp/bin/castellan-mcp.mjs")],
    env: { CASTELLAN_SERVER: server, CASTELLAN_TOKEN: token },
  } } };
  const toolPath = join(workspace, "bin/castellan-tool");
  const outputDir = join(workspace, "tool-output");
  const schemaPath = join(workspace, ".agents/tool-schemas.json");
  if (transport === "cli") {
    if (!bridge?.socketPath || !Array.isArray(bridge.definitions)) throw new Error("Command transport needs a running player bridge.");
    await mkdir(join(workspace, "bin"), { recursive: true });
    await mkdir(outputDir, { recursive: true });
    await writeFile(schemaPath, JSON.stringify(bridge.definitions, null, 2), { mode: 0o600 });
    const moduleUrl = pathToFileURL(join(here, "tool.mjs")).href;
    // The long-lived bridge owns the credentials. The wrapper can only reach
    // this player's socket, regardless of command arguments or environment.
    await writeFile(toolPath, `#!${process.execPath}\nimport { main } from ${JSON.stringify(moduleUrl)};\nawait main(process.argv.slice(2), ${JSON.stringify({ socketPath: bridge.socketPath, outputDir, decisionObservations: true })});\n`, { mode: 0o700 });
  } else {
    await writeFile(join(workspace, ".agents/mcp_config.json"), JSON.stringify(mcp, null, 2), { mode: 0o600 });
  }
  return {
    id: projectId,
    name: `Castellan ${projectId}`,
    projectResources: { resources: [{ folderUri: pathToFileURL(workspace).href }] },
    permissionGrants: {
      v2Migrated: true,
      permissionGrants: {
        allow: transport === "cli" ? [`command(${toolPath})`, `read_file(${outputDir})`, `read_file(${schemaPath})`] : ["mcp(castellan/*)"],
        // Unlisted paths retain agy's default approval requirement. A blanket
        // read deny would also override the conversation-specific grants below.
        deny: [...(transport === "cli" ? [] : ["command(*)"]), "write_file(*)", "read_url(*)", "execute_url(*)"],
      },
    },
  };
}

async function main() {
  if (!process.env.CASTELLAN_TOKEN) throw new Error("set CASTELLAN_TOKEN (see castellan new)");
  const agy = process.env.CASTELLAN_AGY_BIN || "agy";
  // Check the executable before creating a project or consuming a player's seat.
  await new Promise((resolveCheck, reject) => {
    const check = spawn(agy, ["--help"], { stdio: "ignore" });
    check.on("error", () => reject(new Error(`Antigravity CLI not found: ${agy}. Install agy and sign in first.`)));
    check.on("exit", (code) => code === 0 ? resolveCheck() : reject(new Error(`agy --help exited ${code}`)));
  });
  await new Promise((resolveCheck, reject) => {
    const check = spawn(agy, ["models"], { stdio: ["ignore", "ignore", "pipe"] });
    let diagnostic = "";
    check.stderr.on("data", (chunk) => { diagnostic = (diagnostic + chunk).slice(-2000); });
    check.on("error", reject);
    check.on("exit", (code) => code === 0 ? resolveCheck() : reject(new Error(`Antigravity cannot list models. Run agy interactively and sign in before joining a match.\n${diagnostic.trim()}`)));
  });
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "castellan-antigravity-")));
  const projectId = `castellan-${randomUUID()}`;
  const projectDir = join(homedir(), ".gemini/config/projects");
  const projectPath = join(projectDir, `${projectId}.json`);
  let child, bridge;
  const forward = (signal) => {
    if (child?.pid) {
      try { process.kill(-child.pid, signal); } catch (e) { if (e.code !== "ESRCH") throw e; }
    }
  };
  const onInt = () => forward("SIGINT");
  const onTerm = () => forward("SIGTERM");
  try {
    const server = serverUrl(process.env.CASTELLAN_SERVER);
    const transport = process.env.CASTELLAN_AGY_TRANSPORT || "cli";
    if (transport === "cli") bridge = await startToolBridge({
      socketPath: join(workspace, "tools.sock"), server, token: process.env.CASTELLAN_TOKEN,
      outputDir: join(workspace, "tool-output"),
    });
    const project = await preparePlayer({ workspace, projectId, server, token: process.env.CASTELLAN_TOKEN, transport, bridge });
    await mkdir(projectDir, { recursive: true });
    await writeFile(projectPath, JSON.stringify(project, null, 2), { mode: 0o600, flag: "wx" });
    const env = { ...process.env, CASTELLAN_SERVER: server, CASTELLAN_AGY_BIN: agy, CASTELLAN_AGY_PROJECT: projectId };
    if (transport === "cli") env.CASTELLAN_AGY_TOOL_OUTPUT_DIR = join(workspace, "tool-output");
    delete env.CASTELLAN_RESUME;
    process.on("SIGINT", onInt);
    process.on("SIGTERM", onTerm);
    process.exitCode = await new Promise((resolveExit, reject) => {
      child = spawn(process.execPath, [join(here, "agent.mjs"), ...process.argv.slice(2)], {
        cwd: workspace, env, stdio: "inherit", detached: true,
      });
      child.on("error", reject);
      child.on("exit", (code, signal) => resolveExit(code ?? (signal === "SIGINT" ? 130 : 143)));
    });
  } finally {
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
    try { await bridge?.close(); }
    finally {
      await Promise.all([rm(projectPath, { force: true }), rm(workspace, { recursive: true, force: true })]);
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((e) => { console.error(`castellan antigravity: ${e.message}`); process.exitCode = 1; });
}
