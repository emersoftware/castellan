import { afterEach, beforeAll, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createMatch } from "../../packages/engine/src/index";
import { rules } from "../../packages/shared/src/rules";
import type { ReplayFile } from "../../packages/shared/src/protocol";
import { applyLanding, prepareLanding, verifyLandingBuild } from "../landing-release";
import { collectPublication } from "../catalog";

const selection = { hero: "hero", duel: "duel", teams: "teams" };
const fixtures = new Map<string, ReplayFile>();
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
beforeAll(async () => {
  for (const slot of Object.keys(selection)) {
    const players = Array.from({ length: slot === "duel" ? 2 : 4 }, (_, i) => ({
      id: `p${i}`, name: `Agent ${i}`, side: i, team: slot === "teams" ? i % 2 : i,
    }));
    const match = await createMatch({ ruleset: { ...rules, matchMs: 200 }, players, seed: 42, tickRate: 10 });
    try {
      while (!match.outcome) match.step([]);
      const replay: ReplayFile = {
        format: 1, id: slot, createdAt: "2026-10-25T00:00:00.000Z", seed: 42, tickRate: 10,
        ruleset: { ...rules, matchMs: 200 }, players, orders: [], finalTick: match.tick,
        hashes: { [match.tick]: match.hash() }, outcome: match.outcome,
        timing: Object.fromEntries(players.map(p => [p.id, { calls: 1, decisions: 1, orders: 1, thinkMs: 0, thinks: 1, maxThinkMs: 0, waitMs: 0, firstActionMs: 0 }])),
        experiment: {
          schema: 1, engine: { revision: "fixture", sourceSha256: "fixture", runtime: "fixture" },
          rulesSha256: "fixture", baseGuideSha256: "fixture", mode: "independent", calls: [], droppedCalls: 0,
          players: Object.fromEntries(players.map(p => [p.id, { changes: [], configuration: {
            model: "fixture-model", effort: "low", connector: "fixture", connectorVersion: "1", promptSha256: "fixture",
            memoryPolicy: "isolated", contextPolicy: "fixture",
          } }])),
        },
      };
      fixtures.set(slot, replay);
    } finally { match.dispose(); }
  }
});

async function workspace(mutate?: (replay: ReplayFile) => void) {
  const root = await mkdtemp(join(tmpdir(), "castellan-landing-")); directories.push(root);
  const archive = join(root, "archive");
  await mkdir(archive); await mkdir(join(root, "packages/web/src"), { recursive: true });
  await writeFile(join(root, "packages/web/src/featured.json"), JSON.stringify({ hero: "old", duel: "old-duel", teams: "old-teams" }));
  for (const original of fixtures.values()) {
    const replay = structuredClone(original); if (replay.id === "teams") mutate?.(replay);
    await writeFile(join(archive, `${replay.id}.json.gz`), gzipSync(JSON.stringify(replay)));
  }
  return { root, archive };
}

it("preflights real hashes without writes, then installs a portable hero and one selection idempotently", async () => {
  const { root, archive } = await workspace();
  const file = join(root, "packages/web/src/featured.json"), before = await readFile(file, "utf8");
  const plan = await prepareLanding(root, archive, selection);
  expect(await readFile(file, "utf8")).toBe(before);
  expect(plan.summaries.every(s => s.verified)).toBe(true);
  await applyLanding(root, plan);
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual(selection);
  const hero = JSON.parse(await readFile(join(root, "packages/web/public/showcase/hero.json"), "utf8"));
  expect(hero.experiment).toBeUndefined();
  expect(hero.hashes).toEqual(fixtures.get("hero")!.hashes);
  await applyLanding(root, plan);
  expect(await readdir(join(root, "packages/web/public/showcase"))).toEqual(["hero.json"]);
});

it.each([
  ["watchdog", (r: ReplayFile) => { r.experiment!.operationalFailures = [{ player: "p0", tick: 1, message: "watchdog" }]; }, /operational failure/],
  ["prep-only harness", (r: ReplayFile) => { r.timing!.p0.decisions = 0; r.timing!.p0.firstActionMs = null; }, /no running decisions/],
  ["desync", (r: ReplayFile) => { r.hashes[r.finalTick] = "bad"; }, /desync/],
  ["false result", (r: ReplayFile) => { r.outcome = { ...r.outcome, winner: "p0", reason: "vital_lost" }; }, /recorded outcome/],
  ["old rules", (r: ReplayFile) => { r.ruleset.version = "0.29.2"; }, /current rules/],
  ["wrong mode", (r: ReplayFile) => { r.players.forEach((p, i) => { p.team = i; }); }, /wrong teams/],
  ["unknown harness", (r: ReplayFile) => { r.experiment!.players.p0.configuration.model = null; }, /metadata/],
  ["stopped harness", (r: ReplayFile) => { r.experiment!.agentActivity = [{ player: "p0", tick: 0, activity: { state: "stopped", at: "2026-10-25T00:00:00Z" } }]; }, /stopped while alive/],
] as const)("rejects %s before changing the landing", async (_name, mutate, error) => {
  const { root, archive } = await workspace(mutate);
  await expect(prepareLanding(root, archive, selection)).rejects.toThrow(error);
  expect(JSON.parse(await readFile(join(root, "packages/web/src/featured.json"), "utf8"))).toHaveProperty("hero", "old");
});

it("reads only selected archive files and fails explicitly for a missing selection", async () => {
  const { root, archive } = await workspace();
  await writeFile(join(archive, "unrelated.json.gz"), "not even gzip");
  expect((await collectPublication(root, archive, new Set(["duel"]))).replays.map(r => r.replay.id)).toEqual(["duel"]);
  await expect(collectPublication(root, archive, new Set(["missing"]))).rejects.toThrow("Not publishable or not found: missing");
  await expect(prepareLanding(root, archive, { ...selection, hero: "../private" })).rejects.toThrow("Invalid replay ID");
});

it("checks the actual public bundle and hero and rejects a stale landing even when HTTP is 200", async () => {
  const { root } = await workspace();
  const content = new Map([
    ["/", '<script type="module" src="/assets/current.js"></script>'],
    ["/assets/current.js", "current code"],
    ["/showcase/hero/manifest.json", '{"id":"hero"}'],
  ]);
  for (const [path, text] of content) {
    const file = join(root, path === "/" ? "index.html" : path);
    await mkdir(join(file, ".."), { recursive: true }); await writeFile(file, text);
  }
  const server = createServer((req, res) => { res.end(content.get(req.url!) ?? "SPA fallback"); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    await verifyLandingBuild(base, root, "hero");
    content.set("/", '<script src="/assets/old.js"></script>');
    await expect(verifyLandingBuild(base, root, "hero")).rejects.toThrow("different build");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
