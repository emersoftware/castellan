/**
 * A room runs one match in real time: it owns the clock, the order queue, the
 * long-poll waiters, the spectators and the replay. Everything a player can do
 * goes through the few public methods here, and every call is recorded in its
 * `experiment`; the HTTP layer only translates.
 */
import { randomBytes } from "node:crypto";
import { createMatch, resimulate, type Match, type MatchConfig } from "@castellan/engine";
import type { ScriptHost, ScriptHostFactory } from "@castellan/sandbox";
import type {
  ChatMessage, GameEvent, MatchStatus, Order, OrderResult, PlayerId, PlayerTiming, PlayerView, ReplayFile, RoomMode, Ruleset, SeatStatus, SeriesProgress, SpectatorMessage, SpectatorView,
} from "@castellan/shared";
import { BOTS, type Bot } from "@castellan/bots";
import { API_LIMITS, playerGuide, type AgentConfiguration, type ExperimentManifest } from "@castellan/shared";
import { ExperimentRecorder } from "./experiment";
import { createIsolatedScriptHost } from "./script-isolation";


/** Before its match starts a room only answers views, so its players need no script engine yet. */
const LOBBY_HOST: ScriptHost = {
  setScript: () => ({ ok: true }),
  hasScript: () => true,
  run: () => { throw new Error("a waiting room does not run scripts"); },
  dispose: () => {},
};
const lobbyHosts: ScriptHostFactory = () => LOBBY_HOST;

export interface RoomPlayer {
  id: PlayerId;
  name: string;
  token: string;
  /** Reference bot (practice rooms only). */
  bot?: { name: string; fn: Bot; every: number; offset: number };
  /** Has made at least one authenticated call. */
  seen: boolean;
  /** Seat: 0 = the map's listed corner, 1 = rotated 180°, 2 and 3 = 90° and 270° (4-seat maps). */
  side: number;
  /** Players with the same team are allies. */
  team: number;
}

export interface RoomOptions {
  /** Host-only capability, persisted across restarts; never sent to players. */
  spectatorToken?: string;
  /** Series rooms start only after their credentials/checkpoint have been saved. */
  deferredStart?: boolean;
  ruleset: Ruleset;
  /** One per occupied seat; a three-player FFA leaves one of four corners empty. `team` defaults to each player alone (2 seats) or 2v2 in list order (4 seats). */
  players: { name: string; bot?: string; team?: number; agent?: AgentConfiguration }[];
  /** Four-seat maps default to teams; ffa gives every player their own side. */
  mode?: RoomMode;
  tickRate: number;
  seed: number;
  /** "random" (default) shuffles which corner each player starts in, from the seed. "fixed": list order. */
  sides: "random" | "fixed";
  prepMs: number;
  /** Decision delay of practice bots. */
  botLatencyMs: number;
  /** Players may send chat messages to each other. */
  chat: boolean;
  /** Publishes the finished match; a rejection is reported as the room's `error`. */
  onFinish: (replay: ReplayFile) => Promise<void> | void;
}

/** Who a room is: kept by its checkpoint, so a restart restores the same room. */
interface RoomIdentity { id: string; createdAt: string }

export interface RoomCheckpoint {
  experiment?: ExperimentManifest;
  options: Omit<RoomOptions, "onFinish"> & RoomIdentity;
  players: { id: string; token: string; side: number; team: number }[];
  tick: number;
  hash: string;
  orders: ReplayFile["orders"];
  hashes: Record<number, string>;
  timing: Record<string, PlayerTiming>;
  cursors: [string, number][];
  lastChat: [string, number][];
}

interface Pending {
  player: PlayerId;
  order: Order;
  resolve?: (r: { result: OrderResult; tick: number }) => void;
}

interface Waiter {
  player: PlayerId;
  since: number;
  until: Set<string> | null;
  resolve: () => void;
}

export interface Spectator {
  send(msg: SpectatorMessage): void;
}

