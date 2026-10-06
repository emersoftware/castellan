/** The combat and cost values the optimizer may move, with bounds and the design rules it must keep. */
import { rules as base, type Ruleset } from "@aoa/shared";

/** Values move on a grid: costs and health in tens, times in whole 100 ms ticks (the engine rounds to them), small
 *  stats in units. */
export interface Param { key: string; min: number; max: number; step: number }
export const PARAMS: Param[] = [
  /** Knights and rangers cost the same: models lean to whichever is cheaper (see the v12–v17 games). */
  { key: "knight.cost", min: 70, max: 150, step: 10 }, { key: "knight.hp", min: 60, max: 150, step: 10 }, { key: "knight.def", min: 2, max: 8, step: 1 },
  { key: "knight.atk", min: 8, max: 18, step: 1 }, { key: "knight.moveMs", min: 400, max: 500, step: 100 },
  { key: "ranger.hp", min: 30, max: 80, step: 10 }, { key: "ranger.def", min: 0, max: 4, step: 1 },
  { key: "ranger.atk", min: 8, max: 16, step: 1 }, { key: "ranger.moveMs", min: 300, max: 400, step: 100 }, { key: "ranger.range", min: 3, max: 5, step: 1 },
  { key: "turret.cost", min: 120, max: 320, step: 10 }, { key: "turret.hp", min: 100, max: 260, step: 10 }, { key: "turret.def", min: 2, max: 9, step: 1 },
  { key: "turret.atk", min: 8, max: 24, step: 1 }, { key: "turret.range", min: 5, max: 7, step: 1 },
  { key: "castle.hp", min: 400, max: 800, step: 50 }, { key: "castle.def", min: 2, max: 8, step: 1 }, { key: "castle.atk", min: 3, max: 12, step: 1 },
  /** Time a unit must stand still after a step before it can attack. */
  { key: "knight.aimMs", min: 100, max: 100, step: 100 }, { key: "ranger.aimMs", min: 100, max: 500, step: 100 },
  /** Researches (knight and ranger alike): mobility takes ms off step time, damage adds attack per level, cadence
   *  takes 100 ms off the attack interval per level. Costs are of the first level; a second costs 100 more. */
  { key: "up.mobility", min: 100, max: 200, step: 100 }, { key: "up.damage", min: 1, max: 3, step: 1 },
  { key: "cost.damage", min: 100, max: 250, step: 50 }, { key: "cost.cadence", min: 100, max: 250, step: 50 },
  { key: "cost.mobility", min: 100, max: 300, step: 50 }, { key: "cost.range", min: 100, max: 300, step: 50 },
  { key: "cost.turretRange", min: 100, max: 300, step: 50 },
];

/** Research values that are not a kind's stat: how to read them from a ruleset. */
type Source = Pick<Ruleset, "kinds" | "upgrades">;
const RESEARCH: Record<string, (r: Source) => number> = {
  "up.mobility": (r) => r.kinds.knight.moveMs! - r.upgrades.knight_mobility.levels[0].value,
  "up.damage": (r) => r.upgrades.knight_damage.levels[0].value - r.kinds.knight.atk!,
  "cost.damage": (r) => r.upgrades.knight_damage.levels[0].cost,
  "cost.cadence": (r) => r.upgrades.knight_cadence.levels[0].cost,
  "cost.mobility": (r) => r.upgrades.knight_mobility.levels[0].cost,
  "cost.range": (r) => r.upgrades.ranger_range.levels[0].cost,
  "cost.turretRange": (r) => r.upgrades.turret_range.levels[0].cost,
};

export type Values = Record<string, number>;

