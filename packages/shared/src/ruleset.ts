/** Every kind of entity in today's rules (see rules.ts). */
export const ENTITY_KINDS = ["worker", "king", "knight", "archer", "wizard", "castle", "tower", "wall", "door"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/**
 * The shape of the rules (see rules.ts): every number, every kind of entity and the
 * starting map. Times are in milliseconds; the engine converts them to ticks.
 * Matches without a winner use `drawsAreLosses` to classify their result.
 */
export interface Ruleset {
  version: string;
  /** Match length before the time limit; four-seat maps use `fourSeatMatchMs` (see `matchLengthMs`). */
  matchMs: number;
  fourSeatMatchMs: number;
  /** Everyone loses when a match ends without a winner; false makes it a draw. */
  drawsAreLosses: boolean;
  /** Clock-stopped phase where players may read rules and upload scripts. */
  prepMs: number;
  startMineral: number;
  /** Max living units per player (buildings don't count). */
  popCap: number;
  gather: { carry: number; ms: number };
  /**
   * No building may be placed within this distance (see `dist`) of an enemy
   * building. Zero allows building next to enemies, including tower rushes.
   */
  buildExclusion: number;
  /** Maximum paid units waiting/working at each producer. */
  trainingQueueLimit: number;
  /** A diagonal step takes this many times a straight one; paths account for it. */
  diagonalMove: number;
  /** Coordinate departing friendly units and spread shared move destinations. */
  coordinatedMovement: boolean;
  /** Price paths using this unit's rounded straight/diagonal tick durations. Absent preserves old routes. */
  tickPathCosts: boolean;
  /** An enemy that damages one of your entities stays visible to you this long, wherever it is (0: never). */
  revealAttackerMs: number;
  /** A unit's `lastAttacker()` names an enemy that hit it within this time. */
  lastAttackerMs: number;
  /** Scripts perceive everything the player sees ("player"), or only within the unit's own vision ("unit"). */
  scriptSight: "player" | "unit";
  /** Run scripts during orders, with explicit interruption controls and event callbacks; false lets orders run first. */
  reactiveOrders: boolean;
  /**
   * Ranged attacks are real projectiles (Euclidean tiles/s). Only hostile entities stop
   * them, never rock; `flyOver` building kinds are hit only by a shot aimed at them.
   * `blindSpot`: nothing closer to the shooter than its `minRange` can be hit along the path.
   */
  projectiles: { speed: number; unitRadius: number; buildingRadius: number; flyOver: EntityKind[]; blindSpot: boolean };
  kinds: Record<string, KindSpec>;
  /** Research belongs to a player and affects one kind. */
  upgrades: Record<string, UpgradeSpec>;
  map: MapSpec;
  script: ScriptLimits;
  score: { unit: number; building: number; mineral: number; kill: number; buildingKill: number };
  /** Script each scriptable kind runs until the player uploads its own. */
  defaultScripts: Record<string, string>;
  /** ASCII legend shown to players. */
  legend: Record<string, string>;
}

interface UpgradeSpec {
  kind: EntityKind;
  /**
   * "unlock" makes the kind producible (see KindSpec.requires); its level value is unused.
   * "intrusion" opens the kind's intrusion targets level by level (see IntrusionSpec.upgrade); it changes no stat.
   */
  stat: "atk" | "attackMs" | "moveMs" | "range" | "unlock" | "intrusion";
  /**
   * Absolute resulting stat values, bought in order. One research at a time per player.
   * `vision` optionally raises sight with the same level (a longer range needs it to see targets).
   */
  levels: { cost: number; researchMs: number; value: number; vision?: number }[];
}

/**
 * One kind of entity. Units and buildings share this shape: behaviour comes
 * from the capabilities present (moveMs → mobile, atk → attacks, trains → can
 * train, …), never from the kind's name.
 */
export interface KindSpec {
  building: boolean;
  /** One-tile door: allied units may share its tile, enemies may not. */
  alliedPassage?: boolean;
  /** A piece of wall line: doors must sit straight along these (and other doors), never on a corner or junction. */
  barrier?: boolean;
  /** ASCII symbol for the owner's view; the enemy sees `enemySymbol`. */
  symbol: string;
  enemySymbol: string;
  hp: number;
  def: number;
  vision: number;
  /** Mineral to train (units) or build (buildings). 0 = not producible. */
  cost: number;
  /** Research that must be completed before this kind can be trained or built, or its other research started. */
  requires?: string;
  /** Time a builder must work adjacent to a free site. Omitted means instant. */
  buildMs?: number;
  /** Production time per unit. Omitted means instant. */
  trainMs?: number;
  /** Losing any vital entity loses the match. */
  vital?: boolean;
  /** Present on mobile kinds: time to step one tile (any of 8 directions). */
  moveMs?: number;
  /** Present on kinds that attack. */
  atk?: number;
  range?: number;
  /** Blind spot: targets closer than this can't be attacked (a tower can't shoot at its own foot). */
  minRange?: number;
  attackMs?: number;
  /** After a step, a mobile attacker must stand still this long before it attacks. */
  aimMs?: number;
  /** Runs a player script; reactiveOrders also runs it during a persistent order. */
  scriptable?: boolean;
  /** Can extract mineral from deposits. */
  gathers?: boolean;
  /** Building kinds this unit can place. */
  builds?: EntityKind[];
  /** Unit kinds this building produces. */
  trains?: EntityKind[];
  /** Gatherers unload mineral next to it. */
  dropoff?: boolean;
  /** Heals one friendly unit within `range` (never itself or a building) while it keeps healing it; healers stack. */
  heals?: { hpPerSecond: number; range: number };
  /** Channelled hack (replace one entity's script) and convert (take a unit); see IntrusionSpec. */
  intrusion?: IntrusionSpec;
}

/**
 * Hack and convert. Both channel at a target, then share one recharge after a success. Vital kinds are immune.
 * A channel rolls `chance` once every `rollMs` from `minMs` and completes for certain at `maxMs`;
 * the rolls come from the match seed, so a replay repeats them.
 */
/** What each level of an intrusion research opens, in order (see IntrusionSpec.upgrade). */
export const INTRUSION_LEVELS = [
  { opens: "units", text: "hack and convert units" },
  { opens: "buildings", text: "also hack adjacent buildings" },
] as const;
type IntrusionTarget = (typeof INTRUSION_LEVELS)[number]["opens"];

/** What intrusion research at `level` opens. */
export const intrusionOpens = (level: number): Record<IntrusionTarget, boolean> =>
  ({ units: level > INTRUSION_LEVELS.findIndex((l) => l.opens === "units"), buildings: level > INTRUSION_LEVELS.findIndex((l) => l.opens === "buildings") });

/** The intrusion research level that opens `target`. */
export const intrusionLevel = (target: IntrusionTarget) => INTRUSION_LEVELS.findIndex((l) => l.opens === target) + 1;

export interface IntrusionSpec {
  /** The research whose levels open intrusion targets (INTRUSION_LEVELS). */
  upgrade: string;
  /** Range against units, and against buildings (1: adjacent). */
  unitRange: number;
  buildingRange: number;
  unitChannel: { minMs: number; maxMs: number };
  buildingChannel: { minMs: number; maxMs: number };
  rollMs: number;
  chance: number;
  /** After a successful hack or convert; healing and movement stay available. */
  rechargeMs: number;
}

export interface MapSpec {
  name: string;
  description: string;
  width: number;
  height: number;
  /**
   * Available starting corners: 2 (default; the layout and its 180° rotation)
   * or 4 (a square map; also rotated 90° and 270°). A three-player FFA leaves
   * one of the four corners empty.
   */
  seats?: 2 | 4;
  /** Impassable terrain (rock walls). Full list; keep it symmetric under every seat's rotation. */
  walls: { x: number; y: number }[];
  /** Visual skin only; these terrain tiles are always impassable and cannot be attacked. */
  wallStyle?: "rock" | "wall";
  /** Destructible wall ruins owned by the scenario, never a competing player. Absolute coordinates, placed once. */
  neutralWalls?: { x: number; y: number }[];
  /** The first seat's corner. Every other seat gets the same layout, rotated. */
  start: { kind: EntityKind; x: number; y: number }[];
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
  /** QuickJS stack per player VM: how deep a script may recurse. */
  stackBytes: number;
}

/** What a kind runs without a script of its own: it stays put. */
export const HOLD_SCRIPT = "self.hold();";

/** How long this ruleset's match lasts on its map. */
export const matchLengthMs = (r: Ruleset): number => (r.map.seats === 4 ? r.fourSeatMatchMs : r.matchMs);
