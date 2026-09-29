import type { Ruleset } from "../ruleset";
import { CASTLE_MAPS as MAPS } from "../maps";
import { v6 } from "./v6";

const { nexus, ...kinds } = v6.kinds;
const { nexus: castleScript, ...scripts } = v6.defaultScripts;
const { N: _oldSymbol, ...legend } = v6.legend;

/** One-tile allied doors and the castle name; old replay rules stay untouched. */
export const v7: Ruleset = {
  ...v6,
  version: "v7-castle-doors",
  kinds: {
    ...kinds,
    worker: { ...kinds.worker, builds: ["turret", "wall", "door", "castle"] },
    castle: { ...nexus, symbol: "C", enemySymbol: "c" },
    door: { building: true, symbol: "D", enemySymbol: "d", hp: 300, def: 10, vision: 1, cost: 75, alliedPassage: true },
  },
  map: MAPS.open,
  defaultScripts: { ...scripts, castle: castleScript },
  legend: { ...legend, C: "castle (production and resource dropoff; not vital)", D: "door (one tile; allied passage only)" },
};
