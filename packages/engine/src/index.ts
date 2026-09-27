import { initSandbox } from "@aoa/sandbox";
import { Match, type MatchConfig } from "./match";

export { Match, type MatchConfig, type PlayerOrder, type StepResult } from "./match";
export { validateOrder } from "./validate";
export { findPath, cheb } from "./grid";

/** Creates a match. Async only because the script sandbox loads WASM the first time. */
export async function createMatch(cfg: MatchConfig): Promise<Match> {
  await initSandbox();
  return new Match(cfg);
}
export { runReplay, type ReplayCheck } from "./replay";
