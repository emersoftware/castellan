import { afterEach, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { ReplayFile } from "../../packages/shared/src/protocol";
import { rules } from "../../packages/shared/src/rules";
import { replayArchive } from "../../packages/shared/src/replayArchive";
import { createMatch } from "../../packages/engine/src";
import { collectPublication, completeSeries, publicationSQL, publicReplay, type Publication, type Published } from "../catalog";

// A short finished match under the current rules, recorded like a real replay.
const fixture: ReplayFile = await (async () => {
  const ruleset = { ...rules, matchMs: 3000 };
  const players = [{ id: "p1", name: "one", side: 0, team: 0 }, { id: "p2", name: "two", side: 1, team: 1 }];
  const m = await createMatch({ ruleset, players, seed: 1, tickRate: 10 });
  const hashes: Record<number, string> = {};
  while (!m.outcome) { if (m.tick % 10 === 0) hashes[m.tick] = m.hash(); m.step([]); }
  hashes[m.tick] = m.hash();
  const replay: ReplayFile = { format: 1, id: "f1x7ure0", createdAt: "2026-10-02T00:00:00.000Z", ruleset, seed: 1, tickRate: 10,
    players, orders: [], hashes, finalTick: m.tick, outcome: m.outcome };
  m.dispose();
  return replay;
})();
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const entry = (replay: ReplayFile): Publication["replays"][number] => ({ replay, summary: {
  id: replay.id, title: "Agent's battle; SELECT 'hello'", createdAt: replay.createdAt, savedAt: replay.createdAt,
  players: replay.players, outcome: replay.outcome, finalTick: replay.finalTick, tickRate: replay.tickRate,
} });

const migrated = async () => {
  const db = new DatabaseSync(":memory:");
  for (const file of ["0001_catalog.sql", "0002_replay_chunks.sql"]) db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  return db;
};
const stored = (db: DatabaseSync, id: string) => (db.prepare("SELECT chunk FROM replay_chunks WHERE id = ? ORDER BY n").all(id) as { chunk: string }[]).map((r) => r.chunk).join("");
const publishedIn = (db: DatabaseSync): Published => new Map((db.prepare("SELECT id, content_hash, summary_json FROM replays").all() as { id: string; content_hash: string; summary_json: string }[])
  .map((r) => [r.id, { contentHash: r.content_hash, summaryJson: r.summary_json }]));

it("imports exact JSON into SQLite, safely quotes scripts, and writes nothing on a repeat publication", async () => {
  const db = await migrated();
  try {
    const replay = structuredClone(fixture);
    replay.players[0].name = "O'Brien\nこんにちは";
    db.exec(publicationSQL({ replays: [entry(replay)], series: [], excluded: 0 }));
    expect(JSON.parse(stored(db, replay.id))).toEqual(replay);
    expect(JSON.parse((db.prepare("SELECT summary_json FROM replays").get()!.summary_json as string)).title).toBe("Agent's battle; SELECT 'hello'");
    expect(publicationSQL({ replays: [entry(replay)], series: [], excluded: 0 }, publishedIn(db))).toBe("");
    replay.players[0].name = "Updated";
    db.exec(publicationSQL({ replays: [entry(replay)], series: [], excluded: 0 }, publishedIn(db)));
    expect(db.prepare("SELECT count(*) AS n FROM replays").get()!.n).toBe(1);
    expect(JSON.parse(stored(db, replay.id)).players[0].name).toBe("Updated");
  } finally { db.close(); }
});

it("stores a replay larger than one D1 statement in pieces and reassembles it exactly", async () => {
  const db = await migrated();
  try {
    const replay = structuredClone(fixture);
    replay.chat = Array.from({ length: 3000 }, (_, i) => ({ tick: i, from: "p1", channel: "all", text: `it's ${i} — señal ✓` })) as unknown as ReplayFile["chat"];
    const sql = publicationSQL({ replays: [entry(replay)], series: [], excluded: 0 });
    expect(db.exec(sql)).toBeUndefined();
    expect((db.prepare("SELECT count(*) AS n FROM replay_chunks").get()!.n as number)).toBeGreaterThan(2);
    expect(JSON.parse(stored(db, replay.id))).toEqual(replay);
  } finally { db.close(); }
});

it("migrates published rows into pieces and keeps their rules version in the summary", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(await readFile(new URL("../migrations/0001_catalog.sql", import.meta.url), "utf8"));
    db.prepare("INSERT INTO replays VALUES (?, ?, ?, ?, ?)").run(fixture.id, fixture.createdAt, JSON.stringify({ id: fixture.id }), JSON.stringify(fixture), "h");
    db.exec(await readFile(new URL("../migrations/0002_replay_chunks.sql", import.meta.url), "utf8"));
    expect(JSON.parse(stored(db, fixture.id))).toEqual(fixture);
    expect(JSON.parse(db.prepare("SELECT summary_json FROM replays").get()!.summary_json as string)).toEqual({ id: fixture.id, rulesVersion: rules.version });
  } finally { db.close(); }
});

it("publishes only complete, correctly ordered series and computes the team score", () => {
  const entries = [3, 1, 2].map((n) => {
    const replay = structuredClone(fixture);
    replay.id = `game${n}`;
    replay.series = { id: "series1", gameNumber: n, totalGames: 3 };
    replay.players = [{ id: "p1", name: "One", team: 0 }, { id: "p2", name: "Two", team: 1 }];
    replay.outcome = { winner: n === 3 ? "p2" : "p1", reason: "vital_lost", scores: {} };
    return entry(replay);
  });
  expect(completeSeries(entries.slice(0, 2))).toEqual([]);
  const summary = completeSeries(entries)[0].summary;
  expect(summary.games.map((g) => g.roomId)).toEqual(["game1", "game2", "game3"]);
  expect(summary.score).toEqual({ p1: 2, p2: 1 });
  expect(summary.losses).toEqual({ p1: 1, p2: 2 });
  expect(summary.winners).toEqual(["p1"]);
  expect(summary.allDefeated).toBeUndefined();
  expect(completeSeries([entries[0], entries[0], entries[1]])).toEqual([]);
});

