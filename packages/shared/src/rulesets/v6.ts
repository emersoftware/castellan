import type { Ruleset } from "../ruleset";
import { v5 } from "./v5";

/** Twice the original projectile speed; older matches retain their embedded rules. */
export const v6: Ruleset = {
  ...v5,
  version: "v6-fast-projectiles",
  projectiles: { ...v5.projectiles!, speed: 12 },
};
