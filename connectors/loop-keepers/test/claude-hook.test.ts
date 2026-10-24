import { expect, it } from "vitest";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exec = promisify(execFile);
const observation = (status: string) => `tick 1 · 0.1s/600.0s · ${status} · you are p1\nYOU   p1: mineral 200`;

// Run the real executable boundary against HTTP fixtures; never invoke a paid CLI.
async function hook(responses: (string | number)[], launcher = false) {
  const root = await mkdtemp(join(tmpdir(), "castellan-hook-test-"));
  const activity: string[] = [];
  let reads = 0;
  const server = createServer(async (req, res) => {
    if (req.url?.startsWith("/state?")) {
      const answer = responses[Math.min(reads++, responses.length - 1)];
      res.writeHead(typeof answer === "number" ? answer : 200, { "content-type": typeof answer === "number" ? "application/json" : "text/plain" });
      res.end(typeof answer === "number" ? JSON.stringify({ error: "private fixture detail" }) : observation(answer));
    } else {
      let body = ""; for await (const chunk of req) body += chunk;
      if (req.url === "/agent-status") activity.push(JSON.parse(body).state);
      res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true}');
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    if (launcher) await writeFile(join(root, "claude"), `#!${process.execPath}
const fs = require('node:fs'), {spawnSync} = require('node:child_process');
const args = process.argv.slice(2);
if (args.includes('--version')) console.log('test-cli 1.2.3');
else {
  const settings = JSON.parse(fs.readFileSync(args[args.indexOf('--settings') + 1], 'utf8'));
  spawnSync('sh', ['-c', settings.hooks.Stop[0].hooks[0].command], {stdio:'inherit'});
  process.exit(0); // Claude can report success even when its Stop hook failed.
}
`, { mode: 0o700 });
    const path = new URL(launcher ? "../claude-code/play.sh" : "../claude-code/stop-hook.mjs", import.meta.url).pathname;
    const output = await exec(launcher ? "sh" : process.execPath, [path], { cwd: root, timeout: 15000,
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, CASTELLAN_TOKEN: "fixture-token",
        CASTELLAN_SERVER: `http://127.0.0.1:${(server.address() as { port: number }).port}`, CASTELLAN_OPEN: "" },
    }).then(result => ({ ...result, code: 0 }), error => ({ stdout: error.stdout as string, stderr: error.stderr as string, code: error.code as number }));
    return { ...output, reads, activity, failed: await readFile(join(root, ".castellan-hook-failed"), "utf8").then(() => true, () => false) };
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}

it("continues the same conversation after one observation failure, without exposing error details", async () => {
  const result = await hook(["prep", 503, "running"]);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ decision: "block", reason: observation("running") });
  expect(result.reads).toBe(3);
  expect(result.activity).toEqual(["connector_retry"]);
  expect(result.failed).toBe(false);
  expect(result.stderr).toContain("HTTP 503");
  expect(result.stderr).not.toMatch(/private fixture detail|fixture-token/);
});

it.each([401, 403, 503])("records a terminal HTTP %i failure instead of silently allowing a successful exit", async status => {
  const result = await hook([status]);
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.failed).toBe(true);
  expect(result.reads).toBe(status === 503 ? 3 : 1);
  expect(result.activity.at(-1)).toBe("stopped");
});

it("lets a finished seat end normally", async () => {
  const result = await hook(["finished"]);
  expect(result).toMatchObject({ code: 0, stdout: "", stderr: "", failed: false, reads: 1 });
});

it("propagates a failed hook even when the Claude process exits zero", async () => {
  const result = await hook(["running", 401], true);
  expect(result.code).toBe(1);
  expect(result.activity.at(-1)).toBe("stopped");
  expect(result.stderr).toContain("Stop hook failed");
});