it.each([true, undefined])("publishes losses while preserving historical tied series (%s)", (drawsAreLosses) => {
  const entries = [1, 2, 3].map(n => {
    const replay = structuredClone(fixture);
    replay.id = `tied${n}`;
    replay.series = { id: "tied", gameNumber: n, totalGames: 3 };
    replay.ruleset.drawsAreLosses = drawsAreLosses;
    replay.outcome = { winner: null, winners: [], reason: "timeout", scores: {},
      ...(drawsAreLosses ? { allDefeated: true as const } : {}) };
    return entry(publicReplay(replay));
  });
  const summary = completeSeries(entries)[0].summary;
  expect(summary.score).toEqual({ p1: 0, p2: 0 });
  expect(summary.losses).toEqual({ p1: drawsAreLosses ? 3 : 0, p2: drawsAreLosses ? 3 : 0 });
  expect(summary.winners).toEqual([]);
  expect(summary.allDefeated).toBe(drawsAreLosses);
  expect(summary.games.every(g => g.outcome?.allDefeated === drawsAreLosses)).toBe(true);
});

it("counts a shared loss in addition to each side's one win and one defeat", () => {
  const entries = [1, 2, 3].map(n => {
    const replay = structuredClone(fixture);
    replay.id = `mixed${n}`;
    replay.series = { id: "mixed", gameNumber: n, totalGames: 3 };
    if (n < 3) replay.outcome = { winner: `p${n}`, winners: [`p${n}`], reason: "vital_lost", scores: {} };
    return entry(replay);
  });
  expect(completeSeries(entries)[0].summary).toMatchObject({ score: { p1: 1, p2: 1 },
    losses: { p1: 2, p2: 2 }, winners: [], allDefeated: true });
});

it.each([["low", "low"], ["PRIVATE-INVALID-EFFORT", null]])("reads fresh payloads and publishes only safe catalogue metadata (effort %s)", async (declaredEffort, expectedEffort) => {
  const root = await mkdtemp(join(tmpdir(), "castellan-catalog-test-")); directories.push(root);
  const featured = join(root, replayArchive.featured), local = join(root, "replays");
  await mkdir(featured, { recursive: true }); await mkdir(local);
  const old = entry(fixture).summary;
  old.savedAt = "2026-09-01T00:00:00.000Z";
  await writeFile(join(featured, replayArchive.index), JSON.stringify([old]));
  await writeFile(join(featured, `${fixture.id}.json`), JSON.stringify(fixture));
  const fresh = { ...structuredClone(fixture), token: "PRIVATE-TOP-LEVEL", players: fixture.players.map((p) => ({ ...p, token: "PRIVATE-PLAYER" })),
    experiment: { players: {
      p1: { configuration: { effort: declaredEffort, promptSha256: "PRIVATE-PROMPT", connectorVersion: "PRIVATE-VERSION" } },
      p2: { configuration: { effort: null } },
    }, calls: [{ token: "PRIVATE-CALL" }] } };
  fresh.players[0].name = "Fresh agent";
  fresh.players[1].name = "Model Low"; // A display name is not recorded configuration.
  await writeFile(join(local, `${fixture.id}.json.gz`), gzipSync(JSON.stringify(fresh)));
  for (const [id, name] of [["bot-game", "bot:rush"], ["demo-game", "demo:mixed"]]) {
    const replay = structuredClone(fixture); replay.id = id; replay.players[0].name = name;
    await writeFile(join(local, `${id}.json.gz`), gzipSync(JSON.stringify(replay)));
  }
  const publication = await collectPublication(root, local);
  expect(publication.replays).toHaveLength(1);
  expect(publication.excluded).toBe(2);
  expect(publication.replays[0].summary.savedAt).toBe(old.savedAt);
  expect(publication.replays[0].summary.title).toBe(old.title);
  expect(publication.replays[0].replay.players[0].name).toBe("Fresh agent");
  expect(publication.replays[0].summary.players).toEqual([
    { ...fixture.players[0], name: "Fresh agent", effort: expectedEffort },
    { ...fixture.players[1], name: "Model Low", effort: null },
  ]);
  expect(publication.replays[0].replay.experiment).toBeUndefined();
  expect(publication.replays[0].replay.players[0]).not.toHaveProperty("effort");
  expect(JSON.stringify(publication)).not.toContain("PRIVATE-");
});

it("rejects unfinished recordings and oversized import statements before publication", () => {
  expect(() => publicReplay({ ...fixture, outcome: undefined! })).toThrow("Invalid finished replay");
  const replay = structuredClone(fixture); replay.players[0].name = "x".repeat(100_000);
  expect(() => publicationSQL({ replays: [entry(replay)], series: [], excluded: 0 })).toThrow("Nothing was uploaded"); // the summary itself is one statement
});

it("keeps recorded sandbox interruptions, which the viewer needs to re-simulate, and nothing else of the manifest", () => {
  const failure = { tick: 5, player: "p1", message: "sandbox watchdog timeout after 250ms; player VM terminated" };
  const replay = { ...structuredClone(fixture), experiment: { operationalFailures: [failure], players: { p1: { configuration: { promptSha256: "PRIVATE" } } } } } as unknown as ReplayFile;
  expect(publicReplay(replay).experiment).toEqual({ operationalFailures: [failure] });
});