export class Room {
  readonly spectatorToken: string;
  /** What the players declare, call and take to decide; the HTTP layer records each call here. */
  readonly experiment: ExperimentRecorder;
  private finishPublished = false;
  private finishTimer: NodeJS.Timeout | undefined;
  private publication: Promise<void> | undefined;
  /** An operational failure outside the match (engines that did not start, a replay not saved), shown in the summary. */
  private error: string | undefined;
  readonly id: string;
  readonly createdAt: Date;
  seriesProgress?: () => SeriesProgress;
  readonly players: RoomPlayer[];
  readonly ruleset: Ruleset;
  readonly tickRate: number;
  private status: MatchStatus = "waiting";
  private prepEndsAt = 0;
  private match!: Match;
  private matchDisposed = false;
  private enginesStarted = false;
  private queue: Pending[] = [];
  private waiters: Waiter[] = [];
  private spectators = new Set<Spectator>();
  private recorded: ReplayFile["orders"] = [];
  private hashes: Record<number, string> = {};
  private timer: NodeJS.Timeout | null = null;
  private closed = false;
  private lastChat = new Map<PlayerId, number>();
  /** Tick of the last view returned to each player. */
  private seen = new Map<PlayerId, number>();

  private constructor(private opts: RoomOptions, identity?: RoomIdentity) {
    this.spectatorToken = opts.spectatorToken ?? randomBytes(24).toString("hex");
    this.id = identity?.id ?? randomBytes(4).toString("hex");
    this.createdAt = identity ? new Date(identity.createdAt) : new Date();
    this.ruleset = opts.ruleset;
    this.tickRate = opts.tickRate;
    const every = Math.max(1, Math.round((opts.botLatencyMs * opts.tickRate) / 1000));
    this.players = opts.players.map((p, i) => {
      const make = p.bot ? BOTS[p.bot] : undefined;
      if (p.bot && !make) throw new Error(`unknown bot "${p.bot}" (${Object.keys(BOTS).join(", ")})`);
      return {
        id: `p${i + 1}`,
        name: p.name,
        token: randomBytes(16).toString("hex"),
        bot: make ? { name: p.bot!, fn: make(opts.ruleset), every, offset: (i * 7) % every } : undefined,
        seen: !!make,
        side: i % 2,
        team: opts.mode === "ffa" ? i : p.team ?? (opts.players.length === 4 ? Math.floor(i / 2) : i),
      };
    });
    if (opts.players.length === 4 || (opts.ruleset.map.seats === 4 && opts.mode === "ffa" && opts.players.length === 3)) {
      const seats = opts.sides === "random" ? seededShuffle([0, 1, 2, 3], opts.seed) : [0, 1, 2, 3];
      this.players.forEach((p, i) => (p.side = seats[i]));
    } else if (opts.sides === "random" && seededCoin(opts.seed)) {
      for (const p of this.players) p.side = 1 - p.side;
    }
    this.experiment = new ExperimentRecorder(this, this.players, {
      ruleset: this.ruleset, agents: opts.players.map((p) => p.agent),
      guide: playerGuide(this.ruleset, { tickRate: this.tickRate, chat: this.chat, teams: this.teams, playerCount: this.players.length }),
    }, () => this.publishFinish());
  }

  static async create(opts: RoomOptions): Promise<Room> {
    const room = new Room(opts);
    room.match = await createMatch(room.matchConfig(lobbyHosts));
    if (!opts.deferredStart) room.maybeStart();
    return room;
  }

  /** The match this room plays, on lobby hosts until it starts and on isolated script engines (worker threads) after. */
  private matchConfig(scriptHostFactory: ScriptHostFactory): MatchConfig {
    return { scriptHostFactory, ruleset: this.ruleset, seed: this.opts.seed, tickRate: this.tickRate,
      players: this.players.map(({ id, name, side, team }) => ({ id, name, side, team })) };
  }

