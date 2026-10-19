import { expect, it } from "vitest";
// @ts-expect-error Plain Node module shared by the keepers.
import { DEFAULT_PROMPT, promptOf, turnFor } from "../turns.mjs";

const at = (status: string, tick = 0) => `tick ${tick} · 0.0s/600.0s · 600.0s left · ${status} · you are p1\nYOU   p1: mineral 200`;

it("sends the same words at the same moments to every keeper's model", () => {
  expect(DEFAULT_PROMPT).toBe("PLAY");
  expect(promptOf({})).toBe("PLAY");
  expect(promptOf({ AOA_PROMPT: "Just Play", AOA_DIRECTIVE: "Hold the north." })).toBe("Just Play\n\nHold the north.");
  // Nothing while seats are still joining; the first turn once prep starts; later turns only while running.
  expect(turnFor(at("waiting"), { delivered: false, prompt: "PLAY" })).toBeNull();
  expect(turnFor(at("prep"), { delivered: false, prompt: "PLAY" })).toBe(`PLAY\n\n${at("prep")}`);
  expect(turnFor(at("prep"), { delivered: true, prompt: "PLAY" })).toBeNull();
  expect(turnFor(at("running", 40), { delivered: true, prompt: "PLAY" })).toBe(at("running", 40));
  expect(turnFor(at("running", 40), { delivered: false, prompt: "PLAY", resumed: true }))
    .toBe(`PLAY\n\nYour connector restarted; your earlier conversation is gone.\n\n${at("running", 40)}`);
});
