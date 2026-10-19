import { afterEach, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const agent = fileURLToPath(new URL("../../loop-keepers/antigravity/agent.mjs", import.meta.url));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

type Call = { kind: string; pid?: number; conversation?: string; prompt?: string; overlap?: boolean; args?: string[]; adc?: string };
async function fixture(mode = "normal") {
  const dir = await mkdtemp(join(tmpdir(), "castellan-agy-runtime-"));
  const project = `castellan-runtime-${randomUUID()}`;
  const projectFile = join(homedir(), ".gemini/config/projects", `${project}.json`);
  await mkdir(dirname(projectFile), { recursive: true });
  await writeFile(projectFile, JSON.stringify({ permissionGrants: { permissionGrants: { allow: [], deny: ["command(*)", "write_file(*)"] } } }));
  cleanups.push(async () => { await rm(dir, { recursive: true, force: true }); await rm(projectFile, { force: true }); });
  const bin = join(dir, "fake-agy"), log = join(dir, "calls.jsonl"), failed = join(dir, "failed");
  await writeFile(bin, `#!${process.execPath}
const fs = require('node:fs'), readline = require('node:readline');
const args = process.argv.slice(2), mode = process.env.FAKE_MODE;
const emit = value => process.stdout.write(JSON.stringify(value)+'\\n');
const record = value => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(value)+'\\n');
if (args.includes('--version')) { console.log('1.3.4'); process.exit(0); }
const at = args.indexOf('--conversation');
const conversation = at < 0 ? '11111111-1111-4111-8111-111111111111' : args[at + 1];
if (!args.includes('--input-format')) {
  record({kind:'legacy',pid:process.pid,args});
  emit({status:'SUCCESS',conversation_id:conversation}); process.exit(0);
}
record({kind:'start',pid:process.pid,conversation,args,adc:process.env.AGY_ADC_AUTH});
emit({event:'init',conversation_id:conversation,init:{model:'gemini-4-argon-low'}});
let busy = false, turns = 0;
if(mode==='stubborn') setInterval(() => {},1000);
process.on('SIGTERM', () => { record({kind:'terminated',pid:process.pid}); if(mode!=='stubborn') process.exit(0); });
readline.createInterface({input:process.stdin}).on('line', line => {
  const input=JSON.parse(line); record({kind:'prompt',pid:process.pid,conversation,prompt:input.message.content,overlap:busy}); busy=true;
  if(mode==='blocked') return;
  if(mode==='always-crash' || (mode==='crash' && !fs.existsSync(process.env.FAKE_FAILED))) { fs.writeFileSync(process.env.FAKE_FAILED,'1'); process.exit(3); }
  setTimeout(() => { busy=false; record({kind:'result',pid:process.pid}); emit({event:'result',result:{status:'SUCCESS',conversation_id:conversation,num_turns:++turns,usage:{input_tokens:turns*10,output_tokens:turns}}}); },10);
}).on('close', () => { record({kind:'eof',pid:process.pid}); if(!busy && mode!=='stubborn') setTimeout(() => process.exit(0), 50); });
`, { mode: 0o700 });
  const calls = async (): Promise<Call[]> => (await readFile(log, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  let status = "prep", alive = true, tick = 0, statusReads = 0;
  const states: { tick: number; since: string | null; status: string }[] = [];
  const http = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    if (url.pathname === "/guide") {
      res.setHeader("content-type", "text/plain"); res.end("Test room mechanics: losing your King eliminates you.");
    } else if (url.pathname === "/state") {
      if (status === "running") tick++;
      states.push({ tick, since: url.searchParams.get("since"), status });
      res.setHeader("content-type", "text/plain");
      res.end(`tick ${tick} · 0.1s/60s · ${status} · you are p1\nYOU   p1: mineral 200${alive ? "" : " · OUT"}\nobservation ${tick}`);
    } else {
      res.setHeader("content-type", "application/json");
      if (url.pathname === "/status") { statusReads++; res.end(JSON.stringify({ status, alive, tick })); }
      else { for await (const _ of req) { /* consume metadata */ } res.end("{}"); }
    }
  });
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>(resolve => http.close(() => resolve())));
  const port = (http.address() as { port: number }).port;
  const child = spawn(process.execPath, [agent, "--model", "gemini-4-argon-low", "--effort", "low", "--output-format", "stream-json"], {
    cwd: dir, env: { ...process.env, CASTELLAN_SERVER: `http://127.0.0.1:${port}`, CASTELLAN_TOKEN: "test-player", CASTELLAN_AGY_PROJECT: project,
      CASTELLAN_AGY_BIN: bin, CASTELLAN_AGY_TRANSPORT: "mcp", CASTELLAN_CONNECTOR_VERSION: "1.3.4", AGY_ADC_AUTH: "true", FAKE_MODE: mode, FAKE_LOG: log, FAKE_FAILED: failed },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; });
  const exit = new Promise<number | null>(resolve => child.on("close", resolve));
  cleanups.push(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); await exit; });
  return { calls, states, child, exit, output: () => output, statusReads: () => statusReads,
    phase: (value: string) => { status = value; }, eliminate: () => { alive = false; } };
}