  activate() { this.maybeStart(); }

  checkpoint(): RoomCheckpoint {
    const { onFinish: _, ...options } = this.opts;
    return {
      options: { ...options, spectatorToken: this.spectatorToken, id: this.id, createdAt: this.createdAt.toISOString() },
      experiment: this.experiment.manifest(),
      players: this.players.map(({ id, token, side, team }) => ({ id, token, side, team })),
      tick: this.tick, hash: this.match.hash(), orders: this.recorded, hashes: this.hashes,
      timing: this.experiment.timing(), cursors: [...this.seen], lastChat: [...this.lastChat],
    };
  }

  static async restore(saved: RoomCheckpoint, onFinish: RoomOptions["onFinish"]): Promise<Room> {
    const { id, createdAt, ...options } = saved.options;
    const room = new Room({ ...options, deferredStart: true, onFinish }, { id, createdAt });
    for (const p of room.players) Object.assign(p, saved.players.find((s) => s.id === p.id));
    room.enginesStarted = saved.tick > 0;
    const { match, check } = await resimulate({ config: room.matchConfig(room.enginesStarted ? createIsolatedScriptHost : lobbyHosts), orders: saved.orders,
      hashes: { ...saved.hashes, [saved.tick]: saved.hash }, until: saved.tick }, {
      // Rebuild reference bots' private decision state without enqueueing twice.
      before: (m) => { for (const p of room.players) if (p.bot && m.tick % p.bot.every === p.bot.offset) p.bot.fn(m.view(p.id, m.tick)); },
    });
    room.match = match;
    if (!check.verified) { match.dispose(); throw new Error(`checkpoint mismatch for room ${room.id} at tick ${check.desyncAt}`); }
    room.recorded = saved.orders;
    room.experiment.restore(saved.experiment, saved.timing, { finished: !!room.match.outcome });
    room.hashes = saved.hashes;
    room.seen = new Map(saved.cursors);
    room.lastChat = new Map(saved.lastChat);
    if (room.match.outcome) {
      room.status = "finished";
      room.disposeMatch();
    }
    return room;
  }

  replay(): ReplayFile | undefined {
    if (!this.match.outcome) return;
    return { format: 1, id: this.id, createdAt: this.createdAt.toISOString(), ruleset: this.ruleset,
      experiment: this.experiment.manifest(this.seriesProgress ? "series" : "independent"),
      seed: this.opts.seed, tickRate: this.tickRate,
      players: this.players.map(({ id, name, side, team }) => ({ id, name, side, team })),
      orders: this.recorded, hashes: { ...this.hashes, [this.tick]: this.match.hash() }, finalTick: this.tick,
      outcome: this.match.outcome, timing: this.experiment.timing(), chat: this.chat,
      ...(this.seriesProgress ? { series: { id: this.seriesProgress().id, gameNumber: this.seriesProgress().gameNumber, totalGames: 3 as const } } : {}),
    };
  }

  cursor(player: PlayerId): number {
    return this.seen.get(player) ?? 0;
  }

  get chat(): boolean {
    return this.opts.chat;
  }

  get teams(): boolean {
    return new Set(this.players.map((p) => p.team)).size < this.players.length;
  }

  get mode(): RoomMode {
    return this.teams ? "teams" : "ffa";
  }

  get state(): MatchStatus {
    return this.status;
  }
  get tick(): number {
    return this.match.tick;
  }
  get outcome() { return this.match.outcome; }

  /** The whole conversation this player may read, oldest first, senders named by id. */
  conversation(player: PlayerId): ChatMessage[] {
    return this.match.chat(player).map((m) => ({ ...m, name: m.from }));
  }

  /** Any authenticated call counts as "connected". When everyone is, prep starts. */
  touch(player: PlayerId) {
    const p = this.player(player);
    if (!p.seen) {
      p.seen = true;
      this.maybeStart();
    }
  }

