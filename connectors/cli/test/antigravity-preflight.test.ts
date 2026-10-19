import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error Executable plain Node module, shared with the real launcher.
import { runPreflight } from "../../loop-keepers/antigravity/preflight.mjs";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function setup(mode = "success") {
  const root = await mkdtemp(join(tmpdir(), "castellan-preflight-test-"));
  roots.push(root);
  const agy = join(root, "fake-agy.mjs"), capture = join(root, "capture.json");
  const mcpPackage = fileURLToPath(new URL("../../mcp/package.json", import.meta.url));
  await writeFile(agy, `#!${process.execPath}
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
const args=process.argv.slice(2), projectId=args[args.indexOf('--project')+1];
const projectPath=join(homedir(),'.gemini/config/projects',projectId+'.json');
const context={args,workspace:process.cwd(),projectPath,adc:process.env.AGY_ADC_AUTH,token:process.env.CASTELLAN_TOKEN};
writeFileSync(process.env.PREFLIGHT_CAPTURE,JSON.stringify(context));
const mode=process.env.PREFLIGHT_MODE;
if(mode==='hang') {
  process.on('SIGTERM',()=>{});
  const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});
  context.childPid=child.pid;writeFileSync(process.env.PREFLIGHT_CAPTURE,JSON.stringify(context));
  setInterval(()=>{},1000);
} else {
  const results=[];
  if(mode!=='status-only') {
    const tools=mode==='one-tool'?['guide']:['guide','state'];
    const project=JSON.parse(readFileSync(projectPath,'utf8'));
    if(project.permissionGrants.permissionGrants.allow.some(x=>x.startsWith('command('))) {
      for(const tool of tools) results.push(execFileSync(join(process.cwd(),'bin/castellan-tool'),[tool,'{}'],{encoding:'utf8'}));
    } else {
      const require=createRequire(${JSON.stringify(mcpPackage)});
      const {Client}=await import(require.resolve('@modelcontextprotocol/sdk/client/index.js'));
      const {StdioClientTransport}=await import(require.resolve('@modelcontextprotocol/sdk/client/stdio.js'));
      const config=JSON.parse(readFileSync(join(process.cwd(),'.agents/mcp_config.json'),'utf8')).mcpServers.castellan;
      context.endpoint=config.env.CASTELLAN_SERVER;writeFileSync(process.env.PREFLIGHT_CAPTURE,JSON.stringify(context));
      const client=new Client({name:'fake-agy-preflight',version:'1'});
      try { await client.connect(new StdioClientTransport(config));
        for(const tool of tools) results.push(JSON.stringify(await client.callTool({name:tool,arguments:{}})));
      } finally { await client.close(); }
    }
  }
  console.log(JSON.stringify({status:'SUCCESS',response:mode==='wrong-nonces'?'READY':results.join('\\n')}));
}
`, { mode: 0o700 });
  return { agy, capture, options: { agy, model: "test-argon-low", effort: "low", env: { ...process.env, AGY_ADC_AUTH: "true", CASTELLAN_TOKEN: "must-not-reach-diagnostic", CASTELLAN_SERVER: "http://127.0.0.1:1", PREFLIGHT_MODE: mode, PREFLIGHT_CAPTURE: capture } } };
}

async function checkCleanup(capture: string) {
  const context = JSON.parse(await readFile(capture, "utf8"));
  await expect(access(context.workspace)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(context.projectPath)).rejects.toMatchObject({ code: "ENOENT" });
  if (context.endpoint) await expect(fetch(context.endpoint)).rejects.toThrow();
  return context;
}

it.each(["cli", "mcp"])("%s: confirms real authenticated guide and state responses through the prepared transport, then removes its resources", async (transport) => {
  const { options, capture } = await setup();
  await expect(runPreflight({ ...options, transport })).resolves.toMatchObject({ ok: true, model: "test-argon-low", effort: "low", transport, calls: { guide: 1, state: 1 } });
  const context = await checkCleanup(capture);
  expect(context.adc).toBe("true");
  expect(context.token).toBeUndefined();
  expect(context.args.filter((arg: string) => arg === "-p")).toHaveLength(1);
  expect(context.args).toEqual(expect.arrayContaining(["--model", "test-argon-low", "--effort", "low", "--print-timeout", "60000ms"]));
  expect(context.args).not.toContain("--conversation");
});

it.each([
  ["status-only", "no real calls to guide, state"],
  ["one-tool", "no real calls to state"],
  ["wrong-nonces", "did not confirm the actual guide, state nonce"],
])("rejects %s even when agy reports SUCCESS and cleans up", async (mode, message) => {
  const { options, capture } = await setup(mode);
  await expect(runPreflight(options)).rejects.toThrow(message);
  await checkCleanup(capture);
});

it("bounds a stalled model and kills its child processes before removing the project", async () => {
  const { options, capture } = await setup("hang");
  await expect(runPreflight({ ...options, timeoutMs: 1000 })).rejects.toThrow("timed out after 1000 ms");
  const context = await checkCleanup(capture);
  expect(context.childPid).toBeTypeOf("number");
  // The OS may need a moment to reap the terminated grandchild.
  await expect.poll(() => { try { process.kill(context.childPid, 0); return false; } catch { return true; } }).toBe(true);
});
