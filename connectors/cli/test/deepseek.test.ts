import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { buildServer } from "@aoa/server";
import { v0 } from "@aoa/shared";
// @ts-expect-error Plain Node launcher shared with external harnesses.
import { options, preparePlayer, usage } from "../../loop-keepers/deepseek/agent.mjs";
// @ts-expect-error Plain Node runtime configuration.
import { cli } from "../../loop-keepers/deepseek/runtime.mjs";
// @ts-expect-error Plain Node credential helper.
import { loadKey, saveKey } from "../../loop-keepers/deepseek/key.mjs";

const exec = promisify(execFile);
const dirs: string[] = [];
const available = existsSync(cli);
async function temp() { const p = await mkdtemp(join(tmpdir(), "aoa-dsh-test-")); dirs.push(p); return p; }
afterEach(async () => { await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });

describe("DeepSeek connector", () => {
  it("rejects profile/session/permission overrides and invalid effort", () => {
    expect(options([])).toMatchObject({ model: "deepseek-flash", effort: "low" });
    for (const args of [["--effort", "medium"], ["--profile", "web"], ["--session-id", "other"], ["--patch", "other"], ["--model", "x\ny"]]) expect(() => options(args)).toThrow();
  });

  it("fails before joining when either credential is missing", async () => {
    const keyPath = join(await temp(), "missing-key");
    const agent = new URL("../../loop-keepers/deepseek/agent.mjs", import.meta.url).pathname;
    await expect(exec(process.execPath, [agent], { env: { ...process.env, AOA_TOKEN: "", DEEPSEEK_API_KEY: "" } })).rejects.toMatchObject({ stderr: expect.stringContaining("set AOA_TOKEN") });
    await expect(exec(process.execPath, [agent], { env: { ...process.env, AOA_TOKEN: "game-only", DEEPSEEK_API_KEY: "", AOA_DEEPSEEK_KEY_FILE: keyPath } })).rejects.toMatchObject({ stderr: expect.stringContaining("set DEEPSEEK_API_KEY") });
  });

  it("loads a private local key across processes and rejects exposed files", async () => {
    const path = join(await temp(), "config", "key");
    const env = { AOA_DEEPSEEK_KEY_FILE: path };
    expect(await loadKey(env)).toBe("");
    await saveKey("fake-test-key", path);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await loadKey(env)).toBe("fake-test-key");
    expect(await loadKey({ ...env, DEEPSEEK_API_KEY: "env-key" })).toBe("env-key");
    await chmod(path, 0o644);
    await expect(loadKey(env)).rejects.toThrow("must be private");
    await expect(saveKey("bad\nkey", path)).rejects.toThrow();
  });

  it.skipIf(!available)("isolates player profiles and keeps the API key out of files", async () => {
    const root = await temp();
    const a = await preparePlayer({ root: join(root, "one"), token: "p1-token", key: "secret-test", env: { PATH: process.env.PATH, OPENAI_API_KEY: "other-secret", DSH_HOME: "/wrong", NODE_OPTIONS: "--require other" } });
    const b = await preparePlayer({ root: join(root, "two"), token: "p2-token", key: "secret-test" });
    expect(a.home).not.toBe(b.home);
    expect(a.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(a.env).not.toHaveProperty("NODE_OPTIONS");
    expect(a.env.DSH_HOME).toBe(a.home);
    const patch = await readFile(a.patchPath, "utf8");
    expect(patch).not.toContain("secret-test");
    expect(patch).not.toContain("p2-token");
    expect(JSON.parse(patch)).toContainEqual({ id: "tool-fs", disabled: true });
    expect(JSON.parse(patch)).toContainEqual({ id: "tool-bash", disabled: true });
    expect(JSON.parse(patch)).toContainEqual({ id: "agent-instructions", disabled: true });
  });

  it.skipIf(!available).each(["low", "off"])("boots the real harness with effort %s and plays through MCP against a local model fixture", async (effort) => {
    const root = await temp();
    const game = await buildServer({ replayDir: join(root, "replays"), prepMs: 0, tickRate: 20, ruleset: { ...v0, matchMs: 2000 } });
    await game.listen({ port: 0, host: "127.0.0.1" });
    const server = `http://127.0.0.1:${(game.server.address() as { port: number }).port}`;
    const room = (await game.inject({ method: "POST", url: "/rooms", payload: { players: [{ name: "DeepSeek fixture" }, { bot: "eco" }] } })).json();
    const token = room.players[0].token;
    const requests: any[] = [];
    const provider = createServer(async (req, res) => {
      let raw = ""; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); requests.push(body);
      const turn = requests.length;
      let content: any[];
      if (turn === 1) content = ["rules", "state"].map((name, i) => ({ type: "tool_use", id: `t${turn}-${i}`, name: `mcp__aoa__${name}`, input: {} }));
      else if (turn === 2) {
        const view = (await game.inject({ url: "/state", headers: { authorization: `Bearer ${token}` } })).json();
        content = [
          { type: "tool_use", id: "act-1", name: "mcp__aoa__act", input: { orders: [{ type: "train", building: view.mine.find((e: any) => e.kind === "nexus").id, kind: "worker" }] } },
          { type: "tool_use", id: "history-1", name: "mcp__aoa__history", input: {} },
        ];
      } else if (turn === 3) content = [{ type: "tool_use", id: "wait-1", name: "mcp__aoa__wait", input: { max_s: 3, until: "match_end" } }];
      else content = [{ type: "text", text: "Finished." }];
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (type: string, data: any) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      send("message_start", { message: { id: `msg${turn}`, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, usage: { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 20 } } });
      for (const [index, block] of content.entries()) {
        send("content_block_start", { index, content_block: block.type === "tool_use" ? { ...block, input: {} } : { ...block, text: "" } });
        send("content_block_delta", { index, delta: block.type === "tool_use" ? { type: "input_json_delta", partial_json: JSON.stringify(block.input) } : { type: "text_delta", text: block.text } });
        send("content_block_stop", { index });
      }
      send("message_delta", { delta: { stop_reason: turn < 4 ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } });
      send("message_stop", {}); res.end();
    });
    await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
    try {
      const baseURL = `http://127.0.0.1:${(provider.address() as { port: number }).port}`;
      const player = await preparePlayer({ root: join(root, "player"), token, server, key: "test-key", baseURL, effort });
      const result = await exec(process.execPath, [...player.args, "--json", "Play using AoA tools until finished."], { cwd: player.workspace, env: player.env, timeout: 25000, maxBuffer: 2_000_000 });
      expect(result.stdout).toContain('"type":"final"');
      expect(requests.length).toBe(4);
      for (const req of requests) {
        expect(req.model).toBe("deepseek-flash");
        if (effort === "off") expect(req.thinking).toEqual({ type: "disabled" });
        else expect(req.output_config.effort).toBe("low");
        expect(req.tools.map((t: any) => t.name).sort()).toEqual(["act", "chat", "history", "rules", "script", "state", "wait"].map((t) => `mcp__aoa__${t}`));
      }
      const final = (await game.inject({ url: "/state", headers: { authorization: `Bearer ${token}` } })).json();
      expect(final.status).toBe("finished");
      expect(final.mine.filter((e: any) => e.kind === "worker")).toHaveLength(4);
      expect(await usage(player.root)).toMatchObject({ calls: 4, inputTokens: 400, outputTokens: 20, cacheReadTokens: 80 });
    } finally {
      provider.closeAllConnections(); await new Promise<void>((resolve) => provider.close(() => resolve()));
      await game.close();
    }
  }, 30000);
});
