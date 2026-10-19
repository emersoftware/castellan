import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { AGENT_ACTIVITY_STATES } from "@aoa/shared";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
// @ts-expect-error Plain Node launcher shared with external harnesses.
import { DEFAULT_MODEL, loadKey, options, play, preparePlayer, providerRetryAfter, usage } from "../../loop-keepers/opencode/agent.mjs";

const exec = promisify(execFile);
const dirs: string[] = [];
async function temp() { const p = await mkdtemp(join(tmpdir(), "aoa-opencode-test-")); dirs.push(p); return p; }
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });

describe("OpenCode connector", () => {
  it("accepts provider/model and variant, rejects anything else", () => {
    expect(options([])).toMatchObject({ model: DEFAULT_MODEL });
    expect(options(["--model", "openrouter/moonshotai/kimi-k3", "--variant", "high"])).toMatchObject({ model: "openrouter/moonshotai/kimi-k3", variant: "high" });
    for (const args of [["--model", "no-provider"], ["--model", "a/b c"], ["--variant", "x y"], ["--auto"], ["--session", "other"]]) expect(() => options(args)).toThrow();
  });

  it("fails before joining when either credential is missing", async () => {
    const agent = new URL("../../loop-keepers/opencode/agent.mjs", import.meta.url).pathname;
    const empty = await temp();
    await expect(exec(process.execPath, [agent], { env: { ...process.env, AOA_TOKEN: "" } })).rejects.toMatchObject({ stderr: expect.stringContaining("set AOA_TOKEN") });
    const env = { ...process.env, AOA_TOKEN: "game-only", OPENROUTER_API_KEY: "", AOA_OPENROUTER_KEY_FILE: join(empty, "none"), XDG_DATA_HOME: empty };
    await expect(exec(process.execPath, [agent], { env })).rejects.toMatchObject({ stderr: expect.stringContaining("set OPENROUTER_API_KEY") });
  });

  it("loads the key from env, a private file, or OpenCode's auth store", async () => {
    const dir = await temp();
    const file = join(dir, "key"), data = join(dir, "data");
    const base = { AOA_OPENROUTER_KEY_FILE: file, XDG_DATA_HOME: data };
    expect(await loadKey(base)).toBe("");
    await mkdir(join(data, "opencode"), { recursive: true });
    await writeFile(join(data, "opencode", "auth.json"), JSON.stringify({ openrouter: { type: "api", key: "from-opencode" } }));
    expect(await loadKey(base)).toBe("from-opencode");
    await writeFile(file, "from-file\n", { mode: 0o600 });
    expect(await loadKey(base)).toBe("from-file");
    expect(await loadKey({ ...base, OPENROUTER_API_KEY: "from-env" })).toBe("from-env");
    await chmod(file, 0o644);
    await expect(loadKey(base)).rejects.toThrow("must be private");
  });

  it("isolates each player and exposes only the aoa MCP tools", async () => {
    const root = await temp();
    const a = await preparePlayer({ root: join(root, "one"), token: "p1-token", key: "secret-test", model: "openrouter/x/y", variant: "high",
      env: { PATH: process.env.PATH, OPENAI_API_KEY: "other-secret", OPENCODE_CONFIG_DIR: "/wrong", NODE_OPTIONS: "--require other" } });
    const b = await preparePlayer({ root: join(root, "two"), token: "p2-token", key: "secret-test" });
    expect(a.home).not.toBe(b.home);
    expect(a.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(a.env).not.toHaveProperty("OPENCODE_CONFIG_DIR");
    expect(a.env).not.toHaveProperty("NODE_OPTIONS");
    expect(a.env).toMatchObject({ HOME: a.home, OPENCODE_CONFIG: a.configPath, OPENCODE_PURE: "1", OPENCODE_DISABLE_CLAUDE_CODE: "1", OPENROUTER_API_KEY: "secret-test" });
    expect(a.args).toEqual(["run", "--format", "json", "--model", "openrouter/x/y", "--variant", "high"]);
    const text = await readFile(a.configPath, "utf8");
    expect(text).not.toContain("secret-test");
    expect(text).not.toContain("p2-token");
    const config = JSON.parse(text);
    expect(config.mcp.aoa.environment).toEqual({ AOA_SERVER: "http://localhost:4400", AOA_TOKEN: "p1-token" });
    expect(config.tools).toEqual({ "*": false, "aoa_*": true });
    expect(config.permission).toEqual({ "*": "deny", "aoa_*": "allow" });
    expect(config.enabled_providers).toEqual(["openrouter"]);
    expect(config).not.toHaveProperty("provider");
    const off = await preparePlayer({ root: join(root, "three"), token: "p3-token", key: "k", model: "openrouter/xiaomi/mimo-v2.6-pro", variant: "none" });
    expect(JSON.parse(await readFile(off.configPath, "utf8")).provider).toEqual({ openrouter: { models: { "xiaomi/mimo-v2.6-pro": { variants: { none: { reasoning: { effort: "none" } } } } } } });
  });

  it("sums tokens and cost from step-finish events", () => {
    const step = (input: number, output: number, read: number, cost: number) => JSON.stringify({ type: "step_finish", part: { type: "step-finish", tokens: { input, output, reasoning: 1, cache: { read, write: 0 } }, cost } });
    expect(usage([step(10, 2, 100, 0.5), "not json", JSON.stringify({ type: "text", part: { type: "text" } }), step(5, 1, 50, 0.25)]))
      .toEqual({ steps: 2, input: 15, output: 3, reasoning: 2, cacheRead: 150, cacheWrite: 0, cost: 0.75 });
  });

  const providerError = (status = 402, reason = "in_flight_budget_exhausted", retryAfter = "120") => JSON.stringify({
    type: "error", error: { name: "APIError", data: { statusCode: status, isRetryable: false,
      responseHeaders: { "retry-after": retryAfter }, responseBody: JSON.stringify({ error: { metadata: { reason } } }) } },
  });

  it("honors the temporary budget cooldown despite OpenCode marking the 402 non-retryable", () => {
    expect(providerRetryAfter(["partial json", providerError(), ""])).toEqual({ delayMs: 120_000, reason: "in_flight_budget_exhausted" });
    expect(providerRetryAfter([providerError(429, "rate_limit", "30")])).toEqual({ delayMs: 30_000, reason: "rate_limited" });
    const now = Date.parse("2026-10-08T05:37:56Z");
    expect(providerRetryAfter([providerError(429, "rate_limit", "Thu, 08 Oct 2026 05:39:56 GMT")], now)?.delayMs).toBe(120_000);
    expect(providerRetryAfter([providerError(402, "insufficient_credits")])).toBeNull();
    expect(providerRetryAfter([providerError(401, "unauthorized")])).toBeNull();
    expect(providerRetryAfter([providerError(), providerError(402, "insufficient_credits")])).toBeNull();
    for (const bad of ["", "0", "-1", "not a date"]) expect(providerRetryAfter([providerError(402, "in_flight_budget_exhausted", bad)])).toBeNull();
  });

  // A fake game: text observations whose tick advances per request, finished after `lastTick`.
  function game(lastTick: number, status = () => "running") {
    const states: string[] = [], activities: string[] = [];
    let tick = 0;
    const fetchImpl = async (url: string, init: { body?: string }) => {
      if (url.includes("/state?")) {
        states.push(new URL(url).searchParams.get("since")!); tick++;
        return { ok: true, text: async () => `tick ${tick} · 0.1s/10s · ${tick <= lastTick ? "running" : "finished"} · you are p1\nYOU   p1: mineral 200` };
      }
      if (url.endsWith("/agent-status")) activities.push(JSON.parse(init.body!).state);
      return { ok: true, json: async () => ({ status: status() }) };
    };
    return { states, activities, fetchImpl };
  }
  function fakeOpencode(turns: ((child: EventEmitter & { stdout: PassThrough }) => void)[]) {
    const launches: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
    const spawnImpl = (_bin: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => {
      launches.push({ args, env: opts.env });
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), kill: vi.fn(() => setImmediate(() => child.emit("close", null))) });
      setImmediate(() => turns.shift()!(child));
      return child;
    };
    return { launches, spawnImpl };
  }
  const session = "ses_test0001";
  const decided = (child: EventEmitter & { stdout: PassThrough }) => {
    child.stdout.write(JSON.stringify({ type: "step_finish", sessionID: session, part: { type: "step-finish", tokens: { input: 10, output: 2 }, cost: 0.01 } }) + "\n");
    child.emit("close", 0);
  };
  const env = (home: string) => {
    vi.stubEnv("HOME", home);
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    return { AOA_TOKEN: "test", AOA_SERVER: "http://game", AOA_CONNECTOR_VERSION: "test", OPENROUTER_API_KEY: "k", PATH: process.env.PATH };
  };

  it("continues the same isolated session with fresh observations and exits cleanly", async () => {
    const home = await temp();
    const { states, activities, fetchImpl } = game(2);
    const { launches, spawnImpl } = fakeOpencode([decided, decided]);
    expect(await play({ env: env(home), args: ["--model", "openrouter/z-ai/glm-5.3"], fetchImpl, spawnImpl, minIntervalMs: 0 })).toBe(0);
    expect(launches).toHaveLength(2);
    expect(launches[0].args).not.toContain("--session");
    expect(launches[0].args.at(-1)).toMatch(/^PLAY\n\ntick 1/);
    expect(launches[1].args).toEqual(expect.arrayContaining(["--session", session, "--model", "openrouter/z-ai/glm-5.3"]));
    expect(launches[1].args.at(-1)).toMatch(/^tick 2/);
    expect(launches[1].env.HOME).toBe(launches[0].env.HOME);
    expect(states).toEqual(["0", "1", "2"]);
    expect(activities).toEqual(["deciding", "between_decisions", "deciding", "between_decisions", "stopped"]);
    expect(AGENT_ACTIVITY_STATES).toEqual(expect.arrayContaining(activities));
    const [run] = await readdir(join(home, ".local", "state", "aoa", "opencode"));
    expect(JSON.parse(await readFile(join(home, ".local", "state", "aoa", "opencode", run, "usage.json"), "utf8"))).toMatchObject({ steps: 2, input: 20, cost: 0.02 });
  });

  it("waits out a provider cooldown, then decides again without losing the observation cursor", async () => {
    const home = await temp();
    const { states, activities, fetchImpl } = game(3);
    const cooled = (child: EventEmitter & { stdout: PassThrough }) => { child.stdout.write(providerError(402, "in_flight_budget_exhausted", "0.05") + "\n"); child.emit("close", 1); };
    const { launches, spawnImpl } = fakeOpencode([cooled, decided, decided]);
    expect(await play({ env: env(home), args: [], fetchImpl, spawnImpl, minIntervalMs: 0 })).toBe(0);
    expect(launches).toHaveLength(3);
    expect(launches[1].args).not.toContain("--session");
    expect(launches[2].args).toContain(session);
    expect(activities.slice(0, 2)).toEqual(["deciding", "provider_wait"]);
    expect(AGENT_ACTIVITY_STATES).toEqual(expect.arrayContaining(activities));
    expect(states.slice(0, 3)).toEqual(["0", "0", "2"]);
  });

  it("cancels an in-flight inference when the match finishes", async () => {
    const home = await temp();
    const { fetchImpl } = game(99, () => "finished");
    const { launches, spawnImpl } = fakeOpencode([() => {}]);
    expect(await play({ env: env(home), args: [], fetchImpl, spawnImpl, pollMs: 20 })).toBe(0);
    expect(launches).toHaveLength(1);
  });
});
