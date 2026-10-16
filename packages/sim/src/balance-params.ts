/** The combat and cost values the optimizer may move, with bounds and the design rules it must keep. */
import { rules as base, currentKind, type Ruleset } from "@aoa/shared";
import { currentUpgrade } from "./names";

/** Values move on a grid: costs and health in tens, times in whole 100 ms ticks (the engine rounds to them), small
 *  stats in units. */
export interface Param { key: string; min: number; max: number; step: number }
export const PARAMS: Param[] = [
  /** Knights and archers cost the same: models lean to whichever is cheaper (see the v12–v17 games). */
  { key: "knight.cost", min: 70, max: 150, step: 10 }, { key: "knight.hp", min: 60, max: 150, step: 10 }, { key: "knight.def", min: 2, max: 8, step: 1 },
  { key: "knight.atk", min: 8, max: 18, step: 1 }, { key: "knight.moveMs", min: 400, max: 500, step: 100 },
  { key: "archer.hp", min: 30, max: 80, step: 10 }, { key: "archer.def", min: 0, max: 4, step: 1 },
  { key: "archer.atk", min: 8, max: 16, step: 1 }, { key: "archer.moveMs", min: 300, max: 400, step: 100 }, { key: "archer.range", min: 3, max: 5, step: 1 },
  { key: "tower.cost", min: 120, max: 320, step: 10 }, { key: "tower.hp", min: 100, max: 260, step: 10 }, { key: "tower.def", min: 2, max: 9, step: 1 },
  { key: "tower.atk", min: 8, max: 24, step: 1 }, { key: "tower.range", min: 5, max: 7, step: 1 },
  { key: "castle.hp", min: 400, max: 800, step: 50 }, { key: "castle.def", min: 2, max: 8, step: 1 }, { key: "castle.atk", min: 3, max: 12, step: 1 },
  /** Time a unit must stand still after a step before it can attack. */
  { key: "knight.aimMs", min: 100, max: 100, step: 100 }, { key: "archer.aimMs", min: 100, max: 500, step: 100 },
  /** Researches (knight and archer alike): mobility takes ms off step time, damage adds attack per level, cadence
   *  takes 100 ms off the attack interval per level. Costs are of the first level; a second costs 100 more. */
  { key: "up.mobility", min: 100, max: 200, step: 100 }, { key: "up.damage", min: 1, max: 3, step: 1 },
  { key: "cost.damage", min: 100, max: 250, step: 50 }, { key: "cost.cadence", min: 100, max: 250, step: 50 },
  { key: "cost.mobility", min: 100, max: 300, step: 50 }, { key: "cost.range", min: 100, max: 300, step: 50 },
  { key: "cost.towerRange", min: 100, max: 300, step: 50 },
];

/** Research values that are not a kind's stat: how to read them from a ruleset. */
type Source = Pick<Ruleset, "kinds" | "upgrades">;
const RESEARCH: Record<string, (r: Source) => number> = {
  "up.mobility": (r) => r.kinds.knight.moveMs! - r.upgrades.knight_mobility.levels[0].value,
  "up.damage": (r) => r.upgrades.knight_damage.levels[0].value - r.kinds.knight.atk!,
  "cost.damage": (r) => r.upgrades.knight_damage.levels[0].cost,
  "cost.cadence": (r) => r.upgrades.knight_cadence.levels[0].cost,
  "cost.mobility": (r) => r.upgrades.knight_mobility.levels[0].cost,
  "cost.range": (r) => r.upgrades.archer_range.levels[0].cost,
  "cost.towerRange": (r) => r.upgrades.tower_range.levels[0].cost,
};

export type Values = Record<string, number>;

/** The values of a ruleset (default: the current one). Values an older ruleset lacks come from the current one. */
export function current(r: Source = base): Values {
  r = { kinds: Object.fromEntries(Object.entries(r.kinds).map(([kind, spec]) => [currentKind(kind), spec])),
    upgrades: Object.fromEntries(Object.entries(r.upgrades).map(([id, spec]) => [currentUpgrade(id), spec])) };
  const v: Values = {};
  for (const { key } of PARAMS) {
    const [kind, stat] = key.split(".");
    const read = (src: Source) => (RESEARCH[key] ? RESEARCH[key](src) : (src.kinds[kind] as unknown as Record<string, number>)[stat]);
    let x: number | undefined;
    try { x = read(r); } catch { x = undefined; }
    v[key] = typeof x === "number" && Number.isFinite(x) ? x : key.endsWith("aimMs") ? 0 : read(base);
  }
  return v;
}

