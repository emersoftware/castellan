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
  version: "v21-validated",
  matchMs: 600000,
  fourSeatMatchMs: 900000,
  prepMs: 60000,
  startCapital: 200,
  popCap: 30,
  gather: { carry: 10, ms: 200 },
  buildExclusion: 0,
  trainingQueueLimit: 5,
  diagonalMove: 1.4,
  revealAttackerMs: 2000,
  scriptSight: "player",
  projectiles: { speed: 12, unitRadius: 0.35, buildingRadius: 0.5, flyOver: ["wall", "door"] },
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
      builds: ["turret", "wall", "door", "castle"],
      trainMs: 5000,
      scriptable: true,
    },
    knight: {
      building: false,
      symbol: "K",
      enemySymbol: "k",
      hp: 110,
      def: 6,
      vision: 6,
      cost: 100,
      moveMs: 500,
      atk: 17,
      range: 1,
      attackMs: 1000,
      scriptable: true,
      trainMs: 8000,
      aimMs: 100,
    },
    ranger: {
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
      requires: "archery",
      attackMs: 1000,
      scriptable: true,
      trainMs: 10000,
      aimMs: 400,
    },
    turret: {
      building: true,
      symbol: "T",
      enemySymbol: "t",
      hp: 160,
      def: 7,
      vision: 8,
      cost: 200,
      atk: 9,
      range: 7,
      minRange: 2,
      requires: "engineering",
      attackMs: 1000,
      scriptable: true,
      buildMs: 10000,
    },
    wall: { building: true, symbol: "#", enemySymbol: "%", hp: 300, def: 10, vision: 1, cost: 50, buildMs: 3000 },
    castle: {
      building: true,
      symbol: "C",
      enemySymbol: "c",
      hp: 600,
      def: 7,
      vision: 7,
      cost: 600,
      vital: false,
      trains: ["worker", "knight", "ranger"],
      dropoff: true,
      atk: 9,
      range: 6,
      attackMs: 1000,
      scriptable: true,
      buildMs: 30000,
    },
    door: {
      building: true,
      symbol: "D",
      enemySymbol: "d",
      hp: 300,
      def: 10,
      vision: 1,
      cost: 75,
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
    archery: { kind: "ranger", stat: "unlock", levels: [{ cost: 100, researchMs: 3000, value: 1 }] },
    engineering: { kind: "turret", stat: "unlock", levels: [{ cost: 100, researchMs: 3000, value: 1 }] },
    knight_damage: {
      kind: "knight",
      stat: "atk",
      levels: [{ cost: 250, researchMs: 10000, value: 19 }, { cost: 350, researchMs: 15000, value: 21 }],
    },
    knight_cadence: {
      kind: "knight",
      stat: "attackMs",
      levels: [{ cost: 150, researchMs: 10000, value: 900 }, { cost: 250, researchMs: 15000, value: 800 }],
    },
    knight_mobility: { kind: "knight", stat: "moveMs", levels: [{ cost: 150, researchMs: 15000, value: 400 }] },
    ranger_damage: {
      kind: "ranger",
      stat: "atk",
      levels: [{ cost: 250, researchMs: 10000, value: 14 }, { cost: 350, researchMs: 15000, value: 16 }],
    },
    ranger_cadence: {
      kind: "ranger",
      stat: "attackMs",
      levels: [{ cost: 150, researchMs: 10000, value: 900 }, { cost: 250, researchMs: 15000, value: 800 }],
    },
    ranger_mobility: { kind: "ranger", stat: "moveMs", levels: [{ cost: 150, researchMs: 15000, value: 300 }] },
    worker_damage: {
      kind: "worker",
      stat: "atk",
      levels: [{ cost: 150, researchMs: 10000, value: 5 }, { cost: 250, researchMs: 15000, value: 7 }],
    },
    ranger_range: { kind: "ranger", stat: "range", levels: [{ cost: 200, researchMs: 15000, value: 6, vision: 8 }] },
    turret_range: {
      kind: "turret",
      stat: "range",
      levels: [
        { cost: 150, researchMs: 15000, value: 8, vision: 9 },
        { cost: 250, researchMs: 20000, value: 9, vision: 10 },
      ],
    },
  },
  score: { unit: 10, building: 25, capital: 1, kill: 15, buildingKill: 30 },
  script: { maxBytes: 4096, memoryBytes: 1024, gasPerUnit: 20, gasPerPlayer: 300, heapBytes: 8388608 },
  defaultScripts: {
    knight: `// Built-in: fight what comes close, otherwise stay.
const e = self.nearestEnemy();
if (e && self.distanceTo(e) <= self.range) self.attack(e);
else if (e) self.moveTo(e.x, e.y);
else self.hold();
`,
    ranger: `// Built-in: shoot the weakest enemy in range.
const targets = self.enemiesInRange();
if (targets.length === 0) self.hold();
else self.attack(targets.reduce((a, b) => (b.hp < a.hp ? b : a)));
`,
    turret: `// Built-in: shoot the weakest enemy in range.
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
    $: "capital deposit",
    W: "worker",
    K: "knight",
    R: "ranger",
    T: "turret",
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
