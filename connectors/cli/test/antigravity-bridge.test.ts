import { afterEach, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
// @ts-expect-error The player bridge is a plain Node executable module.
import { startToolBridge } from "../../loop-keepers/antigravity/tool.mjs";

const exec = promisify(execFile);
const dirs: string[] = [];
const bridges: { close(): Promise<void> }[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(token: string, server: string, decisionObservations = false) {
  const workspace = await mkdtemp(join(tmpdir(), "aoa-bridge-"));
  dirs.push(workspace);
  const outputDir = join(workspace, "outputs");
  await mkdir(outputDir, { mode: 0o700 });
  const socketPath = join(workspace, "a.sock");
  const bridge = await startToolBridge({ socketPath, server, token });
  bridges.push(bridge);
  const wrapper = join(workspace, "aoa-tool.mjs");
  await writeFile(wrapper, `import { main } from ${JSON.stringify(new URL("../../loop-keepers/antigravity/tool.mjs", import.meta.url).href)};\nawait main(process.argv.slice(2), ${JSON.stringify({ socketPath, outputDir, decisionObservations })});\n`);
  return { bridge, wrapper, workspace, socketPath, outputDir };
}

async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

it("reuses the real MCP connection across CLI invocations and binds each socket to one player's credentials", async () => {
  const requests: { port: number; authorization?: string; url?: string }[] = [];
  const url = await listen(createServer((req, res) => {
    requests.push({ port: req.socket.remotePort!, authorization: req.headers.authorization, url: req.url });
    res.end("complete result");
  }));
  const first = await fixture("first-player", url);
  const second = await fixture("second-player", url);
  expect(first.bridge.definitions.map((tool: { name: string }) => tool.name).sort()).toEqual(["act", "chat", "guide", "history", "run", "script", "script_test", "state"]);
  expect(requests).toHaveLength(0);
  expect((await stat(first.socketPath)).mode & 0o777).toBe(0o600);
  const poisonedEnv = { ...process.env, AOA_SERVER: "http://127.0.0.1:1", AOA_TOKEN: "wrong-player", AOA_AGY_SOCKET: second.socketPath };
  for (let i = 0; i < 4; i++) {
    expect((await exec(process.execPath, [first.wrapper, "guide", "{}"], { env: poisonedEnv })).stdout).toBe("complete result\n");
  }
  await exec(process.execPath, [second.wrapper, "state", "{}"], { env: poisonedEnv });
  expect(requests.map((request) => request.authorization)).toEqual(["Bearer first-player", "Bearer first-player", "Bearer first-player", "Bearer first-player", "Bearer second-player"]);
  // Separate Node MCP processes own separate HTTP pools. Repeated CLI processes
  // must keep reaching the existing MCP rather than launching it again.
  expect(new Set(requests.slice(0, 4).map((request) => request.port)).size).toBe(1);
  expect(requests[4].port).not.toBe(requests[0].port);
});

it("preserves errors and long custom results, rejects malformed commands before HTTP, and closes pending clients", async () => {
  const requests: { url?: string; body: string }[] = [];
  const complete = `user value and logs\n${"complete line\n".repeat(100)}`;
  let pendingRequest: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { pendingRequest = resolve; });
  const url = await listen(createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, body });
    if (req.url?.startsWith("/state")) { pendingRequest?.(); return; }
    if (req.url?.startsWith("/chat")) { res.statusCode = 409; res.end("FAILED chat unavailable"); return; }
    res.end(complete);
  }));
  const player = await fixture("bound-player", url);
  const run = await exec(process.execPath, [player.wrapper, "run", JSON.stringify({ code: 'return "$(echo literal)";' })]);
  const saved = run.stdout.match(/saved to (.+)\. Read it with view_file\./)?.[1];
  expect(saved).toBeDefined();
  expect(await readFile(saved!, "utf8")).toBe(complete);
  expect((await stat(saved!)).mode & 0o777).toBe(0o600);
  expect(requests[0].body).toBe(JSON.stringify({ code: 'return "$(echo literal)";', lang: "js" }));
  await expect(exec(process.execPath, [player.wrapper, "chat", '{"text":"test"}'])).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining("chat unavailable") });
  for (const args of [["run-series", "{}"], ["state", "{}", "extra"], ["state", "null"], ["state", "[]"], ["state", "invalid"]]) {
    await expect(exec(process.execPath, [player.wrapper, ...args])).rejects.toMatchObject({ code: 1 });
  }
  await expect(exec(process.execPath, [player.wrapper, "act", '{"orders":"invalid"}'])).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining("Input validation error") });
  expect(requests).toHaveLength(2);
  const forged = await new Promise<string>((resolve, reject) => {
    const socket = connect(player.socketPath);
    let response = "";
    socket.on("connect", () => socket.end(JSON.stringify({ name: "guide", arguments: {}, server: "http://other", token: "other" }) + "\n"));
    socket.on("data", (chunk) => { response += chunk; });
    socket.on("error", reject);
    socket.on("end", () => resolve(response));
  });
  expect(JSON.parse(forged)).toMatchObject({ error: expect.stringContaining("Invalid bridge request") });
  expect(requests).toHaveLength(2);
  const waiting = exec(process.execPath, [player.wrapper, "state", "{}"]);
  const rejected = expect(waiting).rejects.toMatchObject({ code: 1 });
  await pending;
  await player.bridge.close();
  await rejected;
  await player.bridge.close(); // cleanup is idempotent
  await expect(stat(player.socketPath)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(exec(process.execPath, [player.wrapper, "guide", "{}"])).rejects.toMatchObject({ code: 1 });
  servers[0].closeAllConnections();
});


