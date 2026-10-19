import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_ACTIVITY_STATES } from "@aoa/shared";
// @ts-expect-error Build-free external CLI connector.
import { connectTools, cursorArgs, failureKind, options, play, preparePlayer } from "../../loop-keepers/cursor/agent.mjs";

const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
const session = "00000000-0000-4000-8000-000000000001";
const init = (id = session) => ({ type: "system", subtype: "init", session_id: id });
const result = (id = session) => ({ type: "result", subtype: "success", is_error: false, session_id: id });

function harness(turns: { events?: object[]; stderr?: string; code?: number; hang?: boolean; exitOnly?: boolean; chunks?: boolean; streamForMs?: number }[], lastTick = 2, status = () => "running") {
  const launches: { args: string[]; env: NodeJS.ProcessEnv; cwd: string }[] = [];
  const states: string[] = [], paths: string[] = [], messages: string[] = [], activities: string[] = [];
  const kills = vi.fn();
  let tick = 0;
  const fetchImpl = async (url: string, init?: { body?: string }) => {
    paths.push(new URL(url).pathname);
    if (url.endsWith("/agent-status")) activities.push(JSON.parse(init!.body!).state);
    if (url.includes("/state?")) {
      states.push(new URL(url).searchParams.get("since")!); tick++;
      return { ok: true, text: async () => `tick ${tick} · 0.1s/10s · ${tick <= lastTick ? "running" : "finished"} · you are p1` };
    }
    return { ok: true, json: async () => ({ status: status() }) };
  };
  const spawnImpl = (_bin: string, args: string[], opts: { env: NodeJS.ProcessEnv; cwd: string }) => {
    launches.push({ args, ...opts });
    const turn = turns.shift();
    if (!turn) throw new Error("Unexpected launch");
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(),
      kill: (signal: string) => { kills(signal); setImmediate(() => child.emit("close", null)); } });
    setImmediate(() => {
      if (turn.streamForMs) {
        child.stdout.write(JSON.stringify(init()) + "\n");
        const streaming = setInterval(() => child.stdout.write(JSON.stringify({ type: "thinking", subtype: "delta", text: "working" }) + "\n"), 10);
        setTimeout(() => {
          clearInterval(streaming);
          child.stdout.write(JSON.stringify(result()) + "\n");
          child.emit("close", 0);
        }, turn.streamForMs);
        return;
      }
      const text = (turn.events ?? [init(), result()]).map(e => JSON.stringify(e)).join("\n");
      if (turn.chunks) { child.stdout.write(text.slice(0, 25)); child.stdout.write(text.slice(25)); }
      else child.stdout.write(text);
      if (turn.stderr) child.stderr.write(turn.stderr);
      if (turn.exitOnly) child.emit("exit", turn.code ?? 0);
      else if (!turn.hang) child.emit("close", turn.code ?? 0);
    });
    return child;
  };
  return { launches, states, paths, messages, kills, activities, params: {
    env: { AOA_TOKEN: "seat-secret", AOA_SERVER: "http://game", AOA_CONNECTOR_VERSION: "2026.10.12-test" }, args: [],
    credentialImpl: async () => ({ CURSOR_AUTH_TOKEN: "login-secret" }), fetchImpl, spawnImpl,
    output: (s: string) => messages.push(s), warn: (s: string) => messages.push(s), minIntervalMs: 0, retryMs: 1,
  } };
}

