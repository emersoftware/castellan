import type { Ruleset } from "../ruleset";
import { v1 } from "./v1";

/** Experimental economic expansion. Old replays retain v0/v1 rules. */
export const v2: Ruleset = {
  ...v1,
  version: "v2-expansion",
  kinds: {
    ...v1.kinds,
    worker: { ...v1.kinds.worker, builds: [...v1.kinds.worker.builds!, "nexus"] },
    nexus: { ...v1.kinds.nexus, cost: 600, buildMs: 30_000, vital: false },
  },
  legend: { ...v1.legend, N: "nexus (production and resource dropoff; not vital)" },
};
