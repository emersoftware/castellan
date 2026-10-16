/** Everything that crosses the wire between the server and its clients. */
import type { RecordedKind } from "./ruleset";

export type PlayerId = string;
/** Reserved entity owner for inert scenario walls; never a participant or winner. */
export const NEUTRAL_OWNER = "neutral";
export const CHAT_CHANNELS = ["all", "team", "private"] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];
/** Whether untrusted input names a chat channel. */
export const isChatChannel = (value: unknown): value is ChatChannel => CHAT_CHANNELS.some((channel) => channel === value);

export interface ChatMessage {
  tick: number;
  from: PlayerId;
  name: string;
  text: string;
  channel?: ChatChannel;
  to?: PlayerId;
}

/**
 * A player's instruction. Scripts can explicitly interrupt unit orders under reactiveOrders rules.
 * Players may name any kind; code that produces orders can narrow `Kind` to the kinds it means.
 */
export type Order<Kind extends string = string> =
  | { type: "move"; unit: string; x: number; y: number }
  | { type: "attack"; unit: string; target: string }
  /** Omit `deposit` to use the nearest one. The worker keeps gathering until stopped. */
  | { type: "gather"; unit: string; deposit?: string }
  | { type: "build"; unit: string; kind: Kind; x: number; y: number }
  | { type: "train"; building: string; kind: Kind }
  /** Research the next level of a ruleset upgrade. Mineral is charged on acceptance. */
  | { type: "upgrade"; upgrade: string }
  /** Drop the unit's order; it goes back to its script or stays idle. */
  | { type: "stop"; unit: string }
  /** JavaScript body run every tick by each unit of `kind`. `null` restores the built-in script. */
  | { type: "script"; kind: Kind; code: string | null }
  /** Chat on required. `to` implies private; otherwise omitted channel means public. */
  | { type: "chat"; text: string; channel?: ChatChannel; to?: PlayerId };

/** A persistent instruction on one unit, also exposed privately to its script. */
export type UnitOrder =
  | { type: "move"; x: number; y: number }
  | { type: "attack"; target: string }
  | { type: "gather"; deposit?: string }
  | { type: "build"; kind: RecordedKind; x: number; y: number };

export interface MineralChange { spent: number; remaining: number; pending?: number }
export type OrderResult = ({ ok: true; id?: string } | { ok: false; reason: string }) & { mineral?: MineralChange };