describe("Cursor player", () => {
  it("finishes a turn when the CLI exits but a helper keeps its pipes open", async () => {
    const h = harness([{}, { exitOnly: true }, {}], 2);
    expect(await play({ ...h.params, exitGraceMs: 10 })).toBe(0);
    expect(h.launches).toHaveLength(3);
  });

  it("keeps the explicitly requested model/effort and rejects ambiguous or unsafe flags", () => {
    expect(options([])).toEqual({ model: "grok-4.7-low", effort: "low" });
    expect(options(["--effort", "medium"])).toEqual({ model: "grok-4.7-medium", effort: "medium" });
    expect(options(["--model", "grok-4.7-xhigh-fast"])).toEqual({ model: "grok-4.7-xhigh-fast", effort: "xhigh" });
    for (const args of [["--model", "auto"], ["--model", "grok-4.7-high", "--effort", "low"], ["--force"], ["--resume", session], ["--effort", "invalid"]]) expect(() => options(args)).toThrow();
    expect(cursorArgs({ model: "grok-4.7-low", session, prompt: "decision" })).toContain(session);
  });

  it("isolates config and history; the only configured MCP gets only its own seat", async () => {
    const root = await mkdtemp(join(tmpdir(), "cursor-test-")); dirs.push(root);
    const player = await preparePlayer({ root, credential: { CURSOR_AUTH_TOKEN: "login-secret" },
      env: { PATH: process.env.PATH, NODE_OPTIONS: "--require /bad", OPENAI_API_KEY: "unrelated", CURSOR_CONFIG_DIR: "/personal" } });
    expect(player.env.HOME).toBe(join(root, "home"));
    expect(player.env.CURSOR_CONFIG_DIR).toBe(join(root, "home/.cursor"));
    expect(player.env.AGENT_CLI_CREDENTIAL_STORE).toBe("memory");
    expect(player.env).not.toHaveProperty("NODE_OPTIONS");
    expect(player.env).not.toHaveProperty("OPENAI_API_KEY");
    await expect(access(join(player.workspace, ".cursor/mcp.json"))).rejects.toThrow();
    await connectTools(player, { token: "only-p1", server: "http://game" });
    const text = await readFile(join(player.workspace, ".cursor/mcp.json"), "utf8");
    expect(JSON.parse(text).mcpServers.aoa.env).toEqual({ AOA_TOKEN: "only-p1", AOA_SERVER: "http://game" });
    expect(text).not.toContain("login-secret");
    const cfg = JSON.parse(await readFile(join(player.env.CURSOR_CONFIG_DIR, "cli-config.json"), "utf8"));
    expect(cfg.permissions).toEqual({ allow: ["Mcp(aoa:*)"], deny: ["Shell(*)", "Read(**)", "Write(**)", "WebFetch(*)"] });
  });

  it("warms up before joining, starts a fresh match session and resumes after no-order decisions", async () => {
    const h = harness([{ events: [init("warmup"), result("warmup")] }, { chunks: true }, {}]);
    expect(await play(h.params)).toBe(0);
    expect(h.launches).toHaveLength(3);
    expect(h.launches[1].args).not.toContain("--resume");
    expect(h.launches[2].args).toContain(session);
    expect(h.launches[2].args.at(-1)).toContain("tick 2");
    expect(h.launches[1].args.at(-1)).toMatch(/^PLAY\n\ntick 1/);
    expect(h.launches[2].args.at(-1)).toMatch(/^tick 2/);
    expect(h.launches[2].env.HOME).toBe(h.launches[1].env.HOME);
    expect(h.states).toEqual(["0", "1", "2"]);
    expect(h.paths[0]).toBe("/agent-config");
    expect(h.activities).toContain("between_decisions");
    expect(AGENT_ACTIVITY_STATES).toEqual(expect.arrayContaining(h.activities));
    await expect(access(h.launches[0].cwd)).rejects.toThrow();
  });

  it("stops a denied plan before connecting the seat, redacting credentials", async () => {
    const h = harness([{ events: [init()], code: 1, stderr: "ActionRequiredError: Model unavailable on Plus login-secret seat-secret" }]);
    await expect(play(h.params)).rejects.toThrow("preflight failed; player has not joined");
    expect(h.paths).not.toContain("/state");
    expect(h.launches).toHaveLength(1);
    expect(h.messages.join("")).not.toMatch(/login-secret|seat-secret/);
    await expect(access(h.launches[0].cwd)).rejects.toThrow();
  });

  it("retains partial conversations and observation cursor after rate limits or truncated success output", async () => {
    const h = harness([{}, { events: [init()], code: 1, stderr: "429 Too Many Requests" }, { events: [init()] }, {}], 3);
    expect(await play(h.params)).toBe(0);
    expect(h.launches[2].args).toContain(session);
    expect(h.launches[3].args).toContain(session);
    expect(h.states).toEqual(["0", "0", "0", "3"]);
  });

  it("stops an in-flight decision when the player is eliminated", async () => {
    const h = harness([{}, { events: [init()], hang: true }], 10);
    const baseFetch = h.params.fetchImpl;
    const fetchImpl = async (url: string) => url.endsWith("/status") ? { ok: true, json: async () => ({ status: "running", alive: false }) } : baseFetch(url);
    expect(await play({ ...h.params, fetchImpl, pollMs: 25 })).toBe(0);
    expect(h.kills).toHaveBeenCalledWith("SIGTERM");
  });

  it("does not interrupt active reasoning when a turn exceeds the inactivity deadline", async () => {
    const h = harness([{}, { streamForMs: 160 }, {}]);
    expect(await play({ ...h.params, idleTimeoutMs: 60 })).toBe(0);
    expect(h.kills).not.toHaveBeenCalled();
    expect(h.launches).toHaveLength(3);
    expect(h.launches[2].args).toContain(session);
    expect(h.states).toEqual(["0", "1", "2"]);
  });

  it("times out silent calls and stops after bounded retries", async () => {
    const h = harness([{}, { events: [init()], hang: true }, { events: [init()], hang: true }], 10);
    await expect(play({ ...h.params, idleTimeoutMs: 20, maxFailures: 2 })).rejects.toThrow("No Cursor stream activity for 20ms");
    expect(h.kills).toHaveBeenCalledTimes(2);
    expect(h.states).toEqual(["0", "0"]);
  });

  it("distinguishes account errors from temporary provider failures", () => {
    for (const text of ["ActionRequiredError", "Authentication required", "usage limit", "quota exceeded", "Model unavailable on Plus"]) expect(failureKind(text)).toBe("access");
    expect(failureKind("429 Too Many Requests")).toBe("temporary");
  });
});
