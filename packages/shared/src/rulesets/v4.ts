import type { Ruleset } from "../ruleset";
import { v3 } from "./v3";

/** Agent elimination is the only in-game victory; the time limit produces a draw. */
export const v4: Ruleset = {
  ...v3,
  version: "v4-agent-victory",
  timeoutOutcome: "draw",
};