  /** Events default to the last view returned to this player. */
  view(player: PlayerId, since?: number): PlayerView {
    const v = this.match.view(player, since ?? this.seen.get(player) ?? 0);
    this.seen.set(player, v.tick);
    v.status = this.status;
    v.series = this.seriesProgress?.();
    if (this.status === "waiting" || this.status === "prep") {
      for (const choices of Object.values(v.availableActions ?? {})) for (const a of choices) a.blockedBy.unshift(`match is ${this.status}`);
    }
    const messages = this.conversation(player).slice(-API_LIMITS.chatShown);
    v.chat = { enabled: this.chat, messages };
    // Keep older chat out of JSON events too, even with an explicit old cursor.
    v.events = v.events.filter((e) => e.type !== "chat" || messages.some((m) => m.tick === e.tick && m.from === e.owner));
    if (this.status !== "running" && this.status !== "finished") v.timeMs = 0;
    return v;
  }

  spectate(since?: number): SpectatorView {
    const v = this.match.spectate(since);
    v.status = this.status;
    for (const p of v.players) {
      const activity = this.experiment.latestActivity(p.id);
      if (activity) p.agentActivity = { ...activity };
      const own = v.perspectives?.[p.id]?.players.find(q => q.id === p.id);
      if (own && activity) own.agentActivity = { ...activity };
    }
    return v;
  }

  /** For harness supervisors: where a player's match stands, without counting as a call. */
  playerStatus(player: PlayerId): SeatStatus {
    return { room: this.id, player, status: this.status, tick: this.tick, alive: this.match.isAlive(player) };
  }

  /** Queues orders for the next tick and resolves with their results once applied. */
  async act(player: PlayerId, orders: Order[]): Promise<{ results: OrderResult[]; tick: number }> {
    if (this.status === "finished") return { results: orders.map(() => ({ ok: false, reason: "match over" })), tick: this.tick };
    // Prep is for reading the rules and planning; nothing, scripts included, goes in before the start.
    if (this.status !== "running") {
      return { results: orders.map(() => ({ ok: false, reason: `match is ${this.status}: orders and scripts are accepted once it is running` })), tick: this.tick };
    }
    const at = Date.now();
    // A player's orders for one tick share one capacity, however many requests they come in.
    let capacity = API_LIMITS.orders - this.queue.filter((q) => q.player === player).length;
    const settled = await Promise.all(orders.map((order) => {
      const refused = (reason: string) => ({ result: { ok: false as const, reason }, tick: this.tick });
      if (order?.type === "chat" && !this.opts.chat) return refused("chat is off in this room");
      if (order?.type === "chat" && Date.now() - (this.lastChat.get(player) ?? 0) < API_LIMITS.chatEveryMs) return refused(`one message every ${API_LIMITS.chatEveryMs / 1000}s`);
      if (capacity-- <= 0) return refused(`over ${API_LIMITS.orders} orders this tick`);
      return order?.type === "chat" ? this.enqueueChat(player, order) : this.enqueue(player, order);
    }));
    this.experiment.decision(player, { at, orders: orders.length, rejected: settled.filter((s) => !s.result.ok).length,
      acted: settled.some((s, i) => s.result.ok && orders[i]?.type !== "chat") });
    return { results: settled.map((s) => s.result), tick: settled[0]?.tick ?? this.tick };
  }

  private enqueue(player: PlayerId, order: Order) {
    return new Promise<{ result: OrderResult; tick: number }>((resolve) => this.queue.push({ player, order, resolve }));
  }

  /** The cooldown starts when a message is queued, so a second one in the same tick waits; a message the game rejects gives it back. */
  private async enqueueChat(player: PlayerId, order: Order) {
    const previous = this.lastChat.get(player);
    this.lastChat.set(player, Date.now());
    const settled = await this.enqueue(player, order);
    if (!settled.result.ok) {
      if (previous === undefined) this.lastChat.delete(player);
      else this.lastChat.set(player, previous);
    }
    return settled;
  }

