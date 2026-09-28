/**
 * A room runs one match in real time: it owns the clock, the order queue, the
 * long-poll waiters, the spectators and the replay. Everything a player can do
 * goes through the few public methods here; the HTTP layer only translates.
 */
import { randomBytes } from "node:crypto";
import { createMatch, type Match } from "@aoa/engine";
import type {
  ChatMessage, GameEvent, MatchStatus, Order, OrderResult, PlayerId, PlayerTiming, PlayerView, ReplayFile, Ruleset, SpectatorMessage, SpectatorView,
} from "@aoa/shared";
import { BOTS, type Bot } from "@aoa/sim";

const MAX_ORDERS_PER_TICK = 50;
const CHAT_EVERY_MS = 3000;

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
  ruleset: Ruleset;
  /** One per map seat. `team` defaults to each player alone (2 seats) or 2v2 in list order (4 seats). */
  players: { name: string; bot?: string; team?: number }[];
  /** Four-seat maps default to teams; ffa gives every player their own side. */
  mode?: "teams" | "ffa";
  tickRate: number;
  seed: number;
  /** "random" (default) shuffles which corner each player starts in, from the seed. "fixed": list order. */
  sides: "random" | "fixed";
  prepMs: number;
  /** Decision delay of practice bots. */
  botLatencyMs: number;
  /** Players may send chat messages to each other. */
  chat: boolean;
  onFinish: (replay: ReplayFile) => void;
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
  readonly id: string;
  readonly createdAt = new Date();
  readonly players: RoomPlayer[];
  readonly ruleset: Ruleset;
  readonly tickRate: number;
  private status: MatchStatus = "waiting";
  private prepEndsAt = 0;
  private match!: Match;
  private queue: Pending[] = [];
  private waiters: Waiter[] = [];
  private spectators = new Set<Spectator>();
  private recorded: ReplayFile["orders"] = [];
  private hashes: Record<number, string> = {};
  private timer: NodeJS.Timeout | null = null;
  private runningSince = 0;
  private timing = new Map<PlayerId, PlayerTiming & { answeredAt: number | null }>();
  private lastChat = new Map<PlayerId, number>();
  /** Tick of the last view returned to each player. */
  private seen = new Map<PlayerId, number>();
  /** The whole conversation (events only keep the last minute). */
  private chatLog: ChatMessage[] = [];

  private constructor(private opts: RoomOptions) {
    this.id = randomBytes(4).toString("hex");
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
        bot: make ? { name: p.bot!, fn: make(), every, offset: (i * 7) % every } : undefined,
        seen: !!make,
        side: i % 2,
        team: opts.mode === "ffa" ? i : p.team ?? (opts.players.length === 4 ? (i < 2 ? 0 : 1) : i),
      };
    });
    if (opts.players.length === 4) {
      const seats = opts.sides === "random" ? seededShuffle([0, 1, 2, 3], opts.seed) : [0, 1, 2, 3];
      this.players.forEach((p, i) => (p.side = seats[i]));
    } else if (opts.sides === "random" && seededCoin(opts.seed)) {
      for (const p of this.players) p.side = 1 - p.side;
    }
  }

  static async create(opts: RoomOptions): Promise<Room> {
    const room = new Room(opts);
    room.match = await createMatch({ ruleset: opts.ruleset, seed: opts.seed, tickRate: opts.tickRate, players: room.players.map(({ id, name, side, team }) => ({ id, name, side, team })) });
    room.maybeStart();
    return room;
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

  get state(): MatchStatus {
    return this.status;
  }
  get tick(): number {
    return this.match.tick;
  }

  /**
   * A player's call begins. The gap since we last answered it is its thinking
   * time (model + harness), counted only while the match runs.
   */
  beginCall(player: PlayerId) {
    const t = this.timingOf(player);
    t.calls++;
    if (this.status === "running" && t.answeredAt !== null) {
      const gap = Date.now() - Math.max(t.answeredAt, this.runningSince);
      t.thinkMs += gap;
      t.thinks++;
      t.maxThinkMs = Math.max(t.maxThinkMs, gap);
    }
    t.answeredAt = null;
  }

  /** We answered a player's call. `waitedMs`: time it spent in a long-poll. */
  endCall(player: PlayerId, waitedMs = 0) {
    const t = this.timingOf(player);
    t.answeredAt = Date.now();
    if (this.status === "running") t.waitMs += waitedMs;
  }

  /** Only messages visible to this authenticated player, oldest first. */
  conversation(player: PlayerId) {
    const team = this.player(player).team;
    return this.chatLog.filter((m) => m.channel === "private" ? m.from === player || m.to === player
      : m.channel !== "team" || this.player(m.from).team === team);
  }

  timingStats(): Record<PlayerId, PlayerTiming> {
    const out: Record<PlayerId, PlayerTiming> = {};
    for (const p of this.players) {
      if (p.bot) continue;
      const { answeredAt: _, ...t } = this.timingOf(p.id);
      out[p.id] = t;
    }
    return out;
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
    const messages = this.conversation(player).slice(-5);
    v.chat = { enabled: this.chat, messages };
    // Keep older chat out of JSON events too, even with an explicit old cursor.
    v.events = v.events.filter((e) => e.type !== "chat" || messages.some((m) => m.tick === e.tick && m.from === e.owner));
    if (this.status !== "running" && this.status !== "finished") v.timeMs = 0;
    return v;
  }

  spectate(since?: number): SpectatorView {
    const v = this.match.spectate(since);
    v.status = this.status;
    return v;
  }

  /** Queues orders for the next tick and resolves with their results once applied. */
  async act(player: PlayerId, orders: Order[]): Promise<{ results: OrderResult[]; tick: number }> {
    if (this.status === "finished") return { results: orders.map(() => ({ ok: false, reason: "match over" })), tick: this.tick };
    // Prep is for reading the rules and planning; nothing, scripts included, goes in before the start.
    if (this.status !== "running") {
      return { results: orders.map(() => ({ ok: false, reason: `match is ${this.status}: orders and scripts are accepted once it is running` })), tick: this.tick };
    }
    const t = this.timingOf(player);
    t.decisions++;
    t.orders += orders.length;
    t.firstActionMs ??= Date.now() - this.runningSince;
    // At most MAX_ORDERS_PER_TICK per player per tick, however many requests they come in.
    let room = MAX_ORDERS_PER_TICK - this.queue.filter((q) => q.player === player).length;
    const settled = await Promise.all(
      orders.map((order) =>
        order?.type === "chat" && !this.opts.chat
          ? { result: { ok: false as const, reason: "chat is off in this room" }, tick: this.tick }
          : order?.type === "chat" && Date.now() - (this.lastChat.get(player) ?? 0) < CHAT_EVERY_MS
            ? { result: { ok: false as const, reason: `one message every ${CHAT_EVERY_MS / 1000}s` }, tick: this.tick }
            : (order?.type === "chat" && this.lastChat.set(player, Date.now()), room-- > 0)
          ? new Promise<{ result: OrderResult; tick: number }>((resolve) => this.queue.push({ player, order, resolve }))
          : { result: { ok: false as const, reason: `over ${MAX_ORDERS_PER_TICK} orders this tick` }, tick: this.tick },
      ),
    );
    return { results: settled.map((s) => s.result), tick: settled[0]?.tick ?? this.tick };
  }

  /** The script `player` runs for `kind`. */
  script(player: PlayerId, kind: string): { code: string; custom: boolean } | null {
    return this.match.scriptSource(player, kind);
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
      status: this.status,
      tick: this.tick,
      timeMs: this.match.spectate().timeMs,
      createdAt: this.createdAt.toISOString(),
      prepEndsAt: this.status === "prep" ? new Date(this.prepEndsAt).toISOString() : undefined,
      map: this.ruleset.map.name,
      mode: this.teams ? "teams" : "ffa",
      chat: this.opts.chat,
      timing: this.timingStats(),
      players: this.players.map((p) => ({ id: p.id, name: p.name, bot: p.bot?.name, connected: p.seen, side: p.side, team: p.team })),
      outcome: this.match.outcome ?? undefined,
    };
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    for (const w of [...this.waiters]) w.resolve();
    this.match.dispose();
  }

  // ───────────────────────── lifecycle ─────────────────────────

  private maybeStart() {
    if (this.status !== "waiting" || !this.players.every((p) => p.seen)) return;
    const humansOrLlms = this.players.some((p) => !p.bot);
    const prep = humansOrLlms ? this.opts.prepMs : 0;
    this.setStatus("prep");
    this.prepEndsAt = Date.now() + prep;
    setTimeout(() => this.run(), prep);
  }

  private run() {
    this.runningSince = Date.now();
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
    batch.forEach((b, i) => b.resolve?.({ result: results[i], tick: T }));
    if (T % 100 === 0) this.hashes[T] = this.match.hash();
    if (this.match.outcome) this.finish();
    this.notify(events);
  }

  private finish() {
    this.hashes[this.match.tick] = this.match.hash();
    this.setStatus("finished");
    if (this.timer) clearTimeout(this.timer);
    this.opts.onFinish({
      format: 1,
      id: this.id,
      createdAt: this.createdAt.toISOString(),
      ruleset: this.ruleset,
      seed: this.opts.seed,
      tickRate: this.tickRate,
      players: this.players.map(({ id, name, side, team }) => ({ id, name, side, team })),
      orders: this.recorded,
      hashes: this.hashes,
      finalTick: this.match.tick,
      outcome: this.match.outcome!,
      timing: this.timingStats(),
      chat: this.opts.chat,
    });
  }

  private setStatus(s: MatchStatus) {
    this.status = s;
    for (const w of [...this.waiters]) w.resolve();
    this.broadcast();
  }

  private notify(events: GameEvent[]) {
    for (const e of events) if (e.type === "chat") this.chatLog.push({ tick: e.tick, from: e.owner, name: this.player(e.owner).name, text: e.text, ...(e.channel ? { channel: e.channel } : {}), ...(e.to ? { to: e.to } : {}) });
    this.broadcast();
    if (events.length === 0) return;
    for (const w of [...this.waiters]) if (this.hasNews(w.player, w.since, w.until)) w.resolve();
  }

  private hasNews(player: PlayerId, since: number, until: Set<string> | null): boolean {
    return this.match.events(player, since).some((e) => !until || until.has(e.type));
  }

  private broadcast() {
    if (this.spectators.size === 0) return;
    const msg: SpectatorMessage = { type: "tick", view: this.spectate() };
    for (const s of this.spectators) s.send(msg);
  }

  private timingOf(player: PlayerId) {
    let t = this.timing.get(player);
    if (!t) {
      t = { calls: 0, decisions: 0, orders: 0, thinkMs: 0, thinks: 0, maxThinkMs: 0, waitMs: 0, firstActionMs: null, answeredAt: null };
      this.timing.set(player, t);
    }
    return t;
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
