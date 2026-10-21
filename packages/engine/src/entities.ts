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
