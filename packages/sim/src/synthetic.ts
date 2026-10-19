/**
 * Designed battles: two forces of equal mineral on an open field, to measure matchups the recorded games
 * cover poorly (who beats whom for the same money). Unit counts follow the candidate costs, so a cheaper unit
 * fields more bodies, and a side that researched pays for it with fewer units. Each scenario is fought from
 * both sides and with several script sets: standard, the built-in defaults, group tactics and scripts players wrote.
 */
import { existsSync, readFileSync } from "node:fs";
import { HOLD_SCRIPT, type EntityKind, type Ruleset } from "@castellan/shared";
import type { Snapshot } from "./battles";

type Kind = Extract<EntityKind, "knight" | "archer" | "tower">;
/** Share of the budget per kind. */
type Force = Partial<Record<Kind, number>>;
export interface Scenario {
  name: string; a: Force; b: Force;
  /** B holds instead of marching on A; a wall line with gaps stands in front of B. */
  hold?: boolean; wall?: boolean;
  /** Mineral per side (default BUDGET) and researches per side, paid from it. */
  budget?: number; upA?: Record<string, number>; upB?: Record<string, number>;
  /** Intended result: ln(value A loses ÷ value B loses). Positive: B wins. Unset: not scored. */
  target?: number;
}

/** Clear win (60/40) and slight win (55/45), as ln of the loss ratio. */
const WIN = Math.log(60 / 40), EDGE = Math.log(55 / 45);

export const BUDGET = 1000;
/** Rock-paper-scissors without research (archers beat knights in the open, knights beat towers, towers beat
 *  archers; mixed beats pure). Research shifts it, paid with fewer units. */
export const SCENARIOS: Scenario[] = [
  { name: "knights vs archers", a: { knight: 1 }, b: { archer: 1 }, target: WIN },
  { name: "knights vs mixed", a: { knight: 1 }, b: { knight: 0.5, archer: 0.5 }, target: EDGE },
  { name: "archers vs mixed", a: { archer: 1 }, b: { knight: 0.5, archer: 0.5 }, target: EDGE },
  { name: "knights vs towers", a: { knight: 1 }, b: { tower: 1 }, hold: true, target: -WIN },
  { name: "archers vs towers", a: { archer: 1 }, b: { tower: 1 }, hold: true, target: WIN },
  { name: "mixed vs towers + mixed", a: { knight: 0.5, archer: 0.5 }, b: { tower: 0.4, knight: 0.3, archer: 0.3 }, hold: true, target: 0 },
  { name: "knights vs archers behind a wall", a: { knight: 1 }, b: { archer: 1 }, hold: true, wall: true },
  { name: "archers (range, mobility) vs knights", a: { archer: 1 }, b: { knight: 1 }, budget: 1600,
    upA: { archer_range: 1, archer_mobility: 1 }, target: -Math.log(65 / 35) },
  { name: "archers (range, mobility) vs knights (damage, mobility)", a: { archer: 1 }, b: { knight: 1 }, budget: 1600,
    upA: { archer_range: 1, archer_mobility: 1 }, upB: { knight_damage: 1, knight_mobility: 1 }, target: -WIN },
  { name: "archers (range) vs towers", a: { archer: 1 }, b: { tower: 1 }, hold: true, budget: 1600,
    upA: { archer_range: 1 }, target: 0 },
  { name: "archers (range) vs towers (range)", a: { archer: 1 }, b: { tower: 1 }, hold: true, budget: 1600,
    upA: { archer_range: 1 }, upB: { tower_range: 1 }, target: WIN },
  { name: "knights (damage, cadence) vs mixed", a: { knight: 1 }, b: { knight: 0.5, archer: 0.5 }, budget: 1600,
    upA: { knight_damage: 1, knight_cadence: 1 }, target: -EDGE },
];

/** Script sets by kind. 0: standard, 1: built-in defaults, 2: tactical (below), then sets players wrote (script-sets.json:
 *  first the knight and archer scripts from the v18–v19 games, then older ones). */
