import type { Ruleset } from "../ruleset";
import { v2 } from "./v2";

/** Timed production and shared team vision. Embedded legacy rules remain unchanged. */
export const v3: Ruleset = {
  ...v2,
  version: "v3-fog-production",
  trainingQueueLimit: 5,
  fogOfWar: { rememberTerrain: true },
  kinds: {
    ...v2.kinds,
    worker: { ...v2.kinds.worker, trainMs: 5000 },
    knight: { ...v2.kinds.knight, trainMs: 8000 },
    ranger: { ...v2.kinds.ranger, trainMs: 10000 },
  },
  legend: { ...v2.legend, "?": "unexplored", ":": "explored ground outside current vision" },
};
