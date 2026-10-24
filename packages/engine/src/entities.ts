import type { ActionFeedback, Doing, KindSpec, PlayerId, EntityKind, OrderEndReason, UnitOrder } from "@castellan/shared";
import type { ScriptActionResult, ScriptEvent } from "@castellan/sandbox";

export type Intent =
  /** `reason`: why a requested action could not proceed; `status` "cooldown" when it only has to wait; `end` what that does to an order. */
  | { t: "hold"; reason?: string; status?: "cooldown"; end?: OrderEndReason }
  | { t: "heal"; id: string }
  /** One tick of a hack or convert channel, in range of its target. */
  | { t: "channel"; action: "hack" | "convert"; id: string }
  | { t: "goto"; x: number; y: number; range: number }
  | { t: "dir"; dx: number; dy: number }
  | { t: "attack"; id: string }
  | { t: "shoot"; x: number; y: number }
  | { t: "gather"; id: string }
  | { t: "unload"; id: string }
  | { t: "build" };

export interface Entity {
  id: string;
  kind: EntityKind;
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
  construction?: { kind: EntityKind; x: number; y: number; completesAtTick: number };
  training?: { kind: EntityKind; completesAtTick?: number }[];
  /**
   * A script a hack installed for this entity alone: the player whose VM runs it and its name there. Owner and team stay.
   * Hypno (compromised) while the controller is not the owner; an owner's own Wizard can install its owner's code.
   */
  payload?: { controller: PlayerId; script: string };
  /**
   * A hack or convert under way. `player` decided for the caster when it started and its VM holds `script`, the frozen
   * payload (none when a recovery restores the kind script); the caster's owner gives its research and side. The whole
   * record is hashed, `startTick` included: recorded 0.30 matches depend on its bytes.
   */
  channel?: { action: "hack" | "convert"; target: string; player: PlayerId; script?: string; startTick: number; progress: number; required: number };
  /** The unit this healer heals, and for how many consecutive ticks: healing accrues by elapsed time. */
  healing?: { target: string; ticks: number };
  /** Hack and convert are ready again from this tick. */
  rechargeUntil?: number;
}

/** The player whose VM decides for `e`: the controller of its payload, otherwise its owner. */
export const executorOf = (e: Readonly<Entity>): PlayerId => e.payload?.controller ?? e.owner;
/** Hypno: it runs a script another player installed; its owner can neither order it nor reach it with uploads. */
export const compromised = (e: Readonly<Entity>): boolean => !!e.payload && e.payload.controller !== e.owner;

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
