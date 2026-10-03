import type { ReplayFile, Ruleset } from "@aoa/shared";

/** The script a unit of `kind` owned by `owner` runs at `tick`, or null if the kind has none. */
export interface LoadedScript { code: string; custom: boolean; sinceTick?: number }

/** From a replay: the last accepted script order for that player and kind, else the default. */
export function scriptAt(replay: ReplayFile, owner: string, kind: string, tick: number): LoadedScript | null {
  if (!replay.ruleset.kinds[kind]?.scriptable) return null;
  let last: { tick: number; code: string | null } | undefined;
  for (const o of replay.orders) {
    if (o.tick > tick) break;
    if (o.player === owner && o.order.type === "script" && o.order.kind === kind) last = { tick: o.tick, code: o.order.code };
  }
  return last?.code ? { code: last.code, custom: true, sinceTick: last.tick } : defaultScript(replay.ruleset, kind);
}

export function defaultScript(ruleset: Ruleset, kind: string): LoadedScript | null {
  return ruleset.kinds[kind]?.scriptable ? { code: ruleset.defaultScripts[kind] ?? "", custom: false } : null;
}
