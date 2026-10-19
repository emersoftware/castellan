import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { rules, type ReplayFile } from "@castellan/shared";
import { replayContinuation, resumeBattle, runBattle, type Snapshot } from "../src/battles";
import { current } from "../src/balance-params";

it("applies current candidate values to old units and counts them under current names", async () => {
  const replay = JSON.parse(readFileSync(new URL("../../engine/test/fixtures/legacy-names.replay.json", import.meta.url), "utf8")) as ReplayFile;
  const s: Snapshot = { id: "legacy#111", format: "castellan-battle-v2", version: replay.ruleset.version,
    map: { ...replay.ruleset.map, seats: 2 }, entities: [], scripts: {},
    players: replay.players.map((p, team) => ({ id: p.id, team, upgrades: {} })),
    continuation: replayContinuation(replay, 111, replay.hashes[110]),
  };
  const candidate = structuredClone(rules);
  candidate.kinds.archer.hp += 10;
  const match = await resumeBattle(s, candidate);
  try {
    expect(match.view("a").mine.find(e => e.kind === "ranger")!.maxHp).toBe(candidate.kinds.archer.hp);
    expect(match.ruleset.kinds.castle.trains).toContain("ranger");
    expect(match.ruleset.kinds.worker.builds).toContain("turret");
    expect(match.ruleset.upgrades.ranger_damage.kind).toBe("ranger");
    expect(Number.isFinite(match.view("a").players[0].score)).toBe(true);
  } finally { match.dispose(); }
  const result = await runBattle(s, candidate, {}, 1);
  expect(result.fielded.archer).toBe(candidate.kinds.archer.cost);
  expect(result.fielded.tower).toBe(candidate.kinds.tower.cost);
  expect(result.fielded).not.toHaveProperty("ranger");
  expect(result.errors).toBe(0);
  const baseline = await runBattle(s, replay.ruleset, {}, 1);
  expect(baseline.fielded.archer).toBe(replay.ruleset.kinds.ranger.cost);
  expect(baseline.fielded.tower).toBe(replay.ruleset.kinds.turret.cost);
  replay.ruleset.kinds.ranger.hp = 37;
  expect(current(replay.ruleset)["archer.hp"]).toBe(37);
});
