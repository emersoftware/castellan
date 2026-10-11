import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// The launcher is plain Node so players need no extra runtime or build step.
// @ts-expect-error The launcher is an executable .mjs module.
import { preparePlayer } from "../../loop-keepers/antigravity/play.mjs";

const exec = promisify(execFile);
const agent = fileURLToPath(new URL("../../loop-keepers/antigravity/agent.mjs", import.meta.url));
const play = fileURLToPath(new URL("../../loop-keepers/antigravity/play.mjs", import.meta.url));
const dirs: string[] = [];
const files: string[] = [];
async function temp() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "aoa-agy-test-")));
  dirs.push(dir);
  return dir;
}
afterEach(async () => { await Promise.all([...dirs.splice(0), ...files.splice(0)].map((dir) => rm(dir, { recursive: true, force: true }))); });

describe("Antigravity connector", () => {
  it("keeps simultaneous players' tokens and workspaces separate and pre-approves the game only", async () => {
    const root = await temp();
    for (const id of ["p1", "p2"]) {
      const workspace = join(root, id);
      const project = await preparePlayer({ workspace, projectId: id, server: "http://localhost:4400", token: `token-${id}` });
      const mcp = JSON.parse(await readFile(join(workspace, ".agents/mcp_config.json"), "utf8"));
      expect(Object.keys(mcp.mcpServers)).toEqual(["aoa"]);
      expect(mcp.mcpServers.aoa.env).toEqual({ AOA_SERVER: "http://localhost:4400", AOA_TOKEN: `token-${id}` });
      expect(project.projectResources.resources[0].folderUri).toContain(`/${id}`);
      expect(project.permissionGrants.permissionGrants.allow).toEqual(["mcp(aoa/*)"]);
      expect(project.permissionGrants.permissionGrants.deny).toContain("command(*)");
      // Actually launch the generated MCP from the player's temporary workspace.
      const client = new Client({ name: "agy-config-test", version: "0" });
      try {
        await client.connect(new StdioClientTransport({ ...mcp.mcpServers.aoa, cwd: workspace }));
        expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(["act", "chat", "history", "rules", "run", "script", "script_test", "state"]);
      } finally {
        await client.close();
      }
    }
  });

  it("passes model, credentials and the recovery prompt without invoking a shell or resuming another match", async () => {
    const root = await temp();
    const bin = join(root, "fake agy");
    const capture = join(root, "capture.json");
    const projectId = `aoa-test-${randomUUID()}`;
    const conversation = randomUUID();
    const projectPath = join(homedir(), ".gemini/config/projects", `${projectId}.json`);
    files.push(projectPath);
    // A fresh CI machine has no Antigravity installation or project directory.
    await mkdir(dirname(projectPath), { recursive: true });
    await writeFile(projectPath, JSON.stringify(await preparePlayer({ workspace: root, projectId, server: "http://localhost:4400", token: "player-only" })), { mode: 0o600 });
    await writeFile(bin, `#!${process.execPath}\nconst args = process.argv.slice(2);\nif (!args.includes('--conversation')) { console.log(JSON.stringify({ status: 'SUCCESS', conversation_id: '${conversation}' })); }\nelse require('node:fs').writeFileSync(process.env.CAPTURE, JSON.stringify({ args, cwd: process.cwd(), token: process.env.AOA_TOKEN }));\n`, { mode: 0o700 });
    const env = { ...process.env, AOA_AGY_BIN: bin, AOA_AGY_PROJECT: projectId, AOA_TOKEN: "player-only", CAPTURE: capture };
    for (const resumed of [false, true]) {
      await exec(process.execPath, [agent, "--model", "Gemini 3.6 Flash (Low)"], { cwd: root, env: { ...env, AOA_RESUME: resumed ? "1" : "" } });
      const called = JSON.parse(await readFile(capture, "utf8"));
      expect(called.token).toBe("player-only");
      expect(called.cwd).toBe(root);
      expect(called.args.slice(0, 6)).toEqual(["--project", projectId, "--print-timeout", "15m", "--model", "Gemini 3.6 Flash (Low)"]);
      expect(called.args).not.toContain("--dangerously-skip-permissions");
      expect(called.args).not.toContain("--continue");
      expect(called.args[called.args.indexOf("--conversation") + 1]).toBe(conversation);
      expect(called.args.at(-1)).toContain("The connector will automatically provide another observation");
      expect(called.args.at(-1).startsWith("You were restarted")).toBe(resumed);
      const grants = JSON.parse(await readFile(projectPath, "utf8")).permissionGrants.permissionGrants;
      expect(grants.allow).toEqual(["mcp(aoa/*)", `read_file(${join(homedir(), ".gemini/antigravity-cli/mcp/aoa")})`, `read_file(${join(homedir(), ".gemini/antigravity-cli/brain", conversation, ".system_generated/steps")})`]);
      expect(grants.deny).not.toContain("read_file(*)");
    }
  });

  it("fails before joining a room when credentials or the executable are missing", async () => {
    const env = { ...process.env, AOA_TOKEN: "" };
    await expect(exec(process.execPath, [play], { env })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("set AOA_TOKEN") });
    await expect(exec(process.execPath, [play], { env: { ...env, AOA_TOKEN: "test", AOA_AGY_BIN: "/does-not-exist/agy" } })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("Antigravity CLI not found") });
  });
});