/** The values of a ruleset (default: the current one). Values an older ruleset lacks come from the current one. */
export function current(r: Source = base): Values {
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
 * Snaps to the grid, clamps and enforces the design rules: equal knight and ranger cost (in rulesWith); turrets
 * outrange researched rangers; knights are no faster than rangers and aim no longer; knights hit harder (+2), are
 * better armoured (+3) and tougher (1.5× health) than rangers; every fighter deals at least 3 to another
 * (castles 2 to knights) and knights and rangers at least 2 to the king.
 */
export function legal(v: Values): Values {
  const out: Values = {};
  const bounds = Object.fromEntries(PARAMS.map((p) => [p.key, p]));
  const snap = (key: string, x: number) => { const { min, max, step } = bounds[key]; return Math.round(Math.min(max, Math.max(min, x)) / step) * step; };
  for (const { key } of PARAMS) out[key] = snap(key, v[key]);
  const king = base.kinds.king.def;
  for (let pass = 0; pass < 3; pass++) {
    out["turret.range"] = snap("turret.range", Math.max(out["turret.range"], out["ranger.range"] + 2));
    out["ranger.range"] = Math.min(out["ranger.range"], out["turret.range"] - 2);
    out["knight.moveMs"] = snap("knight.moveMs", Math.max(out["knight.moveMs"], out["ranger.moveMs"]));
    out["knight.aimMs"] = Math.min(out["knight.aimMs"], out["ranger.aimMs"]);
    out["knight.def"] = snap("knight.def", Math.max(out["knight.def"], out["ranger.def"] + 3));
    out["ranger.def"] = Math.min(out["ranger.def"], out["knight.def"] - 3);
    out["knight.hp"] = snap("knight.hp", Math.max(out["knight.hp"], Math.ceil((1.5 * out["ranger.hp"]) / 10) * 10));
    out["ranger.hp"] = snap("ranger.hp", Math.min(out["ranger.hp"], Math.floor(out["knight.hp"] / 15) * 10));
    out["ranger.atk"] = snap("ranger.atk", Math.max(out["ranger.atk"], out["knight.def"] + 3, king + 2));
    out["knight.def"] = Math.min(out["knight.def"], out["ranger.atk"] - 3);
    out["knight.atk"] = snap("knight.atk", Math.max(out["knight.atk"], out["ranger.atk"] + 2, king + 2));
    out["turret.atk"] = snap("turret.atk", Math.max(out["turret.atk"], out["knight.def"] + 3));
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
  kinds.ranger.cost = kinds.knight.cost;
  kinds.ranger.vision = Math.max(kinds.ranger.vision, kinds.ranger.range! + 2);
  kinds.turret.vision = Math.max(kinds.turret.vision, kinds.turret.range! + 1);
  const upgrades = structuredClone(base.upgrades);
  // Researches keep their step over the base value.
  const cost = (first: number, i: number) => first + 100 * i;
  for (const k of ["knight", "ranger"] as const) {
    upgrades[`${k}_damage`].levels = upgrades[`${k}_damage`].levels.map((l, i) => ({ ...l, cost: cost(v["cost.damage"], i), value: kinds[k].atk! + v["up.damage"] * (i + 1) }));
    upgrades[`${k}_cadence`].levels = upgrades[`${k}_cadence`].levels.map((l, i) => ({ ...l, cost: cost(v["cost.cadence"], i), value: kinds[k].attackMs! - 100 * (i + 1) }));
    upgrades[`${k}_mobility`].levels = [{ ...upgrades[`${k}_mobility`].levels[0], cost: v["cost.mobility"], value: kinds[k].moveMs! - v["up.mobility"] }];
  }
  upgrades.ranger_range.levels = [{ ...upgrades.ranger_range.levels[0], cost: v["cost.range"], value: kinds.ranger.range! + 1, vision: kinds.ranger.vision + 1 }];
  upgrades.turret_range.levels = upgrades.turret_range.levels.map((l, i) => ({ ...l, cost: cost(v["cost.turretRange"], i), value: kinds.turret.range! + i + 1, vision: kinds.turret.vision + i + 1 }));
  return { ...base, kinds, upgrades };
}
