/** Everything that crosses the wire between the server and its clients. */

export type PlayerId = string;
export type ChatChannel = "all" | "team" | "private";

export interface ChatMessage {
  tick: number;
  from: PlayerId;
  name: string;
  text: string;
  channel?: ChatChannel;
  to?: PlayerId;
}

/** A player's instruction. Unit orders override the unit's script until they end. */
export type Order =
  | { type: "move"; unit: string; x: number; y: number }
  | { type: "attack"; unit: string; target: string }
  /** Omit `deposit` to use the nearest one. The worker keeps gathering until stopped. */
  | { type: "gather"; unit: string; deposit?: string }
  | { type: "build"; unit: string; kind: string; x: number; y: number }
  | { type: "train"; building: string; kind: string }
  /** Research the next level of a ruleset upgrade. Capital is charged on acceptance. */
  | { type: "upgrade"; upgrade: string }
  /** Drop the unit's order; it goes back to its script or stays idle. */
  | { type: "stop"; unit: string }
  /** JavaScript body run every tick by each unit of `kind`. `null` restores the built-in script. */
  | { type: "script"; kind: string; code: string | null }
  /** Chat on required. `to` implies private; otherwise omitted channel means public. */
  | { type: "chat"; text: string; channel?: ChatChannel; to?: PlayerId };

export interface CapitalChange { spent: number; remaining: number; pending?: number }
export type OrderResult = ({ ok: true; id?: string } | { ok: false; reason: string }) & { capital?: CapitalChange };

export type MatchStatus = "waiting" | "prep" | "running" | "finished";

export interface SeriesProgress {
  id: string;
  gameNumber: number;
  totalGames: 3;
  status: "running" | "finished" | "error";
  score: Record<PlayerId, number>;
  previousGames: number[];
}

export interface SeriesSummary {
  id: string;
  createdAt: string;
  totalGames: 3;
  status: SeriesProgress["status"];
  currentGame: number;
  players: { id: PlayerId; name: string; team: number; bot?: string }[];
  score: Record<PlayerId, number>;
  winners?: PlayerId[];
  games: { number: number; roomId: string; status: MatchStatus; outcome?: Outcome }[];
}

export interface SeriesReplay {
  format: "aoa-series-v1";
  series: SeriesSummary;
  games: ReplayFile[];
}

export interface Outcome {
  /** The sole winner; null for a draw or when a team won (see `winners`). */
  winner: PlayerId | null;
  /** Every player on the winning side (empty = draw). Absent in replays older than teams. */
  winners?: PlayerId[];
  reason: "vital_lost" | "timeout" | "forfeit";
  scores: Record<PlayerId, number>;
}

export interface EntityView {
  id: string;
  kind: string;
  owner: PlayerId;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Effective stats (including upgrades), with timings quantized to the match tick. */
  stats?: { atk: number; def: number; range: number; attackMs: number; moveMs: number };
  /** Current order in words, e.g. "move 10,5", "gather d3". Absent = script/idle. */
  order?: string;
  /** What the unit did last tick, e.g. "→ 20,20", "attack e17", "gather d9", "hold". Only for your own units. */
  doing?: string;
  /** Direction of its last step (↑ ↗ → ↘ ↓ ↙ ← ↖) if it moved in the last second. Everyone sees it. */
  heading?: string;
  carrying?: number;
}

export interface DepositView {
  id: string;
  x: number;
  y: number;
  amount: number;
}

export interface PlayerStats {
  id: PlayerId;
  name: string;
  capital: number;
  pop: number;
  popCap: number;
  score: number;
  kills: number;
  /** Players with the same team are allies. In 1v1 each player is its own team. */
  team: number;
  alive: boolean;
  /** Present only in rulesets with research; public to both players and spectators. */
  upgrades?: Record<string, number>;
  research?: { upgrade: string; level: number; completesAtMs: number };
}

export type GameEvent =
  | { tick: number; type: "research_started"; owner: PlayerId; upgrade: string; level: number; completesAtMs: number; capital: CapitalChange }
  | { tick: number; type: "upgrade_completed"; owner: PlayerId; upgrade: string; level: number }
  | { tick: number; type: "attack"; from: string; to: string; dmg: number }
  | { tick: number; type: "death"; id: string; kind: string; owner: PlayerId; x: number; y: number; by?: PlayerId }
  | { tick: number; type: "spawn"; id: string; kind: string; owner: PlayerId; x: number; y: number; builder?: string; capital?: CapitalChange }
  | { tick: number; type: "unload"; id: string; owner: PlayerId; amount: number }
  | { tick: number; type: "depleted"; id: string }
  | { tick: number; type: "order_end"; id: string; owner: PlayerId; reason: string }
  | { tick: number; type: "script_error"; owner: PlayerId; kind: string; unit?: string; message: string }
  | { tick: number; type: "log"; owner: PlayerId; unit: string; message: string }
  | { tick: number; type: "chat"; owner: PlayerId; text: string; channel?: ChatChannel; to?: PlayerId }
  /** A player lost its vital entity while its team plays on: all it had is gone. */
  | { tick: number; type: "eliminated"; owner: PlayerId }
  | { tick: number; type: "match_end"; outcome: Outcome };

/** What one player sees. `tick` is the next tick to be simulated; use it as `since`. */
export interface PlayerView {
  series?: SeriesProgress;
  tick: number;
  timeMs: number;
  matchMs: number;
  status: MatchStatus;
  you: PlayerId;
  players: PlayerStats[];
  /** ASCII map, one string per row (y), one char per column (x). */
  grid: string[];
  mine: EntityView[];
  /** Your teammates' entities (team matches only). */
  allies: EntityView[];
  enemy: EntityView[];
  deposits: DepositView[];
  scripts: Record<string, { custom: boolean; errors: string[] }>;
  events: GameEvent[];
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
  deposits: DepositView[];
  /** Events produced by the last simulated tick. */
  events: GameEvent[];
  outcome?: Outcome;
}

/** A finished match: enough to re-simulate it exactly. */
export interface ReplayFile {
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

/** Messages on the spectator WebSocket. */
export type SpectatorMessage =
  | { type: "hello"; roomId: string; ruleset: import("./ruleset").Ruleset; tickRate: number; view: SpectatorView }
  | { type: "tick"; view: SpectatorView };
