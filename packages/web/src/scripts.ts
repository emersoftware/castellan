import { type EntityKind, type Ruleset } from "@castellan/shared";
import type { ResimulatedTick } from "@castellan/engine";

/** The script a unit of `kind` owned by `owner` runs at `tick`, or null if the kind has none. */
export interface LoadedScript { code: string; custom: boolean; sinceTick?: number }

/** A script the engine installed for a player's kind (today's name) at a tick; null code: back to the default. */
export interface ScriptLoad { tick: number; player: string; kind: string; code: string | null }

/** The uploads a re-simulated tick installed. The engine rejects some (a compile error, a stopped VM); those never ran. */
export function acceptedScripts({ tick, input, results }: ResimulatedTick): ScriptLoad[] {
  return input.flatMap(({ player, order }, i) =>
    order.type === "script" && results[i]?.ok ? [{ tick, player, kind: order.kind, code: order.code }] : []);
}

/** From the scripts the engine installed: the last one for that player and kind by `tick`, else the default. */
export function scriptAt(loads: readonly ScriptLoad[], ruleset: Ruleset, owner: string, kind: EntityKind, tick: number): LoadedScript | null {
  if (!ruleset.kinds[kind]?.scriptable) return null;
  let last: ScriptLoad | undefined;
  for (const load of loads) {
    if (load.tick > tick) break;
    if (load.player === owner && load.kind === kind) last = load;
  }
  return last?.code ? { code: last.code, custom: true, sinceTick: last.tick } : defaultScript(ruleset, kind);
}

export function defaultScript(ruleset: Ruleset, kind: string): LoadedScript | null {
  return ruleset.kinds[kind]?.scriptable ? { code: ruleset.defaultScripts[kind] ?? "", custom: false } : null;
}
