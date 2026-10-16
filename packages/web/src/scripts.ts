import { currentKind, type RecordedKind, type ReplayFile, type Ruleset } from "@aoa/shared";

/** The script a unit of `kind` owned by `owner` runs at `tick`, or null if the kind has none. */
export interface LoadedScript { code: string; custom: boolean; sinceTick?: number }

/**
 * From a replay's orders: the last accepted script order for that player and kind, else the default.
 * `ruleset` and `kind` use today's names (`currentRuleset`); old orders may still use former ones.
 */
export function scriptAt(orders: ReplayFile["orders"], ruleset: Ruleset, owner: string, kind: RecordedKind, tick: number): LoadedScript | null {
  if (!ruleset.kinds[kind]?.scriptable) return null;
  let last: { tick: number; code: string | null } | undefined;
  for (const o of orders) {
    if (o.tick > tick) break;
    if (o.player === owner && o.order.type === "script" && currentKind(o.order.kind) === kind) last = { tick: o.tick, code: o.order.code };
  }
  return last?.code ? { code: last.code, custom: true, sinceTick: last.tick } : defaultScript(ruleset, kind);
}

export function defaultScript(ruleset: Ruleset, kind: string): LoadedScript | null {
  return ruleset.kinds[kind]?.scriptable ? { code: ruleset.defaultScripts[kind] ?? "", custom: false } : null;
}
