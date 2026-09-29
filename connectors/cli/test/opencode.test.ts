import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
// @ts-expect-error Plain Node launcher shared with external harnesses.
import { DEFAULT_MODEL, loadKey, options, preparePlayer, usage, watchFinish } from "../../loop-keepers/opencode/agent.mjs";

const exec = promisify(execFile);
const dirs: string[] = [];
async function temp() { const p = await mkdtemp(join(tmpdir(), "aoa-opencode-test-")); dirs.push(p); return p; }
afterEach(async () => { await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });

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

  it("stops the agent after the match finishes, not before", async () => {
    const statuses = ["running", "finished"];
    const seen: string[] = [];
    let finished = 0;
    const fetchImpl = async (url: string, init: { headers: Record<string, string> }) => {
      seen.push(`${url} ${init.headers.authorization}`);
      return { ok: true, json: async () => ({ status: statuses.shift() ?? "finished" }) };
    };
    const w = watchFinish({ server: "http://s", token: "t", onFinished: () => finished++, everyMs: 5, graceMs: 5, fetchImpl });
    await new Promise((r) => setTimeout(r, 60));
    w.stop();
    expect(finished).toBe(1);
    expect(seen).toEqual(["http://s/status Bearer t", "http://s/status Bearer t"]);
  });
});