  /** The script `player` runs now for each scriptable kind. */
  scripts(player: PlayerId): Record<string, { code: string; custom: boolean } | null> {
    return Object.fromEntries(Object.entries(this.ruleset.kinds).filter(([, k]) => k.scriptable).map(([kind]) => [kind, this.match.scriptSource(player, kind)]));
  }

  /**
   * Resolves when `player` has new events (optionally of the given types) with
   * tick ≥ since, the status changes, or `maxMs` passes.
   */
  wait(player: PlayerId, since: number, maxMs: number, until: string[] | null): Promise<void> {
    if (this.hasNews(player, since, until ? new Set(until) : null) || this.status === "finished") return Promise.resolve();
    return new Promise((resolve) => {
      const w: Waiter = { player, since, until: until ? new Set(until) : null, resolve: () => {} };
      const timer = setTimeout(() => done(), maxMs);
      const done = () => {
        clearTimeout(timer);
        this.waiters = this.waiters.filter((x) => x !== w);
        resolve();
      };
      w.resolve = done;
      this.waiters.push(w);
    });
  }

  addSpectator(s: Spectator): () => void {
    this.spectators.add(s);
    s.send({ type: "hello", roomId: this.id, ruleset: this.ruleset, tickRate: this.tickRate, view: this.spectate(this.tick - 1) });
    return () => this.spectators.delete(s);
  }

  summary() {
    return {
      id: this.id,
      series: this.seriesProgress?.(),
      status: this.status,
      tick: this.tick,
      timeMs: this.match.spectate().timeMs,
      createdAt: this.createdAt.toISOString(),
      prepEndsAt: this.status === "prep" ? new Date(this.prepEndsAt).toISOString() : undefined,
      map: this.ruleset.map.name,
      mode: this.mode,
      chat: this.opts.chat,
      timing: this.experiment.timing(),
      players: this.players.map((p) => ({ id: p.id, name: p.name, bot: p.bot?.name, connected: p.seen, side: p.side, team: p.team })),
      outcome: this.match.outcome ?? undefined,
      ...(this.error ? { error: this.error } : {}),
    };
  }

  /** Stops the room; resolves once a finished match's replay has been published or its failure recorded. */
  close(): Promise<void> {
    this.suspend();
    for (const w of [...this.waiters]) w.resolve();
    if (this.outcome) this.publishFinish();
    this.disposeMatch();
    return this.publication ?? Promise.resolve();
  }

  private disposeMatch() {
    if (this.matchDisposed) return;
    this.matchDisposed = true;
    this.match.dispose();
  }

