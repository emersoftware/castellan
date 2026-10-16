import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { currentFrame, currentRuleset, type ReplayFile, type SpectatorView } from "@aoa/shared";
import { runReplay } from "../src";

it("replays old resource fields, unit orders and research with every original hash", async () => {
  const replay = JSON.parse(readFileSync(new URL("./fixtures/legacy-names.replay.json", import.meta.url), "utf8")) as ReplayFile;
  const original = JSON.stringify(replay);
  let final: SpectatorView | undefined;
  const result = await runReplay(replay, view => { final = view; });
  expect(result.verified).toBe(true);
  expect(final!.outcome).toEqual(replay.outcome);
  expect(final!.entities.map(e => e.kind)).toEqual(expect.arrayContaining(["ranger", "turret"]));
  expect(final!.players[0].mineral).toBe(1500);
  expect(final!.players[0]).not.toHaveProperty("capital");
  expect(JSON.stringify(replay)).toBe(original);
});

it("shows old recordings under today's names without changing what the engine replays", async () => {
  const replay = JSON.parse(readFileSync(new URL("./fixtures/legacy-names.replay.json", import.meta.url), "utf8")) as ReplayFile;
  const original = JSON.stringify(replay);
  const ruleset = currentRuleset(replay.ruleset);
  const frames: SpectatorView[] = [];
  const result = await runReplay(replay, view => {
    const raw = JSON.stringify(view);
    frames.push(currentFrame(view));
    expect(JSON.stringify(view)).toBe(raw);
  });
  expect(result.verified).toBe(true);
  expect(JSON.stringify(replay)).toBe(original);
  const shown = frames.flatMap(f => [f, ...Object.values(f.perspectives ?? {})]);
  const kinds = new Set([
    ...shown.flatMap(f => f.entities.flatMap(e => [e.kind, ...(e.construction ? [e.construction.kind] : []), ...(e.training ?? []).map(t => t.kind)])),
    ...shown.flatMap(f => f.events.flatMap(e => ("kind" in e ? [e.kind] : []))),
  ]);
  expect(kinds).toContain("archer");
  for (const kind of kinds) expect(ruleset.kinds).toHaveProperty(kind);
  for (const id of shown.flatMap(f => f.players.flatMap(p => Object.keys(p.upgrades ?? {})))) expect(ruleset.upgrades).toHaveProperty(id);
  expect(ruleset.startMineral).toBeDefined();
  expect(Object.keys(ruleset.kinds)).not.toContain("ranger");
});