/**
 * Snaps to the grid, clamps and enforces the design rules: equal knight and archer cost (in rulesWith); towers
 * outrange researched archers; knights are no faster than archers and aim no longer; knights hit harder (+2), are
 * better armoured (+3) and tougher (1.5× health) than archers; every fighter deals at least 3 to another
 * (castles 2 to knights) and knights and archers at least 2 to the king.
 */
export function legal(v: Values): Values {
  const out: Values = {};
  const bounds = Object.fromEntries(PARAMS.map((p) => [p.key, p]));
  const snap = (key: string, x: number) => { const { min, max, step } = bounds[key]; return Math.round(Math.min(max, Math.max(min, x)) / step) * step; };
  for (const { key } of PARAMS) out[key] = snap(key, v[key]);
  const king = base.kinds.king.def;
  for (let pass = 0; pass < 3; pass++) {
    out["tower.range"] = snap("tower.range", Math.max(out["tower.range"], out["archer.range"] + 2));
    out["archer.range"] = Math.min(out["archer.range"], out["tower.range"] - 2);
    out["knight.moveMs"] = snap("knight.moveMs", Math.max(out["knight.moveMs"], out["archer.moveMs"]));
    out["knight.aimMs"] = Math.min(out["knight.aimMs"], out["archer.aimMs"]);
    out["knight.def"] = snap("knight.def", Math.max(out["knight.def"], out["archer.def"] + 3));
    out["archer.def"] = Math.min(out["archer.def"], out["knight.def"] - 3);
    out["knight.hp"] = snap("knight.hp", Math.max(out["knight.hp"], Math.ceil((1.5 * out["archer.hp"]) / 10) * 10));
    out["archer.hp"] = snap("archer.hp", Math.min(out["archer.hp"], Math.floor(out["knight.hp"] / 15) * 10));
    out["archer.atk"] = snap("archer.atk", Math.max(out["archer.atk"], out["knight.def"] + 3, king + 2));
    out["knight.def"] = Math.min(out["knight.def"], out["archer.atk"] - 3);
    out["knight.atk"] = snap("knight.atk", Math.max(out["knight.atk"], out["archer.atk"] + 2, king + 2));
    out["tower.atk"] = snap("tower.atk", Math.max(out["tower.atk"], out["knight.def"] + 3));
    out["castle.atk"] = snap("castle.atk", Math.max(out["castle.atk"], out["knight.def"] + 2));
  }
  return out;
}

/** The starting point: current rules snapped to the grid. */
export function start(): Values {
  return legal(current());
}

export function rulesWith(v: Values): Ruleset {
  const kinds = structuredClone(base.kinds);
  for (const { key } of PARAMS) {
    const [kind, stat] = key.split(".");
    if (RESEARCH[key]) continue;
    (kinds[kind] as unknown as Record<string, number>)[stat] = v[key];
  }
  kinds.archer.cost = kinds.knight.cost;
  kinds.archer.vision = Math.max(kinds.archer.vision, kinds.archer.range! + 2);
  kinds.tower.vision = Math.max(kinds.tower.vision, kinds.tower.range! + 1);
  const upgrades = structuredClone(base.upgrades);
  // Researches keep their step over the base value.
  const cost = (first: number, i: number) => first + 100 * i;
  for (const k of ["knight", "archer"] as const) {
    upgrades[`${k}_damage`].levels = upgrades[`${k}_damage`].levels.map((l, i) => ({ ...l, cost: cost(v["cost.damage"], i), value: kinds[k].atk! + v["up.damage"] * (i + 1) }));
    upgrades[`${k}_cadence`].levels = upgrades[`${k}_cadence`].levels.map((l, i) => ({ ...l, cost: cost(v["cost.cadence"], i), value: kinds[k].attackMs! - 100 * (i + 1) }));
    upgrades[`${k}_mobility`].levels = [{ ...upgrades[`${k}_mobility`].levels[0], cost: v["cost.mobility"], value: kinds[k].moveMs! - v["up.mobility"] }];
  }
  upgrades.archer_range.levels = [{ ...upgrades.archer_range.levels[0], cost: v["cost.range"], value: kinds.archer.range! + 1, vision: kinds.archer.vision + 1 }];
  upgrades.tower_range.levels = upgrades.tower_range.levels.map((l, i) => ({ ...l, cost: cost(v["cost.towerRange"], i), value: kinds.tower.range! + i + 1, vision: kinds.tower.vision + i + 1 }));
  return { ...base, kinds, upgrades };
}