  suspend() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
  }

  // ───────────────────────── lifecycle ─────────────────────────

  private maybeStart() {
    if (this.closed || this.status !== "waiting" || !this.players.every((p) => p.seen)) return;
    if (this.tick > 0) { this.run(); return; }
    const humansOrLlms = this.players.some((p) => !p.bot);
    const prep = humansOrLlms ? this.opts.prepMs : 0;
    this.setStatus("prep");
    this.prepEndsAt = Date.now() + prep;
    // A failure to start is recorded as soon as it happens; prep may still be running.
    const started = this.startEngines().then(() => true, (error: unknown) => {
      this.fail("script engines did not start", error);
      this.suspend();
      return false;
    });
    this.timer = setTimeout(() => void started.then((ok) => { if (ok) this.run(); }), prep);
  }

  private fail(what: string, error: unknown) {
    this.error = `${what}: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`Room ${this.id} ${what}:`, error);
  }

  /** Replaces the lobby's script-free match with the same match on isolated script engines. */
  private async startEngines() {
    if (this.enginesStarted) return;
    this.enginesStarted = true;
    const live = await createMatch(this.matchConfig(createIsolatedScriptHost));
    if (this.closed) { live.dispose(); return; }
    this.match.dispose();
    this.match = live;
  }

  private run() {
    if (this.closed) return;
    this.experiment.running();
    this.setStatus("running");
    const ms = 1000 / this.tickRate;
    let next = Date.now();
    // setInterval drifts; schedule against the wall clock instead.
    const loop = () => {
      if (this.status !== "running") return;
      this.step();
      next += ms;
      this.timer = setTimeout(loop, Math.max(0, next - Date.now()));
    };
    loop();
  }

  private step() {
    const T = this.match.tick;
    for (const p of this.players) {
      if (!p.bot || T % p.bot.every !== p.bot.offset) continue;
      for (const order of p.bot.fn(this.match.view(p.id, T))) this.queue.push({ player: p.id, order });
    }
    const batch = this.queue;
    this.queue = [];
    const input = batch.map(({ player, order }) => ({ player, order }));
    // Replays are published after the match and include both chat channels.
    for (const o of input) this.recorded.push({ tick: T, ...o });
    const { results, events } = this.match.step(input);
    for (const event of events) if (event.type === "script_error" && event.operationalFailure) this.experiment.operationalFailure(event.owner, event.message, event.tick);
    batch.forEach((b, i) => b.resolve?.({ result: results[i], tick: T }));
    if (T % 100 === 0) this.hashes[T] = this.match.hash();
    if (this.match.outcome) this.finish();
    this.notify(events);
  }

  private finish() {
    this.experiment.finished();
    this.hashes[this.match.tick] = this.match.hash();
    // Finished rooms remain readable in the lobby/history, but their player
    // VMs no longer execute. Release workers now, not only at server shutdown.
    this.disposeMatch();
    this.setStatus("finished");
    if (this.timer) clearTimeout(this.timer);
    // Resolve waits/orders first, then capture their final responses. A stalled
    // client cannot prevent persistence or advancing a series indefinitely.
    if (this.experiment.settled) this.publishFinish();
    else this.finishTimer = setTimeout(() => this.publishFinish(), 1000);
  }

  private publishFinish() {
    if (this.finishPublished || !this.outcome) return;
    this.finishPublished = true;
    if (this.finishTimer) clearTimeout(this.finishTimer);
    // An unsaved replay stays visible in the summary and the log; it never stops the other rooms.
    this.publication = (async () => this.opts.onFinish(this.replay()!))().catch((error: unknown) => this.fail("replay was not saved", error));
  }

  private setStatus(s: MatchStatus) {
    this.status = s;
    for (const w of [...this.waiters]) w.resolve();
    this.broadcast();
  }

  private notify(events: GameEvent[]) {
    this.broadcast();
    if (events.length === 0) return;
    for (const w of [...this.waiters]) if (this.hasNews(w.player, w.since, w.until)) w.resolve();
  }

  private hasNews(player: PlayerId, since: number, until: Set<string> | null): boolean {
    // Damage is intentionally summarized outside events; it must still interrupt a wait.
    // Threats and own losses bypass an until filter (e.g. waiting for a training queue).
    const view = this.match.view(player, since);
    return (view.underAttack ?? []).some((hit) => hit.damage > 0) || view.events.some((e) =>
      !until || until.has(e.type) || (e.type === "death" && e.owner === player));
  }

  private broadcast() {
    if (this.spectators.size === 0) return;
    const msg: SpectatorMessage = { type: "tick", view: this.spectate() };
    for (const s of this.spectators) s.send(msg);
  }

  private player(id: PlayerId): RoomPlayer {
    const p = this.players.find((x) => x.id === id);
    if (!p) throw new Error(`unknown player ${id}`);
    return p;
  }
}

/** A deterministic shuffle from the room seed (mulberry32 + Fisher–Yates). */
function seededShuffle<T>(items: T[], seed: number): T[] {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A deterministic coin flip from the room seed (so a replay knows the sides). */
function seededCoin(seed: number): boolean {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  return (Math.imul(h, 0xc2b2ae35) >>> 0) % 2 === 1;
}
