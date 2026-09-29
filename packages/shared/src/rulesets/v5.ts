import type { Ruleset } from "../ruleset";
import { v4 } from "./v4";

/** Ranged damage is resolved by deterministic, dodgeable projectiles. */
export const v5: Ruleset = {
  ...v4,
  version: "v5-projectiles",
  projectiles: { speed: 6, unitRadius: 0.35, buildingRadius: 0.5 },
};
