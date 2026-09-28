/** A fresh workspace and project per player, with only the game's MCP pre-approved. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export async function preparePlayer({ workspace, projectId, server, token }) {
  await mkdir(join(workspace, ".agents"), { recursive: true });
  const mcp = { mcpServers: { aoa: {
    command: process.execPath,
    args: [resolve(here, "../../mcp/bin/aoa-mcp.mjs")],
    env: { AOA_SERVER: server, AOA_TOKEN: token },
  } } };
  await writeFile(join(workspace, ".agents/mcp_config.json"), JSON.stringify(mcp, null, 2), { mode: 0o600 });
  return {
    id: projectId,
    name: `Age of Agents ${projectId}`,
    projectResources: { resources: [{ folderUri: pathToFileURL(workspace).href }] },
    permissionGrants: {
      v2Migrated: true,
      permissionGrants: {
        allow: ["mcp(aoa/*)"],
        // Unlisted paths retain agy's default approval requirement. A blanket
        // read deny would also override the conversation-specific grants below.
        deny: ["command(*)", "write_file(*)", "read_url(*)", "execute_url(*)"],
      },
    },
  };
}

async function main() {
  if (!process.env.AOA_TOKEN) throw new Error("set AOA_TOKEN (see aoa new)");
  const agy = process.env.AOA_AGY_BIN || "agy";
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
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "aoa-antigravity-")));
  const projectId = `aoa-${randomUUID()}`;
  const projectDir = join(homedir(), ".gemini/config/projects");
  const projectPath = join(projectDir, `${projectId}.json`);
  let child;
  const forward = (signal) => {
    if (child?.pid) {
      try { process.kill(-child.pid, signal); } catch (e) { if (e.code !== "ESRCH") throw e; }
    }
  };
  const onInt = () => forward("SIGINT");
  const onTerm = () => forward("SIGTERM");
  try {
    const server = process.env.AOA_SERVER || "http://localhost:4400";
    const project = await preparePlayer({ workspace, projectId, server, token: process.env.AOA_TOKEN });
    await mkdir(projectDir, { recursive: true });
    await writeFile(projectPath, JSON.stringify(project, null, 2), { mode: 0o600, flag: "wx" });
    const env = { ...process.env, AOA_SERVER: server, AOA_AGY_BIN: agy, AOA_AGY_PROJECT: projectId };
    delete env.AOA_RESUME;
    process.on("SIGINT", onInt);
    process.on("SIGTERM", onTerm);
    process.exitCode = await new Promise((resolveExit, reject) => {
      child = spawn(process.execPath, [resolve(here, "../../cli/bin/aoa.mjs"), "run", "--", process.execPath, join(here, "agent.mjs"), ...process.argv.slice(2)], {
        cwd: workspace, env, stdio: "inherit", detached: true,
      });
      child.on("error", reject);
      child.on("exit", (code, signal) => resolveExit(code ?? (signal === "SIGINT" ? 130 : 143)));
    });
  } finally {
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
    await rm(projectPath, { force: true });
    await rm(workspace, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((e) => { console.error(`aoa antigravity: ${e.message}`); process.exitCode = 1; });
}
