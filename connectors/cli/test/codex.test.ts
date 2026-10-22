import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { access } from "node:fs/promises";
import { AGENT_ACTIVITY_STATES } from "@castellan/shared";
// @ts-expect-error Plain Node launcher shared with external harnesses.
import { play } from "../../loop-keepers/codex/agent.mjs";

afterEach(() => vi.restoreAllMocks());
const thread = "00000000-0000-4000-8000-000000000001";

it("resumes the same isolated conversation after a no-order decision, supplies fresh observations and exits cleanly", async () => {
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const launches: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const states: string[] = [], activities: string[] = [];
  let tick = 0;
  const fetchImpl = async (url: string, init: { body?: string }) => {
    if (url.includes("/state?")) {
      states.push(url); tick++;
      return { ok: true, text: async () => `tick ${tick} · 0.1s/10s · ${tick < 3 ? "running" : "finished"} · you are p1\nYOU   p1: mineral 200` };
    }
    if (url.endsWith("/agent-status")) activities.push(JSON.parse(init.body!).state);
    return { ok: true, json: async () => ({ status: "running" }) };
  };
  const spawnImpl = (_bin: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => {
    launches.push({ args, env: opts.env });
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), kill: vi.fn() });
    setImmediate(() => {
      child.stdout.write(JSON.stringify({ type: "thread.started", thread_id: thread }) + "\n");
      child.stdout.write(JSON.stringify({ type: "turn.completed" }) + "\n");
      child.emit("close", 0);
    });
    return child;
  };
  const result = await play({ env: { CASTELLAN_TOKEN: "test", CASTELLAN_SERVER: "http://game", CASTELLAN_CONNECTOR_VERSION: "test" },
    args: ["-m", "gpt-6-luna", "-c", 'model_reasoning_effort="low"'], fetchImpl, spawnImpl, minIntervalMs: 0 });
  expect(result).toBe(0);
  expect(launches).toHaveLength(2);
  expect(launches[0].args).not.toContain("resume");
  expect(launches[1].args).toContain("resume");
  expect(launches[1].args).toContain(thread);
  expect(launches[1].args.at(-1)).toContain("tick 2");
  expect(launches[1].env.CODEX_HOME).toBe(launches[0].env.CODEX_HOME);
  expect(launches[1].args).toContain('model_reasoning_effort="low"');
  expect(launches[1].args).toContain("shell_tool");
  expect(launches[1].args).not.toContain("--ephemeral");
  expect(states.map(s => new URL(s).searchParams.get("since"))).toEqual(["0", "1", "2"]);
  expect(activities).toEqual(["deciding", "between_decisions", "deciding", "between_decisions", "stopped"]);
  expect(AGENT_ACTIVITY_STATES).toEqual(expect.arrayContaining(activities));
  await expect(access(launches[0].env.CODEX_HOME!)).rejects.toThrow();
});

it("cancels an in-flight inference when the match finishes", async () => {
  const killed = vi.fn();
  const fetchImpl = async (url: string) => ({ ok: true, text: async () => "tick 1 · 0.1s/10s · running · you are p1", json: async () => ({ status: url.endsWith("/status") ? "finished" : "running" }) });
  const spawnImpl = () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), kill: () => { killed(); setImmediate(() => child.emit("close", null)); } });
    return child;
  };
  expect(await play({ env: { CASTELLAN_TOKEN: "test", CASTELLAN_CONNECTOR_VERSION: "test" }, args: [], fetchImpl, spawnImpl, pollMs: 20 })).toBe(0);
  expect(killed).toHaveBeenCalled();
});

it("tells a relaunched player that its earlier conversation is gone", async () => {
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const prompts: string[] = [];
  const fetchImpl = async (url: string) => url.includes("/state?")
    ? { ok: true, text: async () => `tick 1 · 0.1s/10s · ${prompts.length ? "finished" : "running"} · you are p1\nYOU   p1: mineral 200` }
    : { ok: true, json: async () => ({ status: "running" }) };
  const spawnImpl = (_bin: string, args: string[]) => {
    prompts.push(args.at(-1)!);
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), kill: vi.fn() });
    setImmediate(() => {
      child.stdout.write(JSON.stringify({ type: "thread.started", thread_id: thread }) + "\n");
      child.stdout.write(JSON.stringify({ type: "turn.completed" }) + "\n");
      child.emit("close", 0);
    });
    return child;
  };
  expect(await play({ env: { CASTELLAN_TOKEN: "test", CASTELLAN_SERVER: "http://game", CASTELLAN_CONNECTOR_VERSION: "test", CASTELLAN_RESUME: "1" },
    args: [], fetchImpl, spawnImpl, minIntervalMs: 0 })).toBe(0);
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("Your connector restarted; your earlier conversation is gone.");
});