type ScriptSet = Record<string, string>;
const recorded: ScriptSet[] = (() => {
  const file = process.env.SCRIPTS ?? "/tmp/castellan-opt/script-sets.json";
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
})();
/** Pairs of script sets (side A, side B) every scenario is fought with. */
const PAIRS: [number, number][] = [[0, 0], [1, 1], [2, 2], ...recorded.slice(0, 6).flatMap((_, i) => (i % 2 ? [] : [[3 + i, 4 + i] as [number, number]]))];
export const SYNTHETIC_COUNT = SCENARIOS.length * 2 * PAIRS.length;
/** Scenario (position in SCENARIOS) of designed battle `i`. */
export const scenarioOf = (i: number) => Math.floor(i / (2 * PAIRS.length));
/** Index of a scenario (by position in SCENARIOS), side (0 as designed, 1 mirrored) and script pair. */
export const designedIndex = (sc: number, side = 0, pair = 0) => (sc * 2 + side) * PAIRS.length + pair;

const W = 32, H = 20, FRONT = 10, GAP = 6;

/** Knights close in; archers keep knights at arm's length and shoot the weakest in range. Without a visible
 *  enemy they run `idle`. */
function standard(idle: string): ScriptSet {
  return {
    knight: `const t = self.enemiesInRange()[0] || self.nearestEnemy();
if (t) self.attack(t); else ${idle}`,
    archer: `const close = self.nearbyEnemies().filter((e) => e.type === "knight" && self.distanceTo(e) <= 2)[0];
const shots = self.enemiesInRange();
if (close) self.flee(close);
else if (shots.length) self.attack(shots.reduce((a, b) => (b.hp < a.hp ? b : a)));
else { const e = self.nearestEnemy(); if (e) self.attack(e); else ${idle} }`,
  };
}

/** Group tactics. Archers kite together: they fall back, away from the enemy knights near the group, as soon as one
 *  closes on them or their nearest archer, regroup when strayed, and otherwise shoot the weakest in range. Knights
 *  screen: they go for the enemy closest to their archers, else the nearest. Without a visible enemy they run `idle`. */
function tactical(idle: string): ScriptSet {
  return {
    knight: `const mates = self.nearbyAllies().filter((a) => a.type === "archer");
let t = null, best = 99;
for (const e of self.nearbyEnemies()) for (const a of mates) { const d = Math.abs(e.x - a.x) + Math.abs(e.y - a.y); if (d < best) { best = d; t = e; } }
t = t || self.enemiesInRange()[0] || self.nearestEnemy();
if (t) self.attack(t); else ${idle}`,
    archer: `const knights = self.nearbyEnemies().filter((e) => e.type === "knight");
const mates = self.nearbyAllies().filter((a) => a.type === "archer");
const buddy = mates[0];
const near = (p) => knights.some((k) => Math.abs(k.x - p.x) + Math.abs(k.y - p.y) <= 2);
if (knights.length && (near(self) || (buddy && near(buddy)))) {
  let cx = 0, cy = 0; for (const k of knights) { cx += k.x; cy += k.y; }
  cx /= knights.length; cy /= knights.length;
  const dx = self.x - cx, dy = self.y - cy, n = Math.max(1, Math.abs(dx) + Math.abs(dy));
  self.moveTo(self.x + Math.round((3 * dx) / n), self.y + Math.round((3 * dy) / n));
} else {
  const shots = self.enemiesInRange();
  if (shots.length) self.attack(shots.reduce((a, b) => (b.hp < a.hp ? b : a)));
  else if (mates.length > 1) {
    let gx = 0, gy = 0; for (const a of mates) { gx += a.x; gy += a.y; }
    gx = Math.round(gx / mates.length); gy = Math.round(gy / mates.length);
    if (Math.abs(gx - self.x) + Math.abs(gy - self.y) > 3) self.moveTo(gx, gy);
    else { const e = self.nearestEnemy(); if (e) self.attack(e); else ${idle} }
  } else { const e = self.nearestEnemy(); if (e) self.attack(e); else ${idle} }
}`,
  };
}

