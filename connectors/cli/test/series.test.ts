import { expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "@aoa/server";
import { rules } from "@aoa/shared";
import { client, runSeries } from "../src/index";

it("runs three fresh agent processes with game-scoped credentials and API history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aoa-series-runner-"));
  const app = await buildServer({ replayDir: dir, ruleset: { ...rules, matchMs: 400 }, prepMs: 0, tickRate: 20 });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address() as { port: number };
  const server = `http://127.0.0.1:${address.port}`;
  const fixture = join(dir, "agent.mjs"), output = join(dir, "calls.jsonl");
  await writeFile(fixture, `
    import { appendFileSync } from "node:fs";
    const get = async (path) => (await fetch(process.env.AOA_SERVER + path, {headers:{authorization:"Bearer " + process.env.AOA_TOKEN}})).json();
    const initial = await get("/state");
    const history = await get("/history");
    appendFileSync(process.env.TEST_OUTPUT, JSON.stringify({token:process.env.AOA_TOKEN,resume:process.env.AOA_RESUME,number:initial.series.gameNumber,previous:history.games.length,args:process.argv.slice(2)}) + "\\n");
    while ((await get("/state")).status !== "finished") await new Promise(r => setTimeout(r, 30));
  `);
  try {
    const created = await client({ server }).post<{ players: { token?: string }[] }>("/series", { players: [{ name: "fixture" }, { bot: "rush" }] });
    const token = created.players[0].token!;
    expect(await runSeries(client({ server, token }), [process.execPath, fixture, "--model", "fixture", "--effort", "low"], {
      env: { ...process.env, AOA_TOKEN: token, AOA_RESUME: "1", TEST_OUTPUT: output }, backoffMs: 20, log: () => {},
    })).toBe(0);
    const calls = (await readFile(output, "utf8")).trim().split("\n").map((s) => JSON.parse(s));
    expect(calls.map((c) => [c.number, c.previous])).toEqual([[1, 0], [2, 1], [3, 2]]);
    expect(new Set(calls.map((c) => c.token)).size).toBe(3);
    for (const call of calls) {
      expect(call.token).not.toBe(token);
      expect(call.resume).toBeUndefined();
      expect(call.args).toEqual(["--model", "fixture", "--effort", "low"]);
    }
  } finally { await app.close(); }
});
