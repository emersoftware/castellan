import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { runReplay } from "../packages/engine/src/index";
import type { ReplayFile } from "../packages/shared/src/protocol";
import { rules } from "../packages/shared/src/rules";
import { collectPublication } from "./catalog";

export interface LandingSelection { hero: string; duel: string; teams: string }
const slots = ["hero", "duel", "teams"] as const;
const selectionFile = "packages/web/src/featured.json";

/** No file or remote writes until all three recordings pass the same release gate. */
export async function prepareLanding(root: string, archive: string, selection: LandingSelection) {
  const ids = slots.map(slot => selection[slot]);
  assert.ok(ids.every(id => typeof id === "string" && /^[a-zA-Z0-9-]+$/.test(id)), "Invalid replay ID");
  assert.equal(new Set(ids).size, slots.length, "Each landing slot needs a different replay");
  const publication = await collectPublication(root, archive, new Set(ids));
  const summaries = [];
  for (const slot of slots) {
    const id = selection[slot];
    // The publication omits private harness metadata. Validate the original, before that projection.
    const replay: ReplayFile = JSON.parse(gunzipSync(await readFile(join(archive, `${id}.json.gz`))).toString());
    assert.equal(replay.ruleset.version, rules.version, `${slot}: expected current rules ${rules.version}`);
    assert.equal(replay.players.length, slot === "duel" ? 2 : 4, `${slot}: wrong player count`);
    const teams = new Map<number, number>();
    replay.players.forEach((p, i) => teams.set(p.team ?? i, (teams.get(p.team ?? i) ?? 0) + 1));
    assert.deepEqual([...teams.values()].sort(), slot === "teams" ? [2, 2] : replay.players.map(() => 1), `${slot}: wrong teams`);
    assert.ok(Object.keys(replay.hashes).length, `${id}: missing recorded hashes`);
    assert.equal(replay.experiment?.operationalFailures?.length ?? 0, 0, `${id}: sandbox operational failure`);
    for (const player of replay.players) {
      const config = replay.experiment?.players?.[player.id]?.configuration;
      assert.ok(config?.model && config.effort && config.connector && config.connectorVersion && config.promptSha256,
        `${id}/${player.id}: missing harness metadata`);
      const timing = replay.timing?.[player.id];
      assert.ok(timing && timing.decisions > 0 && Number.isFinite(timing.firstActionMs), `${id}/${player.id}: no running decisions`);
    }
    const stopped = (replay.experiment?.agentActivity ?? []).filter(e => e.activity.state === "stopped").sort((a, b) => a.tick - b.tick);
    let activity = 0;
    let outcome;
    const check = await runReplay(replay, frame => {
      outcome = frame.outcome;
      while (activity < stopped.length && stopped[activity].tick <= frame.tick) {
        const entry = stopped[activity++];
        assert.ok(frame.tick >= replay.finalTick || !frame.players.find(p => p.id === entry.player)?.alive,
          `${id}/${entry.player}: harness stopped while alive at tick ${entry.tick}`);
      }
    }, { includePerspectives: false });
    assert.ok(check.verified, `${id}: replay desync at ${check.desyncAt}`);
    assert.ok(outcome, `${id}: recording ended before the match finished`);
    assert.deepEqual(outcome, replay.outcome, `${id}: recorded outcome differs`);
    summaries.push({ slot, id, verified: true, seconds: replay.finalTick / replay.tickRate, outcome: replay.outcome });
  }
  return { selection, summaries, hero: publication.replays.find(entry => entry.replay.id === selection.hero)!.replay };
}

/** Install the hero first, then switch the selection. Keep old heroes for old links and rollback. */
export async function applyLanding(root: string, plan: Awaited<ReturnType<typeof prepareLanding>>) {
  const hero = join(root, "packages/web/public/showcase", `${plan.hero.id}.json`);
  await mkdir(join(root, "packages/web/public/showcase"), { recursive: true });
  for (const [path, value] of [[hero, plan.hero], [join(root, selectionFile), plan.selection]] as const) {
    const bytes = JSON.stringify(value, null, 2) + "\n";
    try { if (await readFile(path, "utf8") === bytes) continue; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const temporary = `${path}.tmp.${randomUUID()}`;
    try { await writeFile(temporary, bytes, { flag: "wx" }); await rename(temporary, path); }
    finally { await rm(temporary, { force: true }); }
  }
}

/** Check the deployed bundle and hero, not just HTTP 200 from the SPA fallback. */
export async function verifyLandingBuild(base: string, dist: string, hero: string) {
  const get = async (path: string) => {
    const response = await fetch(new URL(path, base), { headers: { "cache-control": "no-cache" }, signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, 200, path);
    return response.text();
  };
  const html = await readFile(join(dist, "index.html"), "utf8");
  const entry = html.match(/<script\b[^>]*\bsrc="([^"]+)"/)?.[1];
  assert.ok(entry && entry.startsWith("/assets/"), "Missing built entry script");
  assert.ok((await get("/")).includes(entry), "The public landing still serves a different build");
  assert.equal(await get(entry), await readFile(join(dist, entry), "utf8"), "Public entry bundle differs");
  const manifest = `/showcase/${hero}/manifest.json`;
  assert.deepEqual(JSON.parse(await get(manifest)), JSON.parse(await readFile(join(dist, manifest), "utf8")), "Public hero differs");
}
