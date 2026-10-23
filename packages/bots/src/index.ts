/**
 * Reference bots. They exist to test and balance the game, never to play on a
 * ladder. A bot sees exactly what an LLM player sees (a PlayerView) and answers
 * with the same orders, so a bot with a decision delay models an LLM.
 */
import { rules, type BotName, type EntityKind, type Order, type PlayerView, type Ruleset } from "@castellan/shared";

export type Bot = (view: PlayerView) => Order[];

const ATTACK_SCRIPT = `// Go for the enemy base. Fight units first; hit buildings only when no unit is near.
const units = self.nearbyEnemies().filter((e) => !e.isBuilding);
const target = units[0] || self.nearestEnemy();
if (target) self.attack(target);
else { const b = self.enemyBase(); if (b) self.moveTo(b.x, b.y); else self.hold(); }
`;

const DEFEND_SCRIPT = `// Stay near home and fight intruders.
const home = self.myBase();
const e = self.nearestEnemy();
if (e && self.distanceTo(e) <= self.range) self.attack(e);
else if (e && home && self.distanceToPos(e.x, e.y) <= 6) self.moveTo(e.x, e.y);
else if (home && self.distanceToPos(home.x, home.y) > 3) self.moveTo(home.x, home.y);
else self.hold();
`;

const KITE_SCRIPT = `// Archers: shoot from range, step away from melee, never stand still next to a knight.
const e = self.nearestEnemy();
const b = self.enemyBase();
if (e && !e.isBuilding && self.distanceTo(e) <= 2) self.flee(e);
else if (e && self.distanceTo(e) <= self.range) self.attack(e);
else if (e) self.attack(e);
else if (self.memory.go && b) self.moveTo(b.x, b.y);
else self.hold();
`;

const count = (v: PlayerView, kind: EntityKind) => v.mine.filter((e) => e.kind === kind).length;
const castle = (v: PlayerView) => v.mine.find((e) => e.kind === "castle");
const mineral = (v: PlayerView) => v.players.find((p) => p.id === v.you)!.mineral ?? 0;
/** Whether one of your units has a build order, started or not. */
export const hasBuildOrder = (v: PlayerView) => v.mine.some((e) => e.order?.startsWith("build"));
const queued = (v: PlayerView, kind: EntityKind) => v.mine.reduce((n, e) => n + (e.training?.filter((j) => j.kind === kind).length ?? 0), 0);

/** Unlock once; do not submit production while research is still in progress. */
function unlock(v: PlayerView, kind: EntityKind, r: Ruleset, cap: number): Order[] {
  const id = r.kinds[kind]?.requires, p = v.players.find((p) => p.id === v.you)!;
  if (!id || (p.upgrades?.[id] ?? 0) > 0 || p.research) return [];
  const cost = r.upgrades[id]?.levels[0]?.cost;
  return cost !== undefined && cap >= cost ? [{ type: "upgrade", upgrade: id }] : [];
}
const locked = (v: PlayerView, kind: EntityKind, r: Ruleset) => {
  const id = r.kinds[kind]?.requires;
  return !!id && !(v.players.find((p) => p.id === v.you)!.upgrades?.[id]);
};

/** Public symmetric map geometry is an exploration goal, never hidden enemy state. */
function waypoints(v: PlayerView, r: Ruleset) {
  const home = castle(v) ?? { x: 4, y: 4 };
  const goal = { x: r.map.width - 1 - home.x, y: r.map.height - 1 - home.y };
  // Approach the contested centre before asking for a path inside a possibly
  // enclosed enemy base. From here fortress walls become visible attack targets.
  const centre = { x: (home.x < goal.x ? Math.floor : Math.ceil)((home.x + goal.x) / 2),
    y: (home.y < goal.y ? Math.floor : Math.ceil)((home.y + goal.y) / 2) };
  return { centre, goal };
}

function scouting(v: PlayerView, r: Ruleset, code: string): string {
  const { centre, goal } = waypoints(v, r);
  return code.replace("self.enemyBase()", `(self.enemyBase() || ((self.memory.scouted = self.memory.scouted || self.distanceToPos(${centre.x}, ${centre.y}) <= 2) ? ${JSON.stringify(goal)} : ${JSON.stringify(centre)}))`);
}

/** Spends mineral on workers up to `workers`, then on `army` units. */
function spend(v: PlayerView, r: Ruleset, workers: number, reserve = 0, army: EntityKind = "knight"): Order[] {
  const n = castle(v);
  if (!n) return [];
  const out: Order<EntityKind>[] = [];
  let cap = mineral(v) - reserve;
  const p = v.players.find((p) => p.id === v.you)!;
  let slots = Math.min(r.trainingQueueLimit - (n.training?.length ?? 0), r.popCap - (p.pop ?? 0) - (p.queuedPop ?? 0));
  let w = count(v, "worker") + queued(v, "worker");
  const workerCost = r.kinds.worker.cost;
  while (w < workers && cap >= workerCost && slots > 0) {
    out.push({ type: "train", building: n.id, kind: "worker" });
    cap -= workerCost;
    slots--;
    w++;
  }
  if (w < workers) return out;
  if (locked(v, army, r)) return [...out, ...unlock(v, army, r, cap)];
  const cost = r.kinds[army].cost;
  while (cap >= cost && slots > 0) {
    out.push({ type: "train", building: n.id, kind: army });
    cap -= cost;
    slots--;
  }
  return out;
}

