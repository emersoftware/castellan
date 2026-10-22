import type { ActionFeedback, Doing, KindSpec, PlayerId, RecordedKind, UnitOrder } from "@castellan/shared";
import type { ScriptActionResult, ScriptEvent } from "@castellan/sandbox";

export type Intent =
  | { t: "hold" }
  | { t: "goto"; x: number; y: number; range: number }
  | { t: "dir"; dx: number; dy: number }
  | { t: "attack"; id: string }
  | { t: "shoot"; x: number; y: number }
  | { t: "gather"; id: string }
  | { t: "unload"; id: string }
  | { t: "build" };

export interface Entity {
  id: string;
  kind: RecordedKind;
  spec: KindSpec;
  owner: PlayerId;
  x: number;
  y: number;
  hp: number;
  order: UnitOrder | null;
  orderSuspended?: boolean;
  /** Stable arrival tile for a shared explicit move destination. */
  moveTarget?: { x: number; y: number };
  scriptEvents?: ScriptEvent[];
  seenEnemies?: string[];
  nextMove: number;
  nextAttack: number;
  nextGather: number;
  carrying: number;
  path: number[] | null;
  pathKey: string;
  /** Consecutive ticks a unit stood in its way. */
  blocked: number;
  /** Last tick's intent, in words, for the owner's view. */
  doing: Doing | "";
  lastStep: { dx: number; dy: number; tick: number } | null;
  lastAttacked?: { id: string; tick: number };
  /** Actual outcome of this unit's most recent script decision, available next tick. */
  lastActionResult?: ScriptActionResult;
  actionResult?: ActionFeedback;
  construction?: { kind: RecordedKind; x: number; y: number; completesAtTick: number };
  training?: { kind: RecordedKind; completesAtTick?: number }[];
}

export interface Deposit {
  id: string;
  x: number;
  y: number;
  amount: number;
}

/** A seat in the match: where it plays from, whose side it is on, and what it owns and has researched. */
export interface Player {
  id: PlayerId;
  /** Seat 0..3: which rotation of the map is home. Tie-breaks follow it so mirrored play stays mirrored. */
  side: number;
  team: number;
  name: string;
  mineral: number;
  kills: number;
  buildingKills: number;
  alive: boolean;
  /** Completed research levels by upgrade id. */
  upgrades: Record<string, number>;
  /** The one research in progress, applied to the player's units when it completes. */
  research: { upgrade: string; level: number; completesAtTick: number } | null;
}
