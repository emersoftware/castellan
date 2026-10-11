/** Shared shapes of the player: plan, tasks, episodes and journal entries. */
import type { PlayerId } from "@aoa/shared";
import type { Pt } from "./geometry";

export type Posture = "boom" | "defend" | "attack" | "retreat";

export type TaskStatus = "pending" | "assigned" | "started" | "done" | "failed" | "cancelled";

export interface BuildTask {
  id: string;
  kind: "tower" | "wall" | "door" | "castle";
  x: number;
  y: number;
  /** Lower runs first. */
  priority: number;
  label: string;
  status: TaskStatus;
  worker?: string;
  attempts: number;
  createdTick: number;
  updatedTick: number;
  /** Tick when the build order was last accepted. */
  orderedTick?: number;
  reason?: string;
  episode?: string;
  /** Minimum mineral to keep for it while active; the engine charges on completion. */
  reserve: number;
  /** Built only from spare mineral: never holds production back. */
  surplus?: boolean;
}

export type EpisodeStatus = "active" | "completed" | "failed_execution" | "failed_outcome" | "abandoned";

/** A plan with a goal, so the journal can tell execution failures from bad strategic outcomes. */
export interface Episode {
  id: string;
  kind: "expansion" | "attack" | "defense" | "keep" | "fortify" | "scout" | "research" | "diplomacy";
  label: string;
  source: string;
  startedTick: number;
  endedTick?: number;
  status: EpisodeStatus;
  notes: string[];
  result?: string;
}

export interface Sighting {
  id: string;
  kind: string;
  owner: PlayerId;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  tick: number;
  building: boolean;
}

export interface ThreatGroup {
  units: Sighting[];
  strength: number;
  x: number;
  y: number;
  owner: PlayerId;
  /** Closest own asset and its distance. */
  near: { id: string; kind: string; d: number } | null;
  tick: number;
}

export interface Expansion {
  clusterId: string;
  site: Pt;
  status: "scouting" | "building" | "built" | "lost" | "abandoned";
  castleId?: string;
  since: number;
  fortify: boolean;
  taskId?: string;
  episode: string;
  /** Workers assigned to this expansion's deposits. */
  workers: number;
}

export interface AttackPlan {
  target: Pt;
  targetId?: string;
  owner?: PlayerId;
  since: number;
  startStrength: number;
  units: string[];
  episode: string;
  lastProgressTick: number;
  /** The force assembled at the rally point before marching. */
  staged: boolean;
}

export interface Plan {
  posture: Posture;
  postureSince: number;
  postureReason: string;
  workersTarget: number;
  composition: { knight: number; archer: number };
  armyTarget: number;
  rally: Pt;
  safe: Pt;
  attack?: AttackPlan;
  lastRetreatTick: number;
  expansion?: Expansion;
  expansionsTried: number;
  builds: BuildTask[];
  research: string[];
  keep: { status: "none" | "planned" | "building" | "built"; cell: Pt; doors: Pt[]; walls: Pt[]; interior: Pt[] };
  truces: Record<PlayerId, { since: number; broken?: number; proposedBy: "me" | "them" }>;
  primaryEnemy?: PlayerId;
  scout?: { unit: string; waypoints: Pt[]; since: number; done?: boolean };
  /** Defence of the expansion decided for the current threat (cleared when it passes). */
  expansionDefense?: { choice: string; since: number; threatOwner: PlayerId };
  /** Decision taken for a home threat while attacking. */
  homeThreatChoice?: { choice: string; since: number };
}

export interface JournalEntry { t: number; tick: number; type: string; [key: string]: unknown }

export interface CoreStats {
  cycles: number;
  ordersSent: number;
  ordersRejected: number;
  rejectedByReason: Record<string, number>;
  scriptErrors: number;
  losses: Record<string, number>;
  kills: Record<string, number>;
  built: Record<string, number>;
  chatSent: number;
  chatReceived: number;
  mineralDelivered: Record<string, number>;
}
