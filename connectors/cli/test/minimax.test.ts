import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { buildServer } from "@castellan/server";
// @ts-expect-error Plain Node connector.
import { options, preparePlayer, decisionEvents, main } from "../../loop-keepers/minimax/agent.mjs";
// @ts-expect-error Plain Node runtime.
import { cli } from "../../loop-keepers/minimax/runtime.mjs";

const exec = promisify(execFile);
const dirs: string[] = [];
const available = existsSync(cli);
async function temp() { const p = await mkdtemp(join(tmpdir(), "castellan-minimax-test-")); dirs.push(p); return p; }
afterEach(async () => { await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true }))); });

describe("MiniMax Code connector", () => {
  it("rejects session, permission, endpoint and invalid model/effort overrides", () => {
    expect(options([])).toMatchObject({ model: "MiniMax-M3.1-Flash", effort: "low" });
    for (const args of [["--permission", "full"], ["--session", "other"], ["--base-url", "http://other"], ["--effort", "off"], ["--model", "other/model"]])
      expect(() => options(args)).toThrow();
  });

  it("isolates credentials, homes and game configuration per player", async () => {
    const root = await temp();
    const player = await preparePlayer({ root, key: "test-private-key", token: "seat-one",
      env: { PATH: process.env.PATH, HOME: "/personal-home", MINIMAX_DATA_DIR: "/wrong", OPENAI_API_KEY: "other-key", NODE_OPTIONS: "--require other" } });
    expect(player.env.HOME).toBe(join(root, "home"));
    expect(player.env.MINIMAX_DATA_DIR).toBe(join(root, "mcode"));
    expect(player.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(player.env).not.toHaveProperty("NODE_OPTIONS");
    expect((await stat(player.configPath)).mode & 0o777).toBe(0o600);
    expect((await stat(join(player.data, "mcp.json"))).mode & 0o777).toBe(0o600);
    const metadata = await readFile(join(root, "run.json"), "utf8");
    expect(metadata).not.toContain("test-private-key");
    expect(metadata).not.toContain("seat-one");
  });

  it("parses split stream records and retains a session from an incomplete decision", () => {
    const events = decisionEvents();
    events.push('{"schemaVersion":1,"type":"session.started","session');
    events.push('Id":"one"}\nnoise\n{"schemaVersion":1,"type":"exec.completed","sessionId":"one","result":{"status":"failed"}}');
    expect(events.finish()).toEqual({ session: "one", result: { status: "failed" } });
    const interrupted = decisionEvents();
    interrupted.push('{"schemaVersion":1,"type":"exec.started","sessionId":"two"}\n');
    expect(interrupted.finish()).toEqual({ session: "two", result: undefined });
  });

  it("fails before reading a game when the API key is missing", async () => {
    const missing = join(await temp(), "missing-key");
    let fetched = false;
    await expect(main([], { CASTELLAN_TOKEN: "game", CASTELLAN_MINIMAX_KEY_FILE: missing },
      { fetchImpl: async () => { fetched = true; return new Response(); } })).rejects.toThrow("set MINIMAX_API_KEY");
    expect(fetched).toBe(false);
  });

  it.skipIf(!available)("delivers the shared turns, resumes one session and stops on game end", async () => {
    const at = (status: string, tick: number) => `tick ${tick} · 0.0s/600.0s · 600.0s left · ${status} · you are p1\nYOU   p1: mineral 200`;
    const observations = [at("prep", 0), at("running", 20), at("finished", 40)];
    const launches: { args: string[]; prompt: string }[] = [];
    const paths: string[] = [];
    const activity: string[] = [];
    const code = await main([], { MINIMAX_API_KEY: "fixture-only", CASTELLAN_TOKEN: "game-only" }, {
      minIntervalMs: 0, pollMs: 60000,
      fetchImpl: async (url: string, init: RequestInit = {}) => {
        const path = new URL(url).pathname; paths.push(new URL(url).pathname + new URL(url).search);
        if (path === "/state") return new Response(observations.shift());
        if (path === "/agent-status") activity.push(JSON.parse(init.body as string).state);
        return Response.json({});
      },
      spawnImpl: (_binary: string, args: string[], opts: any) => {
        const root = join(opts.cwd, "..");
        if (!dirs.includes(root)) dirs.push(root);
        const record = { args, prompt: "" }; launches.push(record);
        const child: any = new EventEmitter();
        child.stdin = new PassThrough(); child.stdout = new PassThrough();
        child.kill = () => true;
        child.stdin.on("data", (chunk: Buffer) => { record.prompt += chunk; });
        child.stdin.on("finish", () => {
          child.stdout.end(JSON.stringify({ schemaVersion: 1, type: "exec.completed", sessionId: "private-match-session",
            result: { status: "succeeded", usage: { inputTokens: 10, outputTokens: 2 } } }) + "\n");
          setImmediate(() => child.emit("close", 0));
        });
        return child;
      },
    });
    expect(code).toBe(0);
    expect(launches).toHaveLength(2);
    expect(launches[0].prompt).toBe(`PLAY\n\n${at("prep", 0)}`);
    expect(launches[1].prompt).toBe(at("running", 20));
    expect(launches[1].args).toContain("private-match-session");
    expect(paths.filter(p => p.startsWith("/state"))).toEqual(["/state?format=text&since=0", "/state?format=text&since=0", "/state?format=text&since=20"]);
    expect(activity).toEqual(["deciding", "between_decisions", "deciding", "between_decisions", "stopped"]);
  });

  it.skipIf(!available)("stops an active decision when the supervisor reports elimination", async () => {
    let killed = false, spawned = false;
    const paths: string[] = [];
    const code = await main([], { MINIMAX_API_KEY: "fixture-only", CASTELLAN_TOKEN: "game-only" }, {
      minIntervalMs: 0, pollMs: 5,
      fetchImpl: async (url: string) => {
        const path = new URL(url).pathname; paths.push(path);
        if (path === "/status") return Response.json({ status: "running", alive: !spawned });
        if (path === "/state") return new Response("tick 0 · 0.0s/600.0s · 600.0s left · prep · you are p1\nYOU   p1: mineral 200");
        return Response.json({});
      },
      spawnImpl: (_binary: string, args: string[], opts: any) => {
        expect(args).not.toContain("--timeout");
        dirs.push(join(opts.cwd, "..")); spawned = true;
        const child: any = new EventEmitter();
        child.stdin = new PassThrough(); child.stdout = new PassThrough();
        child.stdin.resume();
        child.kill = () => { killed = true; setImmediate(() => child.emit("close", null)); return true; };
        return child;
      },
    });
    expect(code).toBe(0);
    expect(killed).toBe(true);
    expect(paths.filter(path => path === "/state")).toHaveLength(1);
    expect(paths).toContain("/status");
  });

  it.skipIf(!available)("runs the pinned CLI with restricted tools, sends low effort and resumes its conversation", async () => {
    const root = await temp();
    const game = await buildServer({ replayDir: join(root, "replays"), prepMs: 0 });
    await game.listen({ port: 0, host: "127.0.0.1" });
    const server = `http://127.0.0.1:${(game.server.address() as { port: number }).port}`;
    const room = (await game.inject({ method: "POST", url: "/rooms", payload: { players: [{ name: "MiniMax fixture" }, { bot: "eco" }] } })).json();
    const token = room.players[0].token;
    const requests: any[] = [];
    let workersBeforeTraining = 0;
    const provider = createServer(async (req, res) => {
      let raw = ""; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      if (req.url?.endsWith("/input_tokens")) {
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ input_tokens: 100 })); return;
      }
      const auxiliary = !body.tools?.length;
      if (!auxiliary) requests.push(body);
      const turn = auxiliary ? 99 : requests.length;
      let content: any[];
      const tool = (name: string, input: any = {}) => ({
        type: "tool_use", id: `${name}-${turn}`, name: body.tools.find((t: any) => t.name.endsWith(`__${name}`))?.name ?? `mcp__castellan__${name}`, input,
      });
      if (auxiliary) content = [{ type: "text", text: "Fixture title" }];
      else if (turn === 1) content = [tool("guide"), tool("state")];
      else if (turn === 2) {
        const view = (await game.inject({ url: "/state", headers: { authorization: `Bearer ${token}` } })).json();
        workersBeforeTraining = view.mine.filter((e: any) => e.kind === "worker").length;
        content = [tool("act", { orders: [{ type: "train", building: view.mine.find((e: any) => e.kind === "castle").id, kind: "worker" }] })];
      } else content = [{ type: "text", text: turn === 3 ? "Decision one remembered." : "Decision two finished." }];
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (type: string, data: any) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      send("message_start", { message: { id: `msg${turn}`, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null,
        usage: { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 20 } } });
      for (const [index, block] of content.entries()) {
        send("content_block_start", { index, content_block: block.type === "tool_use" ? { ...block, input: {} } : { ...block, text: "" } });
        send("content_block_delta", { index, delta: block.type === "tool_use"
          ? { type: "input_json_delta", partial_json: JSON.stringify(block.input) } : { type: "text_delta", text: block.text } });
        send("content_block_stop", { index });
      }
      send("message_delta", { delta: { stop_reason: turn < 3 ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } });
      send("message_stop", {}); res.end();
    });
    await new Promise<void>(done => provider.listen(0, "127.0.0.1", done));
    try {
      const baseURL = `http://127.0.0.1:${(provider.address() as { port: number }).port}`;
      const player = await preparePlayer({ root: join(root, "player"), token, server, key: "test-key", baseURL });
      const run = async (args: string[]) => {
        const output = await exec(process.execPath, [...player.args, ...args], {
          cwd: player.workspace, env: player.env, timeout: 40000, maxBuffer: 2_000_000,
        });
        const events = decisionEvents(); events.push(output.stdout);
        return events.finish();
      };
      const first = await run(["PLAY"]);
      expect(first.result?.status).toBe("succeeded");
      expect(first.result?.model).toMatchObject({ modelId: "MiniMax-M3.1-Flash" });
      expect(first.result?.usage).toMatchObject({ inputTokens: 300, outputTokens: 15, cacheReadTokens: 60 });
      expect(requests).toHaveLength(3);
      const second = await run(["--session", first.session, "NEXT OBSERVATION"]);
      expect(second.session).toBe(first.session);
      expect(second.result?.status).toBe("succeeded");
      expect(requests).toHaveLength(4);
      expect(JSON.stringify(requests[3].messages)).toContain("Decision one remembered.");
      for (const req of requests) {
        expect(req.model).toBe("MiniMax-M3.1-Flash");
        expect(req.thinking).toEqual({ type: "adaptive" });
        expect(req.output_config).toEqual({ effort: "low" });
        // These four internal tools remain in the official CLI even with
        // tools: [], skills: [] and delegation disabled. No shell/file/web tools.
        expect(req.tools.map((t: any) => t.name).sort()).toEqual(
          [...["act", "chat", "guide", "history", "run", "script", "state"].map(t => `mcp__castellan__${t}`),
            "skill", "task_output", "task_query", "task_stop"].sort());
      }
      const view = (await game.inject({ url: "/state", headers: { authorization: `Bearer ${token}` } })).json();
      // The real server keeps ticking while the CLI resumes its session.
      // Training may already have completed by the time the second run exits.
      const queued = (view.mine.find((e: any) => e.kind === "castle").training ?? [])
        .filter((entry: any) => entry.kind === "worker").length;
      expect(view.mine.filter((e: any) => e.kind === "worker").length + queued).toBe(workersBeforeTraining + 1);
    } finally {
      provider.closeAllConnections(); await new Promise<void>(done => provider.close(() => done()));
      await game.close();
    }
  }, 90000);
});
