/**
 * The rules: every number, every kind of entity and the starting map. The engine
 * contains no stats of its own, so balancing is editing this file.
 *
 * Times are in milliseconds; the engine converts them to ticks, so changing the
 * tick rate does not change the balance.
 */
import { MAPS } from "./maps";
import type { Ruleset } from "./ruleset";

export const rules: Ruleset = {
  version: "0.29.0",
  matchMs: 600000,
  fourSeatMatchMs: 900000,
  drawsAreLosses: true,
  prepMs: 60000,
  startMineral: 200,
  popCap: 30,
  gather: { carry: 10, ms: 200 },
  buildExclusion: 0,
  trainingQueueLimit: 5,
  diagonalMove: 1.4,
  coordinatedMovement: true,
  tickPathCosts: true,
  revealAttackerMs: 2000,
  scriptSight: "player",
  reactiveOrders: true,
  projectiles: { speed: 16, unitRadius: 0.35, buildingRadius: 0.5, flyOver: ["wall", "door"], blindSpot: true },
  kinds: {
    worker: {
      building: false,
      symbol: "W",
      enemySymbol: "w",
      hp: 40,
      def: 1,
      vision: 3,
      cost: 50,
      moveMs: 500,
      atk: 3,
      range: 1,
      attackMs: 1000,
      gathers: true,
      builds: ["tower", "wall", "door", "castle"],
      trainMs: 5000,
      scriptable: true,
    },
    knight: {
      building: false,
      symbol: "K",
      enemySymbol: "k",
      hp: 100,
      def: 6,
      vision: 6,
      cost: 100,
      moveMs: 400,
      atk: 16,
      range: 1,
      attackMs: 1000,
      scriptable: true,
      trainMs: 8000,
      aimMs: 200,
    },
    archer: {
      building: false,
      symbol: "R",
      enemySymbol: "r",
      hp: 60,
      def: 3,
      vision: 7,
      cost: 100,
      moveMs: 400,
      atk: 12,
      range: 5,
      attackMs: 1000,
      scriptable: true,
      trainMs: 8000,
      aimMs: 400,
    },
    tower: {
      building: true,
      symbol: "T",
      enemySymbol: "t",
      hp: 240,
      def: 7,
      vision: 8,
      cost: 150,
      atk: 12,
      range: 7,
      minRange: 2,
      attackMs: 1000,
      scriptable: true,
      buildMs: 10000,
    },
    wall: { building: true, symbol: "#", enemySymbol: "%", hp: 300, def: 10, vision: 1, cost: 25, buildMs: 3000 },
    castle: {
      building: true,
      symbol: "C",
      enemySymbol: "c",
      hp: 600,
      def: 7,
      vision: 7,
      cost: 300,
      vital: false,
      trains: ["worker", "knight", "archer"],
      dropoff: true,
      atk: 12,
      range: 5,
      attackMs: 1000,
      scriptable: true,
      buildMs: 20000,
    },
    door: {
      building: true,
      symbol: "D",
      enemySymbol: "d",
      hp: 300,
      def: 10,
      vision: 1,
      cost: 40,
      alliedPassage: true,
      buildMs: 3000,
    },
    king: {
      building: false,
      symbol: "V",
      enemySymbol: "v",
      hp: 400,
      def: 10,
      vision: 6,
      cost: 0,
      vital: true,
      moveMs: 500,
      scriptable: true,
      atk: 3,
      range: 1,
      attackMs: 3000,
    },
  },
  upgrades: {
    // No unit needs research to be produced (v21d); research only improves them.
    knight_damage: {
      kind: "knight",
      stat: "atk",
      levels: [{ cost: 250, researchMs: 10000, value: 18 }, { cost: 350, researchMs: 15000, value: 20 }],
    },
    knight_cadence: {
      kind: "knight",
      stat: "attackMs",
      levels: [{ cost: 150, researchMs: 10000, value: 900 }, { cost: 250, researchMs: 15000, value: 800 }],
    },
    knight_mobility: { kind: "knight", stat: "moveMs", levels: [{ cost: 150, researchMs: 15000, value: 300 }] },
    archer_damage: {
      kind: "archer",
      stat: "atk",
      levels: [{ cost: 250, researchMs: 10000, value: 14 }, { cost: 350, researchMs: 15000, value: 16 }],
    },
    archer_cadence: {
      kind: "archer",
      stat: "attackMs",
      levels: [{ cost: 150, researchMs: 10000, value: 900 }, { cost: 250, researchMs: 15000, value: 800 }],
    },
    archer_mobility: { kind: "archer", stat: "moveMs", levels: [{ cost: 150, researchMs: 15000, value: 300 }] },
    worker_damage: {
      kind: "worker",
      stat: "atk",
      levels: [{ cost: 150, researchMs: 10000, value: 5 }, { cost: 250, researchMs: 15000, value: 7 }],
    },
    archer_range: { kind: "archer", stat: "range", levels: [{ cost: 200, researchMs: 15000, value: 6, vision: 8 }] },
    tower_range: {
      kind: "tower",
      stat: "range",
      levels: [
        { cost: 150, researchMs: 15000, value: 8, vision: 9 },
        { cost: 250, researchMs: 20000, value: 9, vision: 10 },
      ],
    },
  },
  score: { unit: 10, building: 25, mineral: 1, kill: 15, buildingKill: 30 },
  script: { maxBytes: 4096, memoryBytes: 1024, gasPerUnit: 20, gasPerPlayer: 300, heapBytes: 8388608 },
  defaultScripts: {
    knight: `// Built-in: fight what comes close, otherwise stay.
const e = self.nearestEnemy();
if (e && self.distanceTo(e) <= self.range) self.attack(e);
else if (e) self.moveTo(e.x, e.y);
else self.hold();
`,
    archer: `// Built-in: step away from closing melee while a step away exists, otherwise shoot the weakest enemy in range.
const melee = self.nearbyEnemies().find((e) => !e.isBuilding && e.range <= 1 && self.distanceTo(e) <= 2);
const dirs = { N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1] };
const away = melee && Object.entries(dirs).some(([dir, [dx, dy]]) =>
  self.canMove(dir) && Math.round(Math.hypot(self.x + dx - melee.x, self.y + dy - melee.y)) > self.distanceTo(melee));
if (away) { if (self.suspendOrder) self.suspendOrder(); self.flee(melee); }
else {
  if (self.continueOrder) self.continueOrder();
  const targets = self.enemiesInRange();
  if (targets.length === 0) self.hold();
  else self.attack(targets.reduce((a, b) => (b.hp < a.hp ? b : a)));
}
`,
    tower: `// Built-in: shoot the weakest enemy in range.
const targets = self.enemiesInRange();
if (targets.length === 0) self.hold();
else self.attack(targets.reduce((a, b) => (b.hp < a.hp ? b : a)));
`,
    castle: `// Built-in: shoot the weakest enemy in range.
const targets = self.enemiesInRange();
if (targets.length === 0) self.hold();
else self.attack(targets.reduce((a, b) => (b.hp < a.hp ? b : a)));
`,
    worker: `// Mine automatically; upload a script to choose combat or escape.
self.gather();`,
    king: `// Defend against a recent attacker in reach; never chase.
const enemy = self.lastAttacker();
if (enemy && self.distanceTo(enemy) <= self.range) self.attack(enemy);
else self.hold();`,
  },
  legend: {
    "·": "empty",
    $: "mineral deposit",
    W: "worker",
    K: "knight",
    R: "archer",
    T: "tower",
    "#": "wall",
    "^": "rock (impassable terrain)",
    lowercase: "enemy (enemy wall is %)",
    "+": "allied unit (2v2)",
    "=": "allied building (2v2)",
    "?": "unexplored",
    ":": "explored ground outside current vision",
    C: "castle (production and resource dropoff; not vital)",
    D: "door (one tile; allied passage only)",
    V: "king (vital)",
  },
  map: MAPS.open,
};
