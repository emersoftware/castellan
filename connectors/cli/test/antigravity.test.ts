import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { access, mkdtemp, realpath, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// The launcher is plain Node so players need no extra runtime or build step.
// @ts-expect-error The launcher is an executable .mjs module.
import { preparePlayer } from "../../loop-keepers/antigravity/play.mjs";
// @ts-expect-error The bridge is an executable .mjs module.
import { startToolBridge } from "../../loop-keepers/antigravity/tool.mjs";

const exec = promisify(execFile);
const play = fileURLToPath(new URL("../../loop-keepers/antigravity/play.mjs", import.meta.url));
const dirs: string[] = [];
async function temp() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "aoa-agy-test-")));
  dirs.push(dir);
  return dir;
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe("Antigravity connector", () => {
  it("keeps simultaneous native MCP players' tokens and workspaces separate and pre-approves the game only", async () => {
    const root = await temp();
    for (const id of ["p1", "p2"]) {
      const workspace = join(root, id);
      const project = await preparePlayer({ workspace, projectId: id, server: "http://localhost:4400", token: `token-${id}`, transport: "mcp" });
      const mcp = JSON.parse(await readFile(join(workspace, ".agents/mcp_config.json"), "utf8"));
      expect(Object.keys(mcp.mcpServers)).toEqual(["aoa"]);
      expect(mcp.mcpServers.aoa.env).toEqual({ AOA_SERVER: "http://localhost:4400", AOA_TOKEN: `token-${id}` });
      expect(project.projectResources.resources[0].folderUri).toContain(`/${id}`);
      expect(project.permissionGrants.permissionGrants.allow).toEqual(["mcp(aoa/*)"]);
      expect(project.permissionGrants.permissionGrants.deny).toContain("command(*)");
      const client = new Client({ name: "agy-config-test", version: "0" });
      try {
        await client.connect(new StdioClientTransport({ ...mcp.mcpServers.aoa, cwd: workspace }));
        expect((await client.listTools()).tools.map(t => t.name).sort()).toEqual(["act", "chat", "history", "rules", "run", "script", "script_test", "state"]);
      } finally { await client.close(); }
    }
  });

  it.each(["mcp", "cli"])("%s: the real launcher preserves model, effort and Vertex auth, grants only its outputs, and cleans the project", async transport => {
    const root = await temp(), bin = join(root, "fake agy"), capture = join(root, "capture.json");
    const conversation = randomUUID();
    let finished = false;
    const metadata: { model?: string; effort?: string; contextPolicy?: string }[] = [];
    const http = createServer(async (req, res) => {
      if (req.url?.startsWith("/rules")) { res.end("Room mechanics for this player."); return; }
      if (req.url?.startsWith("/state")) { res.end("tick 5 · 0.5s/60s · running · you are p1\nYOU   p1: mineral 200"); return; }
      res.setHeader("content-type", "application/json");
      if (req.url === "/status") { res.end(JSON.stringify({ status: finished ? "finished" : "running", alive: true })); return; }
      if (req.url === "/done") finished = true;
      let body = ""; for await (const chunk of req) body += chunk;
      if (req.url === "/agent-config") metadata.push(JSON.parse(body));
      res.end("{}");
    });
    await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
    const server = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
    await writeFile(bin, `#!${process.execPath}
const fs=require('node:fs'), path=require('node:path'), os=require('node:os'), readline=require('node:readline');
const args=process.argv.slice(2);
if(args.includes('--help') || args[0]==='models') process.exit(0);
if(args.includes('--version')) { console.log('1.3.4'); process.exit(0); }
if(!args.includes('--input-format')) { console.error('Expected the persistent streaming protocol'); process.exit(2); }
const projectFile=path.join(os.homedir(),'.gemini/config/projects',args[args.indexOf('--project')+1]+'.json');
console.log(JSON.stringify({event:'init',conversation_id:'${conversation}',init:{model:'gemini-4-argon-low'}}));
readline.createInterface({input:process.stdin}).on('line',async line=>{
  const prompt=JSON.parse(line).message.content;
  fs.writeFileSync(process.env.CAPTURE,JSON.stringify({args,prompt,cwd:process.cwd(),projectFile,token:process.env.AOA_TOKEN,adc:process.env.AGY_ADC_AUTH,grants:JSON.parse(fs.readFileSync(projectFile)).permissionGrants.permissionGrants}));
  console.log(JSON.stringify({event:'result',result:{status:'SUCCESS',conversation_id:'${conversation}',num_turns:1}}));
  await fetch(process.env.AOA_SERVER+'/done');
}).on('close',()=>process.exit(0));
`, { mode: 0o700 });
    try {
      await exec(process.execPath, [play, "--model", "gemini-4-argon-low", "--effort", "low", "--output-format", "stream-json"], {
        cwd: root, env: { ...process.env, AOA_AGY_BIN: bin, AOA_AGY_TRANSPORT: transport, AOA_SERVER: server,
          AOA_TOKEN: "player-only", AGY_ADC_AUTH: "true", CAPTURE: capture }, timeout: 12_000,
      });
      const called = JSON.parse(await readFile(capture, "utf8"));
      expect(called.token).toBe("player-only");
      expect(called.adc).toBe("true");
      expect(called.args).toEqual(expect.arrayContaining(["--model", "gemini-4-argon-low", "--effort", "low", "--input-format", "stream-json"]));
      expect(called.args).not.toContain("--dangerously-skip-permissions");
      expect(called.args).not.toContain("--continue");
      expect(called.args).not.toContain("-p");
      expect(called.prompt).toContain("The connector will automatically provide another observation");
      expect(called.prompt).toContain("Room mechanics for this player.");
      expect(called.prompt).toContain("tick 5");
      const ownOutputs = `read_file(${join(homedir(), ".gemini/antigravity-cli/brain", conversation, ".system_generated/steps")})`;
      if (transport === "cli") {
        expect(called.grants.allow).toEqual([`command(${join(called.cwd, "bin/aoa-tool")})`, `read_file(${join(called.cwd, "tool-output")})`, `read_file(${join(called.cwd, ".agents/tool-schemas.json")})`, ownOutputs]);
        expect(called.grants.deny).toEqual(["write_file(*)", "read_url(*)", "execute_url(*)"]);
        expect(called.prompt).toContain(`${join(called.cwd, "bin/aoa-tool")} state '{}'`);
        expect(called.prompt).toContain("explicit order-result preview");
        expect(called.prompt).toContain("Game tool schemas:");
      } else {
        expect(called.grants.allow).toEqual(["mcp(aoa/*)", `read_file(${join(homedir(), ".gemini/antigravity-cli/mcp/aoa")})`, ownOutputs]);
        expect(called.grants.deny).toContain("command(*)");
      }
      expect(called.grants.deny).not.toContain("read_file(*)");
      expect(metadata).toHaveLength(1);
      expect(metadata[0]).toMatchObject({ model: "gemini-4-argon-low", effort: "low", contextPolicy: expect.stringContaining("persistent-stream-json") });
      await expect(access(called.projectFile)).rejects.toThrow();
      await expect(access(called.cwd)).rejects.toThrow();
    } finally { await new Promise<void>(resolve => http.close(() => resolve())); }
  });

  it("bridges real MCP schemas with bound credentials, preserves complete results, and rejects host commands and invalid inputs", async () => {
    const root = await temp();
    const requests: { url: string; authorization?: string; body: string }[] = [];
    const longRules = `Player rules\n${"Complete rule line\n".repeat(100)}`;
    const http = createServer(async (req, res) => {
      let body = ""; for await (const chunk of req) body += chunk;
      requests.push({ url: req.url!, authorization: req.headers.authorization, body });
      res.setHeader("content-type", "text/plain");
      res.end(req.url?.startsWith("/rules") ? longRules : "Game result");
    });
    await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
    let bridge;
    try {
      const server = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
      bridge = await startToolBridge({ socketPath: join(root, "tools.sock"), server, token: "bound-player" });
      await preparePlayer({ workspace: root, projectId: "bridge", server, token: "bound-player", transport: "cli", bridge });
      const schemas = JSON.parse(await readFile(join(root, ".agents/tool-schemas.json"), "utf8"));
      expect(schemas.map((t: { name: string }) => t.name).sort()).toEqual(["act", "chat", "history", "rules", "run", "script", "script_test", "state"]);
      expect(requests).toEqual([]);
      const tool = join(root, "bin/aoa-tool");
      expect(await readFile(tool, "utf8")).not.toContain("bound-player");
      const env = { ...process.env, AOA_SERVER: "http://127.0.0.1:1", AOA_TOKEN: "other-player", AOA_AGY_TOOL_OUTPUT_DIR: "/does-not-exist" };
      const result = await exec(tool, ["rules", "{}"], { cwd: root, env });
      const saved = result.stdout.match(/saved to (.+)\. Read it with view_file\./)?.[1];
      expect(saved).toBeDefined();
      expect(dirname(saved!)).toBe(join(root, "tool-output"));
      expect(await readFile(saved!, "utf8")).toBe(longRules);
      expect(requests).toEqual([{ url: "/rules?format=text", authorization: "Bearer bound-player", body: "" }]);
      const code = 'return "$(echo shell-substitution-is-literal)";';
      expect((await exec(tool, ["run", JSON.stringify({ code })], { cwd: root, env })).stdout).toBe("Game result\n");
      expect(JSON.parse(requests[1].body)).toEqual({ code, lang: "js" });
      expect(requests[1].authorization).toBe("Bearer bound-player");
      for (const args of [["run-series", "{}"], ["run", "{}", "--", "echo"], ["state", "null"], ["state", "[]"], ["state", "not-json"]]) {
        await expect(exec(tool, args, { cwd: root, env })).rejects.toMatchObject({ code: 1 });
      }
      await expect(exec(tool, ["act", '{"orders":"invalid"}'], { cwd: root, env })).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining("Input validation error") });
      expect(requests).toHaveLength(2);
    } finally {
      await bridge?.close();
      await new Promise<void>(resolve => http.close(() => resolve()));
    }
  });

  it("fails before joining a room when credentials or the executable are missing", async () => {
    const env = { ...process.env, AOA_TOKEN: "" };
    await expect(exec(process.execPath, [play], { env })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("set AOA_TOKEN") });
    await expect(exec(process.execPath, [play], { env: { ...env, AOA_TOKEN: "test", AOA_AGY_BIN: "/does-not-exist/agy" } })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("Antigravity CLI not found") });
  });
});
