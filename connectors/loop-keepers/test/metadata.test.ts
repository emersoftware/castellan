import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error The reporter is a build-free executable Node module.
import { launchConfiguration, reportConfiguration } from "../metadata.mjs";
// @ts-expect-error Plain Node launcher.
import { efforts as cursorEfforts } from "../cursor/agent.mjs";
// @ts-expect-error Plain Node launcher.
import { efforts as agyEfforts } from "../antigravity/preflight.mjs";
// @ts-expect-error Plain Node launcher.
import { efforts as dshEfforts } from "../deepseek/agent.mjs";
import { EFFORTS } from "../../../packages/shared/src/replayMetadata";

const exec = promisify(execFile);
const dirs: string[] = [], servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise<void>(r => s.close(() => r()))));
  await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true })));
});

it("accepts only efforts the replay catalogue knows", () => {
  for (const efforts of [cursorEfforts, agyEfforts, dshEfforts]) expect(EFFORTS).toEqual(expect.arrayContaining(efforts));
});

it("records known CLI choices, leaves defaults unknown and never copies prompt or credentials", () => {
  const env = { AOA_TOKEN: "seat-secret", OPENAI_API_KEY: "provider-secret", AOA_MODEL: "fallback" };
  const cfg = launchConfiguration({ connector: "codex", args: ["-m", "chosen", "-c", 'model_reasoning_effort="high"'],
    prompt: "task with experiment directive", env });
  expect(cfg).toMatchObject({ model: "chosen", effort: "high", connector: "codex", connectorVersion: null });
  expect(cfg.promptSha256).toBe(createHash("sha256").update("task with experiment directive").digest("hex"));
  expect(JSON.stringify(cfg)).not.toMatch(/seat-secret|provider-secret|task with experiment directive/);
  expect(launchConfiguration({ connector: "codex", args: [], env: {} })).toMatchObject({ model: null, effort: null, promptSha256: null });
  expect(launchConfiguration({ connector: "codex", args: ["--config=model=\"configured\"", "-cmodel_reasoning_effort='low'"], env: {} }))
    .toMatchObject({ model: "configured", effort: "low" });
  expect(launchConfiguration({ connector: "claude-code", args: ["--model=sonnet", "--effort", "low"], env: {} }))
    .toMatchObject({ model: "sonnet", effort: "low" });
});

it("reports metadata failure without leaking request/error details or blocking play", async () => {
  const warnings: string[] = [];
  const ok = await reportConfiguration({ model: null }, {
    env: { AOA_TOKEN: "secret" }, warn: (s: string) => warnings.push(s),
    fetchImpl: async () => { throw new Error("https://secret.example secret"); },
  });
  expect(ok).toBe(false);
  expect(warnings).toEqual(["aoa: experiment configuration was not recorded (server unavailable)."]);
});

for (const connector of ["codex", "claude-code"] as const) {
  it(`${connector}: real launch path registers the instruction prompt before reading the match`, async () => {
    const root = await mkdtemp(join(tmpdir(), "aoa-metadata-test-")); dirs.push(root);
    await mkdir(join(root, "auth"));
    await writeFile(join(root, "auth", "auth.json"), "{}");
    const capture = join(root, "launch.json"), bin = connector === "codex" ? "codex" : "claude";
    await writeFile(join(root, bin), `#!${process.execPath}\nconst fs=require('node:fs'); const args=process.argv.slice(2); if(args.includes('--version')) console.log('test-cli 1.2.3'); else {fs.writeFileSync(process.env.AOA_TEST_CAPTURE,JSON.stringify(args));console.log(JSON.stringify({type:'thread.started',thread_id:'00000000-0000-4000-8000-000000000001'}));console.log(JSON.stringify({type:'turn.completed'}));}\n`, { mode: 0o700 });
    const requests: { path?: string; authorization?: string; body: string }[] = [];
    let stateCalls = 0;
    const observation = "tick 1 · 0.1s/10s · running · you are p1";
    const server = createServer(async (req, res) => {
      let body = ""; for await (const part of req) body += part;
      requests.push({ path: req.url, authorization: req.headers.authorization, body });
      if (req.url?.startsWith("/state?")) {
        stateCalls++; res.writeHead(200, { "content-type": "text/plain" });
        res.end(stateCalls === 1 ? observation : "tick 2 · 0.2s/10s · finished · you are p1");
      } else { res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true,"status":"running"}'); }
    });
    servers.push(server);
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const script = new URL(connector === "codex" ? "../codex/agent.sh" : "../claude-code/play.sh", import.meta.url).pathname;
    const args = connector === "codex" ? ["-m", "declared-model", "-c", 'model_reasoning_effort="high"'] : ["--model", "declared-model", "--effort", "high"];
    await exec("sh", [script, ...args], { env: { ...process.env,
      PATH: `${root}:${process.env.PATH}`, CODEX_HOME: join(root, "auth"), AOA_TEST_CAPTURE: capture,
      AOA_TOKEN: "seat-secret", AOA_SERVER: `http://127.0.0.1:${port}`, AOA_DIRECTIVE: "Protect the eastern mine.", AOA_RESUME: "1",
      AOA_CONNECTOR_VERSION: "", AOA_MODEL: "", AOA_EFFORT: "",
    } });
    const launched: string[] = JSON.parse(await readFile(capture, "utf8"));
    const prompt = connector === "codex" ? launched.at(-1)!.split(`\n\n${observation}`)[0] : launched[launched.indexOf("-p") + 1];
    expect(prompt).toContain("Protect the eastern mine.");
    if (connector === "codex") expect(stateCalls).toBe(2);
    else expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ path: "/agent-config", authorization: "Bearer seat-secret" });
    expect(JSON.parse(requests[0].body)).toMatchObject({ connector, model: "declared-model", effort: "high", connectorVersion: "1.2.3",
      promptSha256: createHash("sha256").update(prompt).digest("hex") });
    expect(requests[0].body).not.toMatch(/seat-secret|Protect the eastern mine/);
  });
}
