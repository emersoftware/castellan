import type { Ruleset } from "../ruleset";
import { v0 } from "./v0";

/** Experimental upgrades; base unit prices, ranges and production remain v0. */
export const v1: Ruleset = {
  ...v0,
  version: "v1-upgrades",
  upgrades: { ...Object.fromEntries(["knight", "ranger"].flatMap((kind) => [
    [`${kind}_damage`, { kind, stat: "atk", levels: [
      { cost: 150, researchMs: 10_000, value: 14 },
      { cost: 250, researchMs: 15_000, value: 16 },
    ] }],
    [`${kind}_cadence`, { kind, stat: "attackMs", levels: [
      { cost: 150, researchMs: 10_000, value: 900 },
      { cost: 250, researchMs: 15_000, value: 800 },
    ] }],
    // 10 Hz quantizes movement to 100 ms: 380 and 400 both take four ticks.
    // One explicit step to three ticks; no misleading sub-tick speed bonuses.
    [`${kind}_mobility`, { kind, stat: "moveMs", levels: [
      { cost: 250, researchMs: 15_000, value: 300 },
    ] }],
  ])),
    worker_damage: { kind: "worker", stat: "atk", levels: [
      { cost: 150, researchMs: 10_000, value: 5 },
      { cost: 250, researchMs: 15_000, value: 7 },
    ] },
  },
};
