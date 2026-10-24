/**
 * The rules: every number, every kind of entity and the starting map. The engine
 * contains no stats of its own, so balancing is editing this file.
 *
 * Times are in milliseconds; the engine converts them to ticks, so changing the
 * tick rate does not change the balance.
 */
import { MAPS } from "./maps.ts";
import type { Ruleset } from "./ruleset.ts";

export const rules: Ruleset = {
  version: "0.30.0",
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
  lastAttackerMs: 5000,
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
      aimMs: 100,
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
    wizard: {
      building: false,
      symbol: "Z",
      enemySymbol: "z",
      hp: 45,
      def: 0,
      vision: 8,
      cost: 200,
      moveMs: 500,
      scriptable: true,
      trainMs: 12000,
      heals: { hpPerSecond: 6, range: 3 },
      intrusion: {
        upgrade: "intrusion",
        unitRange: 7,
        buildingRange: 1,
        unitChannel: { minMs: 3000, maxMs: 7000 },
        buildingChannel: { minMs: 6000, maxMs: 10000 },
        rollMs: 1000,
        chance: 0.38,
        rechargeMs: 20000,
      },
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
    wall: { building: true, symbol: "#", enemySymbol: "%", hp: 300, def: 10, vision: 1, cost: 25, buildMs: 3000, barrier: true },
    castle: {
      building: true,
      symbol: "C",
      enemySymbol: "c",
      hp: 600,
      def: 7,
      vision: 7,
      cost: 300,
      vital: false,
      trains: ["worker", "knight", "archer", "wizard"],
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
    // Level 1: hack and convert units; level 2: also hack adjacent buildings.
    intrusion: {
      kind: "wizard",
      stat: "intrusion",
      levels: [{ cost: 300, researchMs: 20000, value: 1 }, { cost: 400, researchMs: 30000, value: 2 }],
    },
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
  script: { maxBytes: 4096, memoryBytes: 1024, gasPerUnit: 20, gasPerPlayer: 300, heapBytes: 8388608, stackBytes: 262144 },
  defaultScripts: {
    knight: `// Built-in: fight what comes close, otherwise stay.
const e = self.nearestEnemy();
if (e && self.distanceTo(e) <= self.range) self.attack(e);
else if (e) self.moveTo(e.x, e.y);
else self.hold();
`,
    archer: `// Built-in: shoot the weakest enemy in range.
const targets = self.enemiesInRange();
if (targets.length === 0) self.hold();
else self.attack(targets.reduce((a, b) => (b.hp < a.hp ? b : a)));
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
    wizard: `// Built-in: heal the most wounded friendly unit in reach; otherwise convert the nearest enemy unit in range when able.
const hurt = self.nearbyAllies().filter((a) => !a.isBuilding && a.hp < a.maxHp && self.distanceTo(a) <= self.healRange);
if (hurt.length) self.heal(hurt.reduce((a, b) => (b.maxHp - b.hp > a.maxHp - a.hp ? b : a)));
else {
  // Keep converting the channel's target while it is in sight (switching restarts the channel); otherwise the nearest in range.
  const enemies = self.nearbyEnemies().filter((e) => !e.isBuilding && !e.vital && !e.ruin);
  const current = self.channel && enemies.find((e) => e.id === self.channel.target);
  const prey = current || (self.intrusion.units && self.rechargeReadyInTicks === 0 ? enemies.find((e) => self.distanceTo(e) <= self.intrusionRange) : null);
  if (prey) self.convert(prey);
  else self.hold();
}`,
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
    Z: "wizard",
  },
  map: MAPS.open,
};
