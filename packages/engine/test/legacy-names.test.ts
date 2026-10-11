import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { ReplayFile, SpectatorView } from "@aoa/shared";
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
