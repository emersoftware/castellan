import type { Ruleset } from "../ruleset";
import { MAPS } from "../maps";
import { v7 } from "./v7";

const { agent: king, ...kinds } = v7.kinds;
const { A: _oldSymbol, ...legend } = v7.legend;

/** Rename the vital unit without altering stats or historical replay content. */
export const v8: Ruleset = {
  ...v7,
  version: "v8-king",
  kinds: { ...kinds, king: { ...king, symbol: "V", enemySymbol: "v" } },
  map: MAPS.open,
  legend: { ...legend, V: "king (vital)" },
};
