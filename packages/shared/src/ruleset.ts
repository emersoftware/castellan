/**
 * A ruleset is all the game content: every number, every kind of entity and
 * the starting map. The engine contains no stats of its own, so balancing is
 * editing a ruleset (see docs/balance.md).
 *
 * Times are in milliseconds; the engine converts them to ticks, so changing the
 * tick rate does not change the balance.
 */
export interface Ruleset {
  version: string;
  /** Match length before the timeout rule decides. */
  matchMs: number;
  /** Clock-stopped phase where players may read rules and upload scripts. */
  prepMs: number;
  startCapital: number;
  /** Max living units per player (buildings don't count). */
  popCap: number;
  gather: { carry: number; ms: number };
  /**
   * No building may be placed within this Chebyshev distance of an enemy
   * building. Zero allows building next to enemies, including tower rushes.
   */
  buildExclusion: number;
  kinds: Record<string, KindSpec>;
  map: MapSpec;
  script: ScriptLimits;
  score: { unit: number; building: number; capital: number; kill: number; buildingKill: number };
  /** Script each scriptable kind runs until the player uploads its own. */
  defaultScripts: Record<string, string>;
  /** ASCII legend shown to players. */
  legend: Record<string, string>;
}

/**
 * One kind of entity. Units and buildings share this shape: behaviour comes
 * from the capabilities present (moveMs → mobile, atk → attacks, trains → can
 * train, …), never from the kind's name.
 */
export interface KindSpec {
  building: boolean;
  /** ASCII symbol for the owner's view; the enemy sees `enemySymbol`. */
  symbol: string;
  enemySymbol: string;
  hp: number;
  def: number;
  vision: number;
  /** Capital to train (units) or build (buildings). 0 = not producible. */
  cost: number;
  /** Losing any vital entity loses the match. */
  vital?: boolean;
  /** Present on mobile kinds: time to step one tile (any of 8 directions). */
  moveMs?: number;
  /** Present on kinds that attack. */
  atk?: number;
  range?: number;
  attackMs?: number;
  /** Runs a player script when it has no order. */
  scriptable?: boolean;
  /** Can extract capital from deposits. */
  gathers?: boolean;
  /** Building kinds this unit can place. */
  builds?: string[];
  /** Unit kinds this building produces. */
  trains?: string[];
  /** Gatherers unload capital next to it. */
  dropoff?: boolean;
}

export interface MapSpec {
  name: string;
  description: string;
  width: number;
  height: number;
  /**
   * Starting corners: 2 (default; the layout and its 180° rotation) or 4 (a
   * square map; also rotated 90° and 270°, one corner per player).
   */
  seats?: 2 | 4;
  /** Impassable terrain (rock walls). Full list; keep it symmetric under every seat's rotation. */
  walls: { x: number; y: number }[];
  /** The first seat's corner. Every other seat gets the same layout, rotated. */
  start: { kind: string; x: number; y: number }[];
  deposits: { x: number; y: number; amount: number }[];
  /** Deposits placed once (they should be symmetric by themselves). */
  sharedDeposits: { x: number; y: number; amount: number }[];
}

export interface ScriptLimits {
  maxBytes: number;
  /** Max JSON size of one unit's `self.memory`. */
  memoryBytes: number;
  /** QuickJS interrupt cycles (~10k operations each) per unit run. */
  gasPerUnit: number;
  /** Interrupt cycles for all of a player's units in one tick. */
  gasPerPlayer: number;
  heapBytes: number;
}