it("previews every mutation result without hiding a final rejected order, and preserves run values and script reads", async () => {
  const view = `tick 12 · 1.2s/900.0s · 898.8s left · running · you are p1\n${"entity detail\n".repeat(100)}`;
  const orders = Array.from({ length: 50 }, (_, i) => ({ type: "stop", unit: `u${i}` }));
  const header = orders.map((_, i) => i === 49 ? "order 49: FAILED worker died" : `order ${i}: ok`).join("\n") + "\nmineral spent by these orders: 0 · remaining now: 400";
  const act = `${header}\n\n${view}`;
  const run = `run ok · 0 order(s)\nreturned: {"custom":"all player data"}\nlogs:\n\n${view}`;
  const script = `// literal user code\n${"self.move(1, 2);\n".repeat(100)}`;
  const url = await listen(createServer((req, res) => {
    if (req.url?.startsWith("/act")) res.end(act);
    else if (req.url?.startsWith("/run")) res.end(run);
    else if (req.url?.startsWith("/scripts") && req.method === "GET") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ code: script, custom: true })); }
    else if (req.url?.startsWith("/scripts")) res.end(`knight script uploaded, applied at tick 12\n\n${view}`);
    else if (req.url?.startsWith("/chat")) { res.statusCode = 400; res.end(`FAILED cooldown\n\n${view}`); }
    else res.end("unexpected request");
  }));
  const player = await fixture("player", url, true);
  const result = await exec(process.execPath, [player.wrapper, "act", JSON.stringify({ orders })]);
  expect(result.stdout).toContain(header);
  expect(result.stdout).toContain("tick 12 · 1.2s/900.0s");
  expect(result.stdout).not.toContain("entity detail");
  const fullAct = result.stdout.match(/complete response available at (.+)\. Read it/)?.[1];
  expect(await readFile(fullAct!, "utf8")).toBe(act);
  const upload = await exec(process.execPath, [player.wrapper, "script", JSON.stringify({ kind: "knight", code: "self.hold();" })]);
  expect(upload.stdout).toContain("knight script uploaded, applied at tick 12");
  expect(upload.stdout).toContain("Updated full observation follows");
  await expect(exec(process.execPath, [player.wrapper, "chat", '{"text":"hello"}'])).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining("400 FAILED cooldown") });
  for (const [name, args, complete] of [
    ["run", { code: "return view;" }, run],
    ["script", { kind: "knight" }, `// knight: custom\n${script}`],
  ] as const) {
    const result = await exec(process.execPath, [player.wrapper, name, JSON.stringify(args)]);
    expect(result.stdout).not.toContain("Updated full observation follows");
    const saved = result.stdout.match(/saved to (.+)\. Read it with view_file\./)?.[1];
    expect(await readFile(saved!, "utf8")).toBe(complete);
  }
});
