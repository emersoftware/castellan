/**
 * Reference bots. They exist to test and balance the game, never to play on a
 * ladder. A bot sees exactly what an LLM player sees (a PlayerView) and answers
 * with the same orders, so a bot with a decision delay models an LLM.
 */
import type { Order, PlayerView } from "@aoa/shared";

export type Bot = (view: PlayerView) => Order[];

export const ATTACK_SCRIPT = `// Go for the enemy base. Fight units first; hit buildings only when no unit is near.
const units = self.nearbyEnemies().filter((e) => !e.isBuilding);
const target = units[0] || self.nearestEnemy();
if (target && self.distanceTo(target) <= self.range) self.attack(target);
else if (target) self.moveTo(target.x, target.y);
else { const b = self.enemyBase(); if (b) self.moveTo(b.x, b.y); else self.hold(); }
`;

export const DEFEND_SCRIPT = `// Stay near home and fight intruders.
const home = self.myBase();
const e = self.nearestEnemy();
if (e && self.distanceTo(e) <= self.range) self.attack(e);
else if (e && home && self.distanceToPos(e.x, e.y) <= 6) self.moveTo(e.x, e.y);
else if (home && self.distanceToPos(home.x, home.y) > 3) self.moveTo(home.x, home.y);
else self.hold();
`;

export const KITE_SCRIPT = `// Rangers: shoot from range, step away from melee, never stand still next to a knight.
const e = self.nearestEnemy();
const b = self.enemyBase();
if (e && !e.isBuilding && self.distanceTo(e) <= 2) self.flee(e);
else if (e && self.distanceTo(e) <= self.range) self.attack(e);
else if (e) self.moveTo(e.x, e.y);
else if (self.memory.go && b) self.moveTo(b.x, b.y);
else self.hold();
`;

const count = (v: PlayerView, kind: string) => v.mine.filter((e) => e.kind === kind).length;
const castle = (v: PlayerView) => v.mine.find((e) => (e.kind === "castle" || e.kind === "nexus"));
const capital = (v: PlayerView) => v.players.find((p) => p.id === v.you)!.capital ?? 0;

/** Spends capital on workers up to `workers`, then on `army` units. */
function spend(v: PlayerView, workers: number, reserve = 0, army = "knight"): Order[] {
  const n = castle(v);
  if (!n) return [];
  const out: Order[] = [];
  let cap = capital(v) - reserve;
  let w = count(v, "worker");
  while (w < workers && cap >= 50) {
    out.push({ type: "train", building: n.id, kind: "worker" });
    cap -= 50;
    w++;
  }
  const cost = army === "ranger" ? 120 : 100;
  while (w >= workers && cap >= cost) {
    out.push({ type: "train", building: n.id, kind: army });
    cap -= cost;
  }
  return out;
}

/** Keeps the script for `kind` set to `code`. */
function ensureScript(v: PlayerView, code: string, state: { set?: string }, kind = "knight"): Order[] {
  if (state.set === code) return [];
  state.set = code;
  return [{ type: "script", kind, code }];
}

/** Lean economy, early knights; once 5 are out they all attack and keep attacking. */
export function rush(): Bot {
  const s: { set?: string } = {};
  let committed = false;
  return (v) => {
    committed ||= count(v, "knight") >= 5;
    return [...ensureScript(v, committed ? ATTACK_SCRIPT : DEFEND_SCRIPT, s), ...spend(v, 6)];
  };
}

export function eco(): Bot {
  const s: { set?: string } = {};
  return (v) => {
    const knights = count(v, "knight");
    const script = knights >= 8 ? ATTACK_SCRIPT : DEFEND_SCRIPT;
    return [...ensureScript(v, script, s), ...spend(v, 9)];
  };
}

export function turtle(): Bot {
  const s: { set?: string } = {};
  const spots = [[7, 7], [7, 3], [3, 7]];
  return (v) => {
    const out: Order[] = [];
    const n = castle(v);
    const flip = n && n.x > 15;
    const turrets = count(v, "turret");
    const pending = v.mine.some((e) => e.order?.startsWith("build"));
    if (n && count(v, "worker") >= 5 && turrets < spots.length && !pending && capital(v) >= 150) {
      const [x, y] = spots[turrets];
      const w = v.mine.find((e) => e.kind === "worker");
      if (w) out.push({ type: "build", unit: w.id, kind: "turret", x: flip ? 31 - x : x, y: flip ? 31 - y : y });
      return out;
    }
    const script = count(v, "knight") >= 10 ? ATTACK_SCRIPT : DEFEND_SCRIPT;
    return [...ensureScript(v, script, s), ...spend(v, 6, turrets < spots.length ? 150 : 0)];
  };
}

/** Eco into rangers that kite: tests whether a good script beats raw numbers. */
export function kite(): Bot {
  const s: { set?: string } = {};
  return (v) => {
    const go = count(v, "ranger") >= 8;
    const code = go ? KITE_SCRIPT.replace("self.memory.go", "true") : KITE_SCRIPT;
    return [...ensureScript(v, code, s, "ranger"), ...spend(v, 9, 0, "ranger")];
  };
}

/** The same army with the built-in ranger script (no micro), attacking with orders. */
export function archers(): Bot {
  return (v) => {
    const rangers = v.mine.filter((e) => e.kind === "ranger");
    const target = v.enemy.find((e) => (e.kind === "castle" || e.kind === "nexus"));
    const attack: Order[] = rangers.length >= 8 && target ? rangers.filter((r) => !r.order).map((r) => ({ type: "attack", unit: r.id, target: target.id })) : [];
    return [...attack, ...spend(v, 9, 0, "ranger")];
  };
}

export const BOTS: Record<string, () => Bot> = { rush, eco, turtle, kite, archers };
