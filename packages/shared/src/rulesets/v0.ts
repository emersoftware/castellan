import type { Ruleset } from "../ruleset";
import { MAPS } from "../maps";

const guardKnight = `// Built-in: fight what comes close, otherwise stay.
const e = self.nearestEnemy();
if (e && self.distanceTo(e) <= self.range) self.attack(e);
else if (e) self.moveTo(e.x, e.y);
else self.hold();
`;

const guardTurret = `// Built-in: shoot the weakest enemy in range.
const targets = self.enemiesInRange();
if (targets.length === 0) self.hold();
else self.attack(targets.reduce((a, b) => (b.hp < a.hp ? b : a)));
`;

export const v0: Ruleset = {
  version: "v0",
  matchMs: 600_000,
  prepMs: 60_000,
  startCapital: 200,
  popCap: 30,
  gather: { carry: 10, ms: 200 },
  buildExclusion: 8,
  kinds: {
    agent: { building: false, symbol: "A", enemySymbol: "a", hp: 400, def: 10, vision: 6, cost: 0, vital: true, moveMs: 500 },
    worker: {
      building: false, symbol: "W", enemySymbol: "w", hp: 40, def: 1, vision: 3, cost: 50,
      moveMs: 500, atk: 3, range: 1, attackMs: 1000, gathers: true, builds: ["turret", "wall"],
    },
    knight: {
      building: false, symbol: "K", enemySymbol: "k", hp: 80, def: 4, vision: 4, cost: 100,
      moveMs: 400, atk: 12, range: 1, attackMs: 1000, scriptable: true,
    },
    ranger: {
      building: false, symbol: "R", enemySymbol: "r", hp: 50, def: 2, vision: 6, cost: 120,
      moveMs: 380, atk: 12, range: 4, attackMs: 1000, scriptable: true,
    },
    nexus: {
      building: true, symbol: "N", enemySymbol: "n", hp: 600, def: 5, vision: 6, cost: 0,
      vital: true, trains: ["worker", "knight", "ranger"], dropoff: true,
      atk: 6, range: 4, attackMs: 1000, scriptable: true,
    },
    turret: {
      building: true, symbol: "T", enemySymbol: "t", hp: 150, def: 5, vision: 6, cost: 200,
      atk: 15, range: 5, attackMs: 1000, scriptable: true,
    },
    wall: { building: true, symbol: "#", enemySymbol: "%", hp: 300, def: 10, vision: 1, cost: 50 },
  },
  map: MAPS.open,
  script: { maxBytes: 4096, memoryBytes: 1024, gasPerUnit: 20, gasPerPlayer: 300, heapBytes: 8 * 1024 * 1024 },
  score: { unit: 10, building: 25, capital: 1, kill: 15, buildingKill: 30 },
  defaultScripts: { knight: guardKnight, ranger: guardTurret, turret: guardTurret, nexus: guardTurret },
  legend: {
    "·": "empty", $: "capital deposit",
    A: "agent (vital)", W: "worker", K: "knight", R: "ranger", N: "nexus (vital)", T: "turret", "#": "wall", "^": "rock (impassable terrain)",
    lowercase: "enemy (enemy wall is %)",
  },
};