export const MATCH_STATUSES = ["waiting", "prep", "running", "finished"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** Four-seat maps play in two teams of two unless the room asks for every player alone. */
export const ROOM_MODES = ["teams", "ffa"] as const;
export type RoomMode = (typeof ROOM_MODES)[number];
/** Whether untrusted input names a room mode. */
export const isRoomMode = (value: unknown): value is RoomMode => ROOM_MODES.some((mode) => mode === value);

/** What GET /status tells a harness about its seat, without counting as a player call. */
export interface SeatStatus { room: string; player: PlayerId; status: MatchStatus; tick: number; alive: boolean }
type SeatState = { status?: MatchStatus; alive?: boolean };
/** Nothing is left to play for the seat: its match finished or the seat is out. */
export const seatOver = (seat: SeatState) => seat.status === "finished" || seat.alive === false;
/** The seat's match takes orders. */
export const seatPlaying = (seat: SeatState) => seat.status === "running";
const HEADER = new RegExp(`^tick (\\d+)(?:.*? · (${MATCH_STATUSES.join("|")}) · )?`);
/** The seat as a text observation (`?format=text`) shows it: its header line, and YOU marked OUT. `tick` is NaN without a header. */
export function observedSeat(observation: string): SeatState & { tick: number } {
  const header = HEADER.exec(observation);
  return { status: MATCH_STATUSES.find((s) => s === header?.[2]), tick: Number(header?.[1]), alive: !/^YOU\s+.* · OUT$/m.test(observation) };
}

export interface SeriesProgress {
  id: string;
  gameNumber: number;
  totalGames: 3;
  status: "running" | "finished" | "error";
  score: Record<PlayerId, number>;
  /** Game losses; absent in older published series. */
  losses?: Record<PlayerId, number>;
  previousGames: number[];
}

export interface SeriesSummary {
  id: string;
  /** Optional editorial title for the public catalogue. */
  title?: string;
  createdAt: string;
  totalGames: 3;
  status: SeriesProgress["status"];
  currentGame: number;
  players: { id: PlayerId; name: string; team: number; bot?: string }[];
  score: Record<PlayerId, number>;
  /** Game losses; surviving a match does not imply winning it. */
  losses?: Record<PlayerId, number>;
  winners?: PlayerId[];
  /** Finished without a winning side under rules that count draws as losses. */
  allDefeated?: true;
  games: { number: number; roomId: string; status: MatchStatus; outcome?: Outcome }[];
}

export interface SeriesReplay {
  format: "aoa-series-v1";
  series: SeriesSummary;
  games: ReplayFile[];
}

export interface Outcome {
  /** The sole winner; null for no winner or when a team won (see `winners`). */
  winner: PlayerId | null;
  /** Every player on the winning side; empty means no winner, see `allDefeated`. Absent in replays older than teams. */
  winners?: PlayerId[];
  /** No winning side and every player loses. Absent in historical draws. */
  allDefeated?: true;
  reason: "vital_lost" | "timeout" | "forfeit";
  scores: Record<PlayerId, number>;
}

export interface EntityView {
  id: string;
  kind: RecordedKind;
  owner: PlayerId;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Whether losing this entity eliminates its owner under this replay's rules. */
  vital?: boolean;
  /** Door visual state: an allied unit currently occupies the passage. */
  open?: boolean;
  /** Effective stats (including upgrades), with timings quantized to the match tick. */
  stats?: { atk: number; def: number; range: number; attackMs: number; moveMs: number };
  /** Visible work at a site; the building does not exist or function until completion. */
  construction?: { kind: RecordedKind; x: number; y: number; completesAtMs: number };
  /** Private to owner (and omniscient spectators). Only the first entry is active. */
  training?: { kind: RecordedKind; completesAtMs?: number }[];
  /** Current order in words, e.g. "move 10,5", "gather d3". Absent = script/idle. */
  order?: string;
  /** The owner's script suspended this order; it can explicitly resume or cancel it. */
  orderSuspended?: boolean;
  /** History of the current manual order, private to its owner and spectators. */
  orderProgress?: OrderProgress;
  /** What the unit did last tick. Only for your own units. */
  doing?: Doing;
  /** Latest completed tick: intent and actual outcome, private to the owner. */
  actionResult?: ActionFeedback;
  /** Direction of its last step (↑ ↗ → ↘ ↓ ↙ ← ↖) if it moved in the last second. Everyone sees it. */
  heading?: string;
  /** An inert ruin that blocks and can be destroyed: eliminated owner or neutral scenario wall. */
  ruin?: boolean;
  /** Observer perspectives only: a remembered building outside this player's vision, as last seen at this time. */
  lastSeenMs?: number;
  /** Visible mining activity, facing the resource; no private order is exposed. */
  gathering?: { x: number; y: number };
  carrying?: number;
}

/** What a unit did last tick, in words. */
export type Doing = "hold" | "build" | "unload" | `→ ${number},${number}` | `step ${string}` | `attack ${string}` | `gather ${string}`;

export interface ActionFeedback {
  tick: number;
  source: "order" | "script";
  intent: string;
  status: "acted" | "blocked" | "cooldown" | "aiming" | "held" | "invalid" | "arrived" | "working";
  effect?: "move" | "attack" | "gather" | "unload";
  reason?: string;
}

/** Counters since the latest accepted manual unit order; absent after it ends. */
export interface OrderProgress {
  ageMs: number;
  /** Total time suspended, including earlier pauses of this order. */
  suspendedMs: number;
  /** Duration of the current uninterrupted suspension, or zero while running. */
  currentSuspensionMs: number;
  suspensions: number;
  movement: {
    /** Successful tile changes, including movement chosen by the script. */
    steps: number;
    /** Chebyshev displacement from the position where the order was issued. */
    netTiles: number;
    stationaryMs: number;
    /** Move orders only: initial minus current distance to the commanded point.
     * Positive = closer, negative = farther; this is not path length. */
    towardDestination?: number;
  };
  /** Successful script actions while this order was suspended; attacks count
   * launches/strikes, not hits. Cooldown/aiming/blocked attempts are excluded. */
  scriptActions: Partial<Record<NonNullable<ActionFeedback["effect"]>, number>>;
  /** Time with a blocked action result, excluding cooldown and aiming. */
  blockedMs: number;
}

export interface ActionAvailability {
  /** Current checks only; acceptance can change before the next tick. */
  train: { building: string; kind: RecordedKind; cost: number; queue: number; queueLimit: number; blockedBy: string[]; exitBlocked: boolean }[];
  build: { kind: RecordedKind; cost: number; blockedBy: string[]; siteCheckRequired: true }[];
  research: { upgrade: string; level: number; cost: number | null; blockedBy: string[] }[];
}

export interface CombatSummary {
  sinceTick: number;
  throughTick: number;
  /** Older observations exceeded the retained two-minute window. */
  truncated: boolean;
  encounters: { x: number; y: number; fromTick: number; toTick: number;
    damage: Record<PlayerId, number>;
    losses: { id: string; kind: RecordedKind; owner: PlayerId; x: number; y: number }[] }[];
}

/** What a connector reports its agent is doing (POST /agent-status). */
export const AGENT_ACTIVITY_STATES = ["deciding", "provider_wait", "connector_retry", "between_decisions", "stopped"] as const;

export interface AgentActivity {
  state: (typeof AGENT_ACTIVITY_STATES)[number];
  at: string;
  retryAt?: string;
}

/** A visible shot, in map coordinates; velocity is tiles/s, destination never tracks. */
export interface ProjectileView {
  id: string;
  owner: PlayerId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  endX: number;
  endY: number;
}

export interface DepositView {
  id: string;
  x: number;
  y: number;
  amount: number;
  /** Observer perspectives only: remembered outside this player's vision, as last seen at this time. */
  lastSeenMs?: number;
}

/** Economic stats are omitted for opponents behind fog; identity/team/alive stay public. */
export interface PlayerStats {
  id: PlayerId;
  name: string;
  mineral?: number;
  pop?: number;
  popCap: number;
  /** Paid training reservations; included when enforcing the population cap. */
  queuedPop?: number;
  score?: number;
  kills?: number;
  /** Players with the same team are allies. In 1v1 each player is its own team. */
  team: number;
  alive: boolean;
  /** Operational state, never inferred from a lack of orders. Owner/observer only. */
  scriptRuntime?: { status: "stopped"; tick: number; message: string };
  agentActivity?: AgentActivity;
  /** Present only in rulesets with research; public to both players and spectators. */
  upgrades?: Record<string, number>;
  research?: { upgrade: string; level: number; completesAtMs: number };
}

export type GameEvent =
  | { tick: number; type: "training_queued"; owner: PlayerId; building: string; kind: RecordedKind; position: number }
  | { tick: number; type: "construction_started"; owner: PlayerId; builder: string; kind: RecordedKind; x: number; y: number; completesAtMs: number }
  | { tick: number; type: "research_started"; owner: PlayerId; upgrade: string; level: number; completesAtMs: number; mineral: MineralChange }
  | { tick: number; type: "upgrade_completed"; owner: PlayerId; upgrade: string; level: number }
  | { tick: number; type: "attack"; from: string; to: string; dmg: number; projectile?: string }
  | { tick: number; type: "projectile_end"; id: string; x: number; y: number; target?: string; dmg: number; reason: "hit" | "blocked" | "miss" }
  | { tick: number; type: "death"; id: string; kind: RecordedKind; owner: PlayerId; x: number; y: number; by?: PlayerId }
  | { tick: number; type: "spawn"; id: string; kind: RecordedKind; owner: PlayerId; x: number; y: number; builder?: string; mineral?: MineralChange }
  | { tick: number; type: "unload"; id: string; owner: PlayerId; amount: number }
  | { tick: number; type: "depleted"; id: string }
  | { tick: number; type: "order_end"; id: string; owner: PlayerId; reason: OrderEndReason }
  | { tick: number; type: "script_error"; owner: PlayerId; kind: RecordedKind; unit?: string; message: string; operationalFailure?: true }
  | { tick: number; type: "log"; owner: PlayerId; unit: string; message: string }
  | { tick: number; type: "chat"; owner: PlayerId; text: string; channel?: ChatChannel; to?: PlayerId }
  /** A player lost its vital entity while its team plays on: its units are gone (and its buildings, unless the rules keep ruins). */
  | { tick: number; type: "eliminated"; owner: PlayerId }
  | { tick: number; type: "match_end"; outcome: Outcome };

/** Why a unit's order ended. */
export type OrderEndReason = "arrived" | "completed" | "replaced" | "stopped" | "cancelled by script" | "target lost" | "unreachable" | "tile blocked"
  | "site reserved by another builder" | "not enough mineral" | "too close to an enemy building" | "doors must stay on one wall axis; no corners or junctions"
  | "no deposits left" | "no dropoff";

/** The player an event belongs to, if any. */
export const eventOwner = (e: GameEvent): PlayerId | undefined => ("owner" in e ? e.owner : undefined);
/** The kind of entity an event is about, if any. */
export const eventKind = (e: GameEvent): RecordedKind | undefined => ("kind" in e ? e.kind : undefined);

export type LastSeen =
  | { id: string; kind: RecordedKind; owner: PlayerId; x: number; y: number; hp: number; maxHp: number; ruin?: boolean; entityType?: "unit"; positionCleared?: boolean; seenMs: number }
  | { id: string; kind: "deposit"; x: number; y: number; amount: number; seenMs: number };

export interface UnderAttack {
  id: string;
  kind: RecordedKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Damage taken in the window. */
  damage: number;
  attackers: { id: string; kind: RecordedKind; owner: PlayerId }[];
  unseenAttackers: number;
}

/** What one player sees. `tick` is the next tick to be simulated; use it as `since`. */
export interface PlayerView {
  series?: SeriesProgress;
  tick: number;
  timeMs: number;
  matchMs: number;
  /** If time expires without a winner, everyone loses. Absent in historical views. */
  drawsAreLosses?: boolean;
  status: MatchStatus;
  you: PlayerId;
  players: PlayerStats[];
  /** ASCII map, one string per row (y), one char per column (x). */
  grid: string[];
  /** 0 = unexplored, 1 = explored, 2 = currently visible. */
  visibility: string[];
  mine: EntityView[];
  /** Your teammates' entities (team matches only). */
  allies: EntityView[];
  enemy: EntityView[];
  projectiles: ProjectileView[];
  deposits: DepositView[];
  scripts: Record<string, { custom: boolean; errors: string[] }>;
  availableActions?: ActionAvailability;
  combat?: CombatSummary;
  events: GameEvent[];
  /**
   * Your entities that took damage in the same window as `events` (attack events themselves are not listed).
   * Attackers are named only when you can see them now; the rest are counted as unseen.
   */
  underAttack?: UnderAttack[];
  /**
   * Fog of war memory: enemy units, buildings and deposits as last seen. Unit sightings are historical positions, not current occupancy.
   * Building/deposit memories clear when their empty tile is seen again. Unit sightings mark positionCleared if the old position is visibly empty; observed deaths remove them.
   */
  lastSeen: LastSeen[];
  /** Added by the room: last 5 visible messages, independent of the events cursor. Full history via /chat. */
  chat?: { enabled: boolean; messages: ChatMessage[] };
  outcome?: Outcome;
}

/** What a spectator sees: everything. */
export interface SpectatorView {
  tick: number;
  timeMs: number;
  matchMs: number;
  status: MatchStatus;
  players: PlayerStats[];
  entities: EntityView[];
  /** Complete observer conversation up to this frame; live overview contains public chat only. */
  chat?: ChatMessage[];
  /** Observer-only conversations, filtered exactly as each player may see them. */
  playerChats?: Record<PlayerId, ChatMessage[]>;
  /** Observer-only per-player perspectives, for watch/replay. Never sent by player tools. */
  perspectives?: Record<PlayerId, { visibility: string[]; entities: EntityView[]; projectiles: ProjectileView[]; deposits: DepositView[]; players: PlayerStats[]; events: GameEvent[] }>;
  visibility?: string[];
  projectiles: ProjectileView[];
  deposits: DepositView[];
  /** Events produced by the last simulated tick. */
  events: GameEvent[];
  outcome?: Outcome;
}

/** A finished match: enough to re-simulate it exactly. */
export interface ReplayFile {
  /** Reproduction metadata; absent in historical files, unknown values are null. */
  experiment?: ExperimentManifest;
  series?: { id: string; gameNumber: number; totalGames: 3 };
  format: 1;
  id: string;
  createdAt: string;
  ruleset: import("./ruleset").Ruleset;
  seed: number;
  tickRate: number;
  /** In engine order; `side` is the seat (map corner) each one started on. */
  players: { id: PlayerId; name: string; side?: number; team?: number }[];
  /** Orders in the tick they were applied, in application order per player. */
  orders: { tick: number; player: PlayerId; order: Order }[];
  /** State hash every 100 ticks, to detect desyncs. */
  hashes: Record<number, string>;
  finalTick: number;
  outcome: Outcome;
  /** How each player used its time, measured by the server. */
  timing?: Record<PlayerId, PlayerTiming>;
  chat?: boolean;
}

/**
 * How a player used its time, measured by the server the same way for every
 * connector. "Thinking" is the time between answering a player and its next
 * call: model latency plus harness overhead, everything outside the game.
 */
export interface PlayerTiming {
  toolErrors?: number;
  rejectedOrders?: number;
  observationAgeTicksTotal?: number;
  observationAgeTicksMax?: number;
  /** Running time since the most recent accepted order (or match start). */
  maxActionGapMs?: number;
  /** Authenticated API calls. */
  calls: number;
  /** Calls that sent orders or scripts. */
  decisions: number;
  orders: number;
  /** Sum and max of the gaps between our answer and the player's next call, while running. */
  thinkMs: number;
  /** Number of gaps summed in thinkMs (average = thinkMs / thinks). */
  thinks: number;
  maxThinkMs: number;
  /** Time spent inside `wait` long-polls. */
  waitMs: number;
  /** From the start of the match to the player's first order or script. */
  firstActionMs: number | null;
}

/** Declared by the harness, never inferred from a display name. No credentials or raw prompts. */
export interface AgentConfiguration {
  model: string | null;
  effort: string | null;
  connector: string | null;
  connectorVersion: string | null;
  promptSha256: string | null;
  memoryPolicy: string | null;
  contextPolicy: string | null;
}

export interface ExperimentManifest {
  agentActivity?: { tick: number; player: PlayerId; activity: AgentActivity }[];
  /** Emergency wall-clock/worker failures invalidate deterministic balance evidence. */
  operationalFailures?: { tick: number; player: PlayerId; message: string }[];
  schema: 1;
  engine: { revision: string | null; sourceSha256: string | null; runtime: string };
  rulesSha256: string;
  /** Static guide without the changing series score/history header. */
  baseGuideSha256: string;
  mode: "independent" | "series";
  players: Record<PlayerId, { configuration: AgentConfiguration; changes: { tick: number; configuration: AgentConfiguration }[] }>;
  /** Bounded trace without request bodies, prompts, tokens or private chat. */
  calls: { player: PlayerId; tool: string; startedTick: number; answeredTick: number | null; observationTick: number; durationMs: number | null; status: number | null; failed?: boolean }[];
  droppedCalls: number;
}

/** Messages on the spectator WebSocket. */
export type SpectatorMessage =
  | { type: "hello"; roomId: string; ruleset: import("./ruleset").Ruleset; tickRate: number; view: SpectatorView }
  | { type: "tick"; view: SpectatorView };