it("delivers the shared first turn in prep, then later turns only while running, in one conversation", async () => {
  const f = await fixture();
  await vi.waitFor(async () => expect((await f.calls()).filter(c => c.kind === "prompt")).toHaveLength(1), { timeout: 8000 });
  expect(f.states[0]).toMatchObject({ status: "prep" });
  f.phase("running");
  await vi.waitFor(async () => expect((await f.calls()).filter(c => c.kind === "result")).toHaveLength(2), { timeout: 8000 });
  f.phase("finished");
  expect(await f.exit).toBe(0);
  const calls = await f.calls(), prompts = calls.filter(c => c.kind === "prompt");
  expect(calls.filter(c => c.kind === "start")).toHaveLength(1);
  expect(new Set(prompts.map(c => c.conversation)).size).toBe(1);
  expect(prompts.map(c => c.overlap)).toEqual([false, false]);
  expect(prompts[0].prompt).toMatch(/^PLAY/);
  expect(prompts[0].prompt).not.toContain("Test room mechanics");
  expect(prompts[1].prompt).not.toContain("PLAY");
  expect(prompts[0].prompt).toContain("observation 0"); // delivered in prep
  expect(prompts[1].prompt).toContain("observation 1");
  expect(prompts[1].prompt).not.toContain("Reply READY");
  expect(f.states.filter(s => s.status === "running").map(s => s.since)).toEqual(["0"]);
  expect(calls[0].args).toContain("low");
  expect(calls[0].adc).toBe("true");
  expect(calls.filter(c => c.kind === "eof")).toHaveLength(1);
  expect(calls.filter(c => c.kind === "terminated")).toEqual([]);
});

it("recovers an interrupted process in the same conversation and refreshes state without replaying a decision", async () => {
  const f = await fixture("crash");
  f.phase("running");
  await vi.waitFor(async () => expect((await f.calls()).filter(c => c.kind === "prompt")).toHaveLength(2), { timeout: 8000 });
  f.phase("finished");
  expect(await f.exit).toBe(0);
  const calls = await f.calls(), starts = calls.filter(c => c.kind === "start"), prompts = calls.filter(c => c.kind === "prompt");
  expect(starts).toHaveLength(2);
  expect(starts[1].args).toContain("--conversation");
  expect(starts[1].conversation).toBe(starts[0].conversation);
  // The crashed first turn never completed, so the restarted session gets the first turn again.
  expect(prompts[1].prompt).toMatch(/^PLAY/);
  expect(prompts[1].prompt).toContain("observation 3");
  expect(prompts[0].prompt).toContain("observation 2");
  expect(f.states.map(s => s.since)).toEqual(["0", "0", "0"]);
});

it.each(["finished", "eliminated", "signal"])("cancels an in-flight model turn on %s and does not open another turn", async ending => {
  const f = await fixture("blocked");
  f.phase("running");
  await vi.waitFor(async () => expect((await f.calls()).filter(c => c.kind === "prompt")).toHaveLength(1), { timeout: 8000 });
  if (ending === "signal") f.child.kill("SIGTERM");
  else if (ending === "eliminated") f.eliminate();
  else f.phase("finished");
  expect(await f.exit).toBe(ending === "signal" ? 1 : 0);
  const calls = await f.calls();
  expect(calls.filter(c => c.kind === "terminated")).toHaveLength(1);
  expect(calls.filter(c => c.kind === "prompt")).toHaveLength(1);
  expect(calls.filter(c => c.kind === "start")).toHaveLength(1);
});

it("stops after three process failures instead of endlessly restarting a paid model", async () => {
  const f = await fixture("always-crash");
  f.phase("running");
  expect(await f.exit).toBe(1);
  const calls = await f.calls();
  expect(calls.filter(c => c.kind === "start")).toHaveLength(3);
  expect(calls.filter(c => c.kind === "prompt")).toHaveLength(3);
  expect(new Set(calls.filter(c => c.kind === "start").map(c => c.conversation)).size).toBe(1);
  expect(f.output()).toContain("stopped after 3 failures");
}, 15_000);


it("bounds idle shutdown when a process ignores EOF and SIGTERM", async () => {
  const f = await fixture("stubborn");
  f.phase("running");
  await vi.waitFor(async () => expect((await f.calls()).filter(c => c.kind === "result")).toHaveLength(1), { timeout: 8000 });
  f.phase("finished");
  expect(await f.exit).toBe(0);
  const calls = await f.calls();
  expect(calls.filter(c => c.kind === "eof")).toHaveLength(1);
  expect(calls.filter(c => c.kind === "terminated")).toHaveLength(1);
  expect(calls.filter(c => c.kind === "prompt")).toHaveLength(1);
  const pid = calls.find(c => c.kind === "start")!.pid!;
  expect(() => process.kill(pid, 0)).toThrow();
}, 15_000);