/** Keeps the script for `kind` set to `code`. */
function ensureScript(code: string, state: { set?: string }, kind: EntityKind = "knight"): Order[] {
  if (state.set === code) return [];
  state.set = code;
  return [{ type: "script", kind, code }];
}

// Each bot's army size to attack with and its worker target. Tests and recorded benchmarks rely on these values.
const RUSH = { attackAt: 5, workers: 6 };
const ECO = { attackAt: 8, workers: 9 };
const TURTLE = { attackAt: 8, workers: 6, towersFromWorkers: 5, towerSpots: [{ x: 7, y: 7 }, { x: 7, y: 3 }, { x: 3, y: 7 }] };
const ARCHER_ARMY = { attackAt: 8, workers: 9 };

/** Lean economy, early knights; once RUSH.attackAt are out they all attack and keep attacking. */
export function rush(r: Ruleset = rules): Bot {
  const s: { set?: string } = {};
  let committed = false;
  return (v) => {
    committed ||= count(v, "knight") >= RUSH.attackAt;
    return [...ensureScript(committed ? scouting(v, r, ATTACK_SCRIPT) : DEFEND_SCRIPT, s), ...spend(v, r, RUSH.workers)];
  };
}

export function eco(r: Ruleset = rules): Bot {
  const s: { set?: string } = {};
  return (v) => {
    const knights = count(v, "knight");
    const script = knights >= ECO.attackAt ? scouting(v, r, ATTACK_SCRIPT) : DEFEND_SCRIPT;
    return [...ensureScript(script, s), ...spend(v, r, ECO.workers)];
  };
}

function turtle(r: Ruleset = rules): Bot {
  const s: { set?: string } = {};
  const spots = TURTLE.towerSpots;
  return (v) => {
    const out: Order<EntityKind>[] = [];
    const n = castle(v);
    const flip = n && n.x > r.map.width / 2;
    const towers = count(v, "tower");
    const pending = hasBuildOrder(v);
    const towerCost = r.kinds.tower.cost;
    if (n && count(v, "worker") >= TURTLE.towersFromWorkers && towers < spots.length && !pending && mineral(v) >= towerCost) {
      if (locked(v, "tower", r)) {
        const research = unlock(v, "tower", r, mineral(v));
        if (research.length) return research;
      } else {
        const { x, y } = spots[towers];
        const w = v.mine.find((e) => e.kind === "worker");
        if (w) out.push({ type: "build", unit: w.id, kind: "tower", x: flip ? r.map.width - 1 - x : x, y: flip ? r.map.height - 1 - y : y });
        return out;
      }
    }
    const script = count(v, "knight") >= TURTLE.attackAt ? scouting(v, r, ATTACK_SCRIPT) : DEFEND_SCRIPT;
    return [...ensureScript(script, s), ...spend(v, r, TURTLE.workers, towers < spots.length ? towerCost : 0)];
  };
}

/** Eco into archers that kite: tests whether a good script beats raw numbers. */
function kite(r: Ruleset = rules): Bot {
  const s: { set?: string } = {};
  return (v) => {
    const go = count(v, "archer") >= ARCHER_ARMY.attackAt;
    const code = go ? scouting(v, r, KITE_SCRIPT.replace("self.memory.go", "true")) : KITE_SCRIPT;
    return [...ensureScript(code, s, "archer"), ...spend(v, r, ARCHER_ARMY.workers, 0, "archer")];
  };
}

/** The same army with the built-in archer script (no micro), attacking with orders. */
function archers(r: Ruleset = rules): Bot {
  const scouted = new Set<string>();
  return (v) => {
    const archers = v.mine.filter((e) => e.kind === "archer");
    const { centre, goal } = waypoints(v, r);
    for (const unit of archers) if (Math.hypot(unit.x - centre.x, unit.y - centre.y) <= 2) scouted.add(unit.id);
    const target = v.enemy.find((e) => e.kind === "castle")
      ?? [...v.enemy].sort((a, b) => Math.min(...archers.map((u) => Math.hypot(a.x - u.x, a.y - u.y)))
        - Math.min(...archers.map((u) => Math.hypot(b.x - u.x, b.y - u.y))))[0];
    const attack: Order[] = archers.length >= ARCHER_ARMY.attackAt ? archers.filter((unit) => {
      if (target) return unit.order !== `attack ${target.id}`;
      const point = scouted.has(unit.id) ? goal : centre;
      return unit.order !== `move ${point.x},${point.y}`;
    }).map((unit) => target
      ? ({ type: "attack", unit: unit.id, target: target.id })
      : ({ type: "move", unit: unit.id, ...(scouted.has(unit.id) ? goal : centre) })) : [];
    return [...attack, ...spend(v, r, ARCHER_ARMY.workers, 0, "archer")];
  };
}

const bots = { rush, eco, turtle, kite, archers } satisfies Record<BotName, (r?: Ruleset) => Bot>;
export const BOTS: Record<string, (r?: Ruleset) => Bot> = bots;