/** Designed battle `i` (0 … SYNTHETIC_COUNT−1) under the given rules, as a snapshot `runBattle` can fight. */
export function scenario(i: number, r: Ruleset): Snapshot {
  const pair = PAIRS[i % PAIRS.length], flip = Math.floor(i / PAIRS.length) % 2 === 1;
  const sc = SCENARIOS[Math.floor(i / (2 * PAIRS.length))];
  const X = (x: number) => (flip ? W - 1 - x : x);
  const entities: Snapshot["entities"] = [];
  let n = 0;
  const put = (kind: EntityKind, owner: string, x: number, y: number) => {
    const hp = r.kinds[kind].hp;
    entities.push({ id: `e${++n}`, kind, owner, x: X(x), y, hp, maxHp: hp });
  };
  const spent = (up: Record<string, number> = {}) =>
    Object.entries(up).reduce((a, [id, level]) => a + r.upgrades[id].levels.slice(0, level).reduce((s, l) => s + l.cost, 0), 0);
  // Towers at the front every other row, then columns of eight units away from it.
  const place = (owner: string, force: Force, front: number, dir: number, budget: number) => {
    // Never over budget: whole units only.
    const count = (k: Kind) => (force[k] ? Math.max(1, Math.floor((force[k]! * budget) / (r.kinds[k].cost ?? 1))) : 0);
    const towers = count("tower");
    for (let t = 0; t < towers; t++) put("tower", owner, front + dir * Math.floor(t / 4) * 2, 6 + (t % 4) * 2 + 1);
    const col = towers ? Math.ceil(towers / 4) * 2 : 0;
    const mobile: Kind[] = [...Array<Kind>(count("knight")).fill("knight"), ...Array<Kind>(count("archer")).fill("archer")];
    mobile.forEach((k, j) => put(k, owner, front + dir * (col + Math.floor(j / 8)), 6 + (j % 8)));
  };
  const budget = sc.budget ?? BUDGET;
  place("p1", sc.a, FRONT, -1, budget - spent(sc.upA));
  place("p2", sc.b, FRONT + GAP, 1, budget - spent(sc.upB));
  if (sc.wall) for (let y = 4; y < 16; y++) if (y % 4 !== 1) put("wall", "p2", FRONT + GAP - 2, y);
  // Castles far behind, so scripts that look for a base find one.
  put("castle", "p1", 0, H / 2);
  put("castle", "p2", W - 1, H / 2);
  const centre = (owner: string) => {
    const own = entities.filter((e) => e.owner === owner && e.kind !== "wall" && e.kind !== "castle");
    return [Math.round(own.reduce((a, e) => a + e.x, 0) / own.length), Math.round(own.reduce((a, e) => a + e.y, 0) / own.length)];
  };
  const [ax, ay] = centre("p1"), [bx, by] = centre("p2");
  // Without a visible enemy, an attacker marches on (tx, ty) and a defender holds.
  const set = (k: number, advance: boolean, tx: number, ty: number) => {
    const idle = advance ? `self.moveTo(${tx}, ${ty});` : HOLD_SCRIPT;
    return k === 0 ? standard(idle) : k === 1 ? {} : k === 2 ? tactical(idle) : recorded[k - 3];
  };
  return {
    format: "castellan-battle-v2", synthetic: true,
    id: `synthetic:${sc.name}${flip ? " (flipped)" : ""} [scripts ${pair[0]}/${pair[1]}]`,
    version: r.version,
    map: { name: "synthetic", width: W, height: H, walls: [], seats: 2 },
    players: [{ id: "p1", team: 0, upgrades: sc.upA ?? {} }, { id: "p2", team: 1, upgrades: sc.upB ?? {} }],
    entities,
    scripts: { p1: set(pair[0], true, bx, by), p2: set(pair[1], !sc.hold, ax, ay) },
  };
}
