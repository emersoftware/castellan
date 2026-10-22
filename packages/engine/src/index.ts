import { initSandbox } from "@castellan/sandbox";
import { Match, type MatchConfig } from "./match";

export { Match, type MatchConfig, type PlayerOrder } from "./match";
export { findPath } from "./grid";

/** Creates a match. Async only because the script sandbox loads WASM the first time. */
export async function createMatch(cfg: MatchConfig): Promise<Match> {
  await initSandbox();
  return new Match(cfg);
}
export { playRecording, recordingOf, recordingWithShutdowns, resimulate, runReplay, type ReplayOptions, type ResimulatedTick } from "./replay";
