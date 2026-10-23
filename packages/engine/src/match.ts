import type {
  ChatMessage, DepositView, EntityView, GameEvent, KindSpec, MatchStatus, Order, OrderResult, Outcome, PlayerId, PlayerStats,
  Doing, OrderEndReason, PlayerView, EntityKind, Ruleset, SpectatorView, UnderAttack, UnitOrder,
} from "@castellan/shared";
import { barrierAxes, dist, matchLengthMs, NEUTRAL_OWNER, seatToMap } from "@castellan/shared";
import { createScriptHost, type ScriptAction, type ScriptHostFactory, type UnitRun } from "@castellan/sandbox";
import { DIRS, inBounds } from "./grid";
import { Board } from "./board";
import { Combat, inAttackRange } from "./combat";
import { SimulationClock } from "./clock";
import { OrderTracker } from "./order-progress";
import { Movement } from "./movement";
import { Production } from "./production";
import { UnitScripts } from "./unit-scripts";
import { PlayerVision } from "./vision";
import type { Entity, Intent, Deposit, Player } from "./entities";
import { validateOrder } from "./validate";

export interface MatchConfig {
  ruleset: Ruleset;
  /**
   * `side` is the seat: 0 starts at the map's listed layout, 1 at its 180°
   * rotation, 2 and 3 (4-seat maps) at 90° and 270°. Default: 0, 1, 0, 1…
   * Players with the same `team` are allies. Default: each player alone.
   */
  players: { id: PlayerId; name: string; side?: number; team?: number }[];
  seed: number;
  /** Simulation ticks per second. Resolution only: the ruleset is in ms. */
  tickRate: number;
  /** Host-specific isolation, e.g. a supervised worker for live Node matches. */
  scriptHostFactory?: ScriptHostFactory;
}

export interface StepResult {
  /** One result per input order, same positions. */
  results: OrderResult[];
  /** Everything that happened this tick. */
  events: GameEvent[];
}

/**
 * Changes to a match between ticks, for staged scenarios: balance battles and test fixtures.
 * Recorded games never stage, so a staged match reproduces nothing but itself.
 */
export interface Stage {
  /** New stats from now on (e.g. a balance candidate); every entity keeps its share of health. */
  useRuleset(ruleset: Ruleset): void;
  /** A new entity with `hpShare` of its health; returns its id. */
  spawn(kind: EntityKind, owner: PlayerId, x: number, y: number, hpShare?: number): string;
  remove(id: string): void;
  /** Moves a unit to a free tile. */
  relocate(id: string, x: number, y: number): void;
  /** Nothing stands on the tile, and no door or construction claims it. */
  isFree(x: number, y: number): boolean;
  setHealth(id: string, hp: number): void;
  setResearch(player: PlayerId, upgrade: string, level: number): void;
}

/** An order submitted by a player for the next tick. */
export interface PlayerOrder {
  player: PlayerId;
  order: Order;
}

/** Events kept for `view(player, since)`. */
const EVENT_WINDOW_TICKS = 600;

/**
 * A match: the whole game state and the rules that advance it one tick at a
 * time. Deterministic: the same config and orders always give the same states.
 */
export class Match {
  private rules: Ruleset;
  readonly tickRate: number;
  readonly seed: number;
  readonly maxTicks: number;
  private clock: SimulationClock;
  private _outcome: Outcome | null = null;
  private players: Player[];
  private ents = new Map<string, Entity>();
  private orderProgress: OrderTracker;
  private deps = new Map<string, Deposit>();
  private board: Board;
  /** Eliminated players: their remaining buildings are inert ruins. */
  private ruined = new Set<PlayerId>();
  private vision: PlayerVision;
  private production: Production;
  private scripts: UnitScripts;
  private eventAudience = new WeakMap<GameEvent, Set<PlayerId>>();
  private nextId = 1;
  private combat: Combat;
  private log: GameEvent[] = [];
  private conversation: Extract<GameEvent, { type: "chat" }>[] = [];
  private movement: Movement;

  constructor(cfg: MatchConfig) {
    if (cfg.players.some(p => p.id === NEUTRAL_OWNER)) throw new Error(`Player id ${NEUTRAL_OWNER} is reserved for scenario walls`);
    this.rules = cfg.ruleset;
    this.tickRate = cfg.tickRate;
    this.clock = new SimulationClock(cfg.tickRate);
    this.orderProgress = new OrderTracker(this.clock);
    // Balance continuations replace the ruleset; collaborators always read the current candidate.
    this.combat = new Combat(() => this.ruleset, this.clock, this.ents,
      (a, b) => this.hostile(a, b), (player, x, y) => this.vision.canSee(player, x, y), {
        result: (entity, status, effect, reason) => this.scripts.result(entity, status, effect, reason),
        attacked: (entity, attacker, damage) => this.scripts.attacked(entity, attacker, damage),
      });
    this.seed = cfg.seed;
    this.maxTicks = this.clock.ticks(matchLengthMs(cfg.ruleset));
    const { width, height } = cfg.ruleset.map;
    this.board = new Board(width, height, (id) => this.deps.has(id) || this.ents.get(id)!.spec.building);
    this.movement = new Movement(() => this.ruleset, this.clock, this.board, this.ents,
      owner => this.player(owner).side, (a, b) => this.hostile(a, b));
    this.players = cfg.players.map((p, i) => ({
      id: p.id, side: p.side ?? i % 2, team: p.team ?? i, name: p.name, mineral: this.ruleset.startMineral, kills: 0, buildingKills: 0, alive: true,
      upgrades: {}, research: null,
    }));
    this.vision = new PlayerVision(() => this.ruleset, this.clock, {
      players: this.players, entities: this.ents, deposits: this.deps, ruined: this.ruined,
    }, (a, b) => this.hostile(a, b));
    this.production = new Production(() => this.ruleset, this.clock, { players: this.players, entities: this.ents, ruined: this.ruined },
      this.movement, (kind, owner, x, y) => this.spawn(kind, owner, x, y));
    // The script VMs are allocated here; anything that fails afterwards must release them.
    this.scripts = new UnitScripts(() => this.ruleset, this.clock, {
      players: this.players, entities: this.ents, ruined: this.ruined, board: this.board,
      vision: this.vision, movement: this.movement, combat: this.combat, hostile: (a, b) => this.hostile(a, b),
    }, cfg.scriptHostFactory ?? createScriptHost, cfg.seed);
    try {
      this.setup();
      this.vision.refresh();
    } catch (error) {
      this.scripts.dispose();
      throw error;
    }
  }

  /** The rules the match plays by; only `stage` replaces them. */
  get ruleset(): Ruleset {
    return this.rules;
  }

  get tick(): number {
    return this.clock.tick;
  }
  get outcome(): Outcome | null {
    return this._outcome;
  }
  get playerIds(): PlayerId[] {
    return this.players.map((p) => p.id);
  }

  /** Applies the orders, then simulates one tick. */
  step(input: PlayerOrder[]): StepResult {
    const orderResults: OrderResult[] = input.map(() => ({ ok: false, reason: "not processed" }));
    const events: GameEvent[] = [];
    if (this._outcome) return { results: input.map(() => ({ ok: false, reason: "match over" })), events };
    const T = this.clock.tick;
    const emit = (e: GameEvent) => {
      this.record(e);
      events.push(e);
    };
    const prio = this.priority();
    // Research and training finish before this tick's orders.
    this.production.deliver(this.interleaved(prio), emit);

    // 1. Orders, alternating between players so nobody always goes first.
    const queues = prio.map((p) => input.map((o, i) => [o, i] as const).filter(([o]) => o.player === p.id));
    for (let k = 0; queues.some((q) => k < q.length); k++) {
      for (const q of queues) if (k < q.length) {
        const [po, index] = q[k];
        const p = this.player(po.player);
        const before = p.mineral;
        const result = this.apply(po, emit);
        if (po.order?.type === "train" || po.order?.type === "build" || po.order?.type === "upgrade") {
          result.mineral = { spent: before - p.mineral, remaining: p.mineral,
            ...(result.ok && po.order.type === "build" ? { pending: this.ruleset.kinds[po.order.kind].cost } : {}) };
        }
        orderResults[index] = result;
      }
    }

    if (this.ruleset.coordinatedMovement) this.movement.assignTargets();
    this.vision.refresh();

    // 2. Legacy orders override scripts. Reactive scripts always run, and may
    // explicitly suspend/cancel an order before choosing their physical action.
    const intents = new Map<string, Intent>();
    const scripted: Entity[] = [];
    for (const e of this.ents.values()) {
      if (!e.spec.moveMs && !e.spec.atk) continue;
      if (this.ruined.has(e.owner)) continue; // ruins never act
      if (this.ruleset.reactiveOrders && e.spec.scriptable) {
        scripted.push(e);
        continue;
      }
      const intent = e.order ? this.orderIntent(e, emit) : null;
      if (intent) {
        intents.set(e.id, intent);
        e.actionResult = { tick: T, source: "order", intent: describeIntent(intent), status: intent.t === "hold" ? "held" : intent.t === "build" ? "working" : "blocked" };
      }
      else if (e.spec.scriptable) scripted.push(e);
    }
    for (const p of prio) {
      const mine = scripted.filter((e) => e.owner === p.id);
      if (mine.length === 0) continue;
      this.scripts.decide(p, mine, emit, (e, r) => {
        const orderIntent = this.ruleset.reactiveOrders ? this.reactiveOrderIntent(e, r, emit) : null;
        if (orderIntent) {
          intents.set(e.id, orderIntent);
          e.actionResult = { tick: T, source: "order", intent: describeIntent(orderIntent), status: orderIntent.t === "hold" ? "held" : orderIntent.t === "build" ? "working" : "blocked" };
          return;
        }
        const intent = this.scriptIntent(e, r.action);
        const impossible = intent.t === "hold" && r.action.a !== "hold";
        e.lastActionResult = { tick: T, action: r.action,
          status: r.error || impossible ? "invalid" : intent.t === "hold" ? "held" : "blocked",
          ...(r.error ? { reason: r.error } : impossible ? { reason: "action has no valid target or cannot be performed" } : {}) };
        e.actionResult = { tick: T, source: "script", intent: describeIntent(intent), status: e.lastActionResult.status, ...(e.lastActionResult.reason ? { reason: e.lastActionResult.reason } : {}) };
        intents.set(e.id, intent);
      });
    }

    for (const e of this.ents.values()) {
      const it = intents.get(e.id);
      e.doing = it ? describeIntent(it) : e.spec.moveMs || e.spec.atk ? "hold" : "";
    }

    // 3. Resolve movement in player priority, allowing friendly columns to depart front to back.
    this.movement.advance(this.interleaved(prio), intents, {
      result: (entity, status, effect, reason) => this.scripts.result(entity, status, effect, reason),
      endOrder: (entity, reason) => this.endOrder(entity, reason, emit),
    });

    this.vision.refresh();

    // 4. Combat resolves all hits before deaths are applied below.
    const { damage, lastHit } = this.combat.resolve(this.interleaved(prio), intents, emit);

    // 5. Economy and construction.
    for (const e of this.interleaved(prio)) {
      const it = intents.get(e.id);
      if (it?.t === "gather") {
        const before = e.carrying;
        this.gatherFrom(e, it.id, emit);
        this.scripts.result(e, e.carrying > before ? "acted" : T < e.nextGather ? "cooldown" : "blocked", e.carrying > before ? "gather" : undefined);
      } else if (it?.t === "unload") {
        const before = e.carrying;
        this.unload(e, emit);
        this.scripts.result(e, before > 0 ? "acted" : "invalid", before > 0 ? "unload" : undefined);
      }
      else if (it?.t === "build") this.build(e, emit);
    }

    for (const e of this.ents.values()) this.orderProgress.record(e);

    // 6. Deaths and the vital rule.
    const fallen: Player[] = [];
    for (const [id, dmg] of damage) {
      const e = this.ents.get(id)!;
      e.hp -= dmg;
      if (e.hp > 0) continue;
      const by = lastHit.get(id);
      const killer = this.players.find((p) => p.id === by);
      if (killer && !this.ruined.has(e.owner)) e.spec.building ? killer.buildingKills++ : killer.kills++;
      this.remove(e);
      emit({ tick: T, type: "death", id, kind: e.kind, owner: e.owner, x: e.x, y: e.y, by });
      if (e.spec.vital) {
        const owner = this.player(e.owner);
        if (owner.alive) { owner.alive = false; fallen.push(owner); }
      }
    }
    this.checkEnd(T, emit);
    // In team matches the game can go on without them: everything they had falls.
    if (!this._outcome) for (const p of fallen) this.eliminate(p, emit);

    // A build may complete in the same tick as its order. Otherwise its later
    // spawn event carries the actual charge, rather than claiming it was prepaid.
    input.forEach(({ order, player }, i) => {
      if (order?.type !== "build" || !orderResults[i].ok) return;
      if (input.some((later, j) => j > i && orderResults[j].ok && later.player === player && later.order?.type === "build" && later.order.unit === order.unit)) return;
      const built = events.find((e) => e.type === "spawn" && e.builder === order.unit && e.owner === player && e.kind === order.kind && e.x === order.x && e.y === order.y);
      if (built?.type === "spawn" && built.mineral) orderResults[i].mineral = built.mineral;
    });
    this.vision.refresh();
    this.clock.tick++;
    this.vision.trimCombat();
    const cutoff = this.clock.tick - EVENT_WINDOW_TICKS;
    if (this.log.length > 0 && this.log[0].tick < cutoff) this.log = this.log.filter((e) => e.tick >= cutoff);
    return { results: orderResults, events };
  }

  /** Events `player` may see with tick ≥ `since` (attacks excluded: too many). */
  events(player: PlayerId, since: number): GameEvent[] {
    return this.log.filter((e) => e.tick >= since && e.type !== "attack" && e.type !== "projectile_end" && visibleTo(e, player)
      && (e.type === "match_end" || this.eventAudience.get(e)?.has(player))
      && (e.type !== "chat" || this.canRead(player, e)))
      .map((e) => {
        if (e.type === "spawn" && this.hostile(e.owner, player)) {
          const { mineral, ...publicEvent } = e; return publicEvent;
        }
        return e;
      });
  }

  /** What `player` sees. Events are those with tick ≥ `since` (default: the last 10 s). */
  view(player: PlayerId, since?: number): PlayerView {
    const p = this.player(player);
    const events = this.events(player, since ?? this.clock.tick - this.clock.ticks(10_000));
    return {
      tick: this.clock.tick,
      timeMs: this.clock.ms(this.clock.tick),
      matchMs: matchLengthMs(this.ruleset),
      drawsAreLosses: this.ruleset.drawsAreLosses,
      status: this.status(),
      you: player,
      players: this.stats(player),
      visibility: this.vision.rows(player),
      grid: this.vision.ascii(player),
      ...this.visibleEntities(player),
      deposits: this.depositViews().filter((d) => this.vision.canSee(player, d.x, d.y)),
      projectiles: this.combat.views(player),
      scripts: this.scripts.view(p),
      availableActions: this.production.availableActions(p, !p.alive ? ["player eliminated"] : this._outcome ? ["match over"] : []),
      combat: this.vision.combatSummary(player, since ?? this.clock.tick - this.clock.ticks(10_000)),
      events,
      underAttack: this.underAttack(player, since ?? this.clock.tick - this.clock.ticks(10_000)),
      lastSeen: this.vision.remembered(player),
      outcome: this._outcome ?? undefined,
    };
  }

  /** Shared by agent observations and spectator perspectives, in creation order. */
  private visibleEntities(player: PlayerId): Pick<PlayerView, "mine" | "allies" | "enemy"> {
    const mine: EntityView[] = [], allies: EntityView[] = [], enemy: EntityView[] = [];
    for (const e of this.ents.values()) {
      if (e.owner === player) mine.push(this.entityView(e, player));
      else if (!this.hostile(e.owner, player)) allies.push(this.entityView(e, player));
      else if (this.vision.canSee(player, e.x, e.y)) enemy.push(this.entityView(e, player));
    }
    return { mine, allies, enemy };
  }

  /** Damage to `player`'s living entities since `since`, grouped by target, from hits and landed projectiles. */
  private underAttack(player: PlayerId, since: number): UnderAttack[] {
    const shooters = new Map<string, string>();
    const hits = new Map<string, { damage: number; attackers: Set<string> }>();
    for (const e of this.log) {
      if (e.type === "attack" && e.projectile) shooters.set(e.projectile, e.from);
      if (e.tick < since) continue;
      const hit = e.type === "attack" && !e.projectile && e.to ? { target: e.to, from: e.from, dmg: e.dmg }
        : e.type === "projectile_end" && e.reason === "hit" && e.target ? { target: e.target, from: shooters.get(e.id), dmg: e.dmg } : null;
      if (!hit || this.ents.get(hit.target)?.owner !== player) continue;
      const h = hits.get(hit.target) ?? { damage: 0, attackers: new Set<string>() };
      h.damage += hit.dmg;
      h.attackers.add(hit.from ?? "?");
      hits.set(hit.target, h);
    }
    return [...hits].map(([id, h]) => {
      const t = this.ents.get(id)!;
      const seen = [...h.attackers].map((a) => this.ents.get(a)).filter((a): a is Entity => !!a && this.vision.canSee(player, a.x, a.y));
      return { id, kind: t.kind, x: t.x, y: t.y, hp: t.hp, maxHp: t.spec.hp, damage: h.damage,
        attackers: seen.map((a) => ({ id: a.id, kind: a.kind, owner: a.owner })), unseenAttackers: h.attackers.size - seen.length };
    }).sort((a, b) => b.damage - a.damage);
  }

  /** Events default to the last tick's. Only finished-match replays opt into private chat. */
  spectate(since?: number, options: { includePrivateChat?: boolean; includeTeamChat?: boolean; includePerspectives?: boolean } = {}): SpectatorView {
    const from = since ?? this.clock.tick - 1;
    // Spectators read public chat; team and private chat only when a finished replay opts in.
    const spectatorReads = (e: GameEvent) => e.type !== "chat"
      || (e.channel === "private" ? !!options.includePrivateChat : e.channel !== "team" || !!options.includePrivateChat || !!options.includeTeamChat);
    return {
      chat: this.conversation.filter(spectatorReads).map((e) => this.message(e)),
      playerChats: Object.fromEntries(this.players.map((p) => [p.id, this.chat(p.id)])),
      tick: this.clock.tick,
      timeMs: this.clock.ms(this.clock.tick),
      matchMs: matchLengthMs(this.ruleset),
      status: this.status(),
      players: this.stats(),
      entities: [...this.ents.values()].map((e) => this.entityView(e)),
      projectiles: this.combat.views(),
      ...(options.includePerspectives === false ? {} : { perspectives: Object.fromEntries(this.players.map((p) => {
        const visible = this.visibleEntities(p.id);
        // The player's fog memory, so an observer sees explored ground as that player remembers it.
        const remembered = this.vision.remembered(p.id);
        const buildings: EntityView[] = remembered.flatMap((l) => l.kind !== "deposit" && !l.positionCleared ? [{ id: l.id, kind: l.kind, owner: l.owner, x: l.x, y: l.y, hp: l.hp, maxHp: l.maxHp,
          vital: !!this.ruleset.kinds[l.kind]?.vital, ...(l.ruin ? { ruin: true } : {}), lastSeenMs: l.seenMs }] : []);
        const deposits: DepositView[] = remembered.flatMap((l) => l.kind === "deposit" ? [{ id: l.id, x: l.x, y: l.y, amount: l.amount, lastSeenMs: l.seenMs }] : []);
        return [p.id, { visibility: this.vision.rows(p.id), entities: [...visible.mine, ...visible.allies, ...visible.enemy, ...buildings],
          projectiles: this.combat.views(p.id),
          deposits: [...this.depositViews().filter(d => this.vision.canSee(p.id, d.x, d.y)), ...deposits], players: this.stats(p.id).map((s) => ({ ...s, name: this.player(s.id).name })), events: [...this.events(p.id, from).filter((e) => e.type !== "log" && e.type !== "script_error" && spectatorReads(e)),
            ...this.log.filter((e) => e.tick >= from && (e.type === "attack" || e.type === "projectile_end") && this.eventAudience.get(e)?.has(p.id))] }];
      })) }),
      deposits: this.depositViews(),
      events: this.log.filter((e) => e.tick >= from && e.type !== "log" && e.type !== "script_error" && spectatorReads(e)),
      outcome: this._outcome ?? undefined,
    };
  }

  /** The whole conversation `player` may read, oldest first. */
  chat(player: PlayerId): ChatMessage[] {
    return this.conversation.filter((e) => this.canRead(player, e)).map((e) => this.message(e));
  }

  /** Private messages are read only by their two players; team messages by the sender's team. */
  private canRead(player: PlayerId, e: Extract<GameEvent, { type: "chat" }>): boolean {
    return e.channel === "private" ? e.owner === player || e.to === player : e.channel !== "team" || !this.hostile(e.owner, player);
  }

  private message(e: Extract<GameEvent, { type: "chat" }>): ChatMessage {
    return { tick: e.tick, from: e.owner, name: this.player(e.owner).name, text: e.text, ...(e.channel ? { channel: e.channel } : {}), ...(e.to ? { to: e.to } : {}) };
  }

  isAlive(player: PlayerId): boolean {
    return this.player(player).alive;
  }

  /** Source of the script `player` runs for `kind`. */
  scriptSource(player: PlayerId, kind: string): { code: string; custom: boolean } | null {
    return this.scripts.source(this.player(player), kind);
  }

  /** Applies `edit`, then recomputes what entity changes invalidate: routes and vision. */
  stage(edit: (stage: Stage) => void): void {
    const entity = (id: string) => {
      const e = this.ents.get(id);
      if (!e) throw new Error(`no entity ${id}`);
      return e;
    };
    edit({
      useRuleset: (ruleset) => {
        this.rules = ruleset;
        for (const e of this.ents.values()) {
          const spec = this.specOf(e.owner, e.kind);
          e.hp = Math.max(1, Math.round(e.hp / e.spec.hp * spec.hp)); e.spec = spec;
        }
      },
      spawn: (kind, owner, x, y, hpShare = 1) => {
        const e = this.spawn(kind, owner, x, y);
        e.hp = Math.max(1, Math.round(hpShare * e.spec.hp));
        return e.id;
      },
      remove: (id) => this.remove(entity(id)),
      relocate: (id, x, y) => {
        const e = entity(id);
        if (e.spec.building || !this.stageFree(x, y)) throw new Error(`cannot move ${id} to ${x},${y}`);
        this.board.move(e, x, y);
        e.x = x; e.y = y;
      },
      isFree: (x, y) => this.stageFree(x, y),
      setHealth: (id, hp) => { entity(id).hp = hp; },
      setResearch: (player, upgrade, level) => { this.player(player).upgrades[upgrade] = level; },
    });
    for (const e of this.ents.values()) { e.path = null; e.pathKey = ""; }
    this.vision.refresh();
  }

  private stageFree(x: number, y: number): boolean {
    return inBounds(this.board, x, y) && this.board.occupant(x, y) === null && !this.board.door(x, y) && !this.board.site(x, y);
  }

  /** What a spectator sees of one entity, or undefined once it is gone. */
  inspect(id: string): EntityView | undefined {
    const e = this.ents.get(id);
    return e && this.entityView(e);
  }

  /** Compile and run a proposed script against own current units in a separate VM.
   * Returns requested actions, errors and gas; it does not advance the match or
   * modify the player's installed script, memory, PRNG or event cursor.
   */
  testScript(player: PlayerId, kind: string, code: string) {
    return this.scripts.test(this.player(player), kind, code);
  }

  /** `player` leaves (e.g. disconnected): its side loses if it has nobody else left, else it is out. */
  forfeit(player: PlayerId): void {
    if (this._outcome) return;
    const p = this.player(player);
    p.alive = false;
    const teams = this.aliveTeams();
    const record = (e: GameEvent) => this.record(e);
    if (teams.size <= 1) this.finish(this.teamOf([...teams][0]), "forfeit", this.clock.tick, record);
    else this.eliminate(p, record);
    this.vision.refresh();
  }

  /** Compact fingerprint of the state, to detect replay desyncs. */
  hash(): string {
    let h = 0x811c9dc5;
    const mix = (n: number) => {
      h ^= n & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (n >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (n >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
    };
    mix(this.clock.tick);
    for (const p of this.players) mix(p.mineral);
    for (const e of this.ents.values()) {
      for (let i = 0; i < e.id.length; i++) mix(e.id.charCodeAt(i));
      mix(e.x); mix(e.y); mix(e.hp); mix(e.carrying);
      mix(e.lastAttacked?.tick ?? -1);
      for (const ch of e.lastAttacked?.id ?? "") mix(ch.charCodeAt(0));
      if (this.ruleset.coordinatedMovement) { mix(e.moveTarget?.x ?? -1); mix(e.moveTarget?.y ?? -1); }
      if (this.ruleset.reactiveOrders) for (const ch of JSON.stringify([e.order, !!e.orderSuspended, e.scriptEvents ?? [], e.seenEnemies ?? []])) mix(ch.charCodeAt(0));
    }
    for (const d of this.deps.values()) mix(d.amount);
    for (const p of this.players) {
      for (const id of Object.keys(this.ruleset.upgrades).sort()) {
        mix(p.upgrades[id] ?? 0);
        mix(p.research?.upgrade === id ? p.research.level : 0);
        mix(p.research?.upgrade === id ? p.research.completesAtTick : 0);
      }
    }
    for (const e of this.ents.values()) {
      mix(e.construction?.completesAtTick ?? 0);
      mix(e.construction?.x ?? 0); mix(e.construction?.y ?? 0);
      for (const ch of e.construction?.kind ?? "") mix(ch.charCodeAt(0));
    }
    for (const e of this.ents.values()) {
      mix(e.training?.length ?? 0);
      for (const job of e.training ?? []) {
        for (const ch of job.kind) mix(ch.charCodeAt(0));
        mix(job.completesAtTick ?? 0);
      }
    }
    this.vision.hashKnowledge(mix);
    this.combat.hashProjectiles(mix);
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  dispose(): void {
    this.scripts.dispose();
  }

  // ───────────────────────── setup ─────────────────────────

  private setup() {
    const { map } = this.ruleset;
    const mirror = (x: number, y: number, side: number) => seatToMap(x, y, side, map.width, map.height);
    for (const w of map.walls ?? []) this.board.placeRock(w.x, w.y);
    for (const p of this.players) {
      for (const d of map.deposits) {
        const [x, y] = mirror(d.x, d.y, p.side);
        this.addDeposit(x, y, d.amount);
      }
    }
    for (const d of map.sharedDeposits) this.addDeposit(d.x, d.y, d.amount);
    for (const s of map.start) {
      for (const p of this.players) {
        const [x, y] = mirror(s.x, s.y, p.side);
        this.spawn(s.kind, p.id, x, y);
      }
    }
    if (map.neutralWalls?.length) {
      // Scenario walls are the rules' wall line pieces, owned by nobody.
      const [kind, wall] = Object.entries(this.ruleset.kinds).find(([, spec]) => spec.barrier && !spec.alliedPassage) ?? [];
      if (!kind || !wall?.building || wall.vital) throw new Error("Neutral walls require a non-vital wall building without allied passage");
      this.ruined.add(NEUTRAL_OWNER);
      for (const w of map.neutralWalls) {
        if (!Number.isInteger(w.x) || !Number.isInteger(w.y) || !inBounds(this.board, w.x, w.y)
          || this.board.occupant(w.x, w.y) !== null || this.board.door(w.x, w.y)) {
          throw new Error(`Invalid or occupied neutral wall tile ${w.x},${w.y}`);
        }
        this.spawn(kind as EntityKind, NEUTRAL_OWNER, w.x, w.y);
      }
    }
  }

  private addDeposit(x: number, y: number, amount: number) {
    const id = `d${this.deps.size + 1}`;
    this.deps.set(id, { id, x, y, amount });
    this.board.placeDeposit(id, x, y);
  }

  /** A kind's stats for its owner: research applies to players; scenario walls use the rules as written. */
  private specOf(owner: PlayerId, kind: string): KindSpec {
    return owner === NEUTRAL_OWNER ? this.ruleset.kinds[kind] : this.production.specFor(this.player(owner), kind);
  }

  private spawn(kind: EntityKind, owner: PlayerId, x: number, y: number): Entity {
    const spec = this.specOf(owner, kind);
    const e: Entity = {
      id: `e${this.nextId++}`, kind, spec, owner, x, y, hp: spec.hp,
      order: spec.gathers && !spec.scriptable ? { type: "gather" } : null,
      nextMove: 0, nextAttack: 0, nextGather: 0, carrying: 0, path: null, pathKey: "", blocked: 0, doing: "", lastStep: null,
    };
    this.ents.set(e.id, e);
    this.board.place(e);
    return e;
  }

  private clearConstruction(e: Entity) {
    if (!e.construction) return;
    this.board.release(e.construction.x, e.construction.y, e.id);
    e.construction = undefined;
  }

  private remove(e: Entity) {
    this.clearConstruction(e);
    this.ents.delete(e.id);
    this.board.remove(e);
  }

  // ───────────────────────── orders ─────────────────────────

  private apply(po: PlayerOrder, emit: (e: GameEvent) => void): OrderResult {
    const bad = validateOrder(po.order);
    if (bad) return { ok: false, reason: bad };
    const p = this.player(po.player);
    const o = po.order;
    if (!p.alive) return { ok: false, reason: "you are out of the match" };
    if (o.type === "script") return this.scripts.setScript(p, o.kind, o.code);
    if (o.type === "chat") {
      if (o.to !== undefined && o.channel !== undefined && o.channel !== "private") {
        return { ok: false, reason: "to requires private chat (omit channel or use private)" };
      }
      if (o.to !== undefined || o.channel === "private") {
        if (!o.to || o.to === p.id || !this.players.some((other) => other.id === o.to)) {
          return { ok: false, reason: "private chat requires another player id in to" };
        }
        emit({ tick: this.clock.tick, type: "chat", owner: p.id, text: o.text.trim(), channel: "private", to: o.to });
        return { ok: true };
      }
      if (o.channel === "team" && !this.players.some((ally) => ally.id !== p.id && ally.team === p.team)) {
        return { ok: false, reason: "team chat requires a teammate" };
      }
      emit({ tick: this.clock.tick, type: "chat", owner: p.id, text: o.text.trim(), ...(o.channel ? { channel: o.channel } : {}) });
      return { ok: true };
    }
    if (o.type === "train") return this.production.train(p, o.building, o.kind, emit);
    if (o.type === "upgrade") return this.production.research(p, o.upgrade, emit);

    const e = this.ents.get(o.unit);
    if (!e || e.owner !== p.id) return { ok: false, reason: `no entity ${o.unit} of yours` };
    if (!e.spec.moveMs) return { ok: false, reason: `${e.kind} cannot take orders` };
    const { width, height } = this.ruleset.map;
    switch (o.type) {
      case "stop":
        if (this.ruleset.reactiveOrders && e.order) this.endOrder(e, "stopped", emit);
        else { this.clearConstruction(e); e.order = null; e.path = null; }
        return { ok: true };
      case "move":
        if (!inBounds(this.board, o.x, o.y)) return { ok: false, reason: `(${o.x},${o.y}) is outside the ${width}x${height} map` };
        this.clearConstruction(e);
        this.assignOrder(e, { type: "move", x: o.x, y: o.y }, emit);
        return { ok: true };
      case "attack": {
        const t = this.ents.get(o.target);
        if (!e.spec.atk) return { ok: false, reason: `${e.kind} cannot attack` };
        if (!t || !this.vision.canSee(p.id, t.x, t.y)) return { ok: false, reason: `target ${o.target} is not visible or does not exist` };
        if (t.owner === p.id) return { ok: false, reason: `${o.target} is yours` };
        if (!this.hostile(t.owner, p.id)) return { ok: false, reason: `${o.target} is your ally's` };
        this.clearConstruction(e);
        this.assignOrder(e, { type: "attack", target: t.id }, emit);
        return { ok: true };
      }
      case "gather":
        if (!e.spec.gathers) return { ok: false, reason: `${e.kind} cannot gather` };
        if (o.deposit !== undefined && (!this.deps.has(o.deposit) || !this.vision.deposits(p.id)?.has(o.deposit))) return { ok: false, reason: `no deposit ${o.deposit}` };
        this.clearConstruction(e);
        this.assignOrder(e, { type: "gather", deposit: o.deposit }, emit);
        return { ok: true };
      case "build": {
        const spec = this.ruleset.kinds[o.kind], kind = e.spec.builds?.find((k) => k === o.kind);
        if (!kind || !spec) return { ok: false, reason: `${e.kind} cannot build ${o.kind}` };
        const lock = this.production.lockReason(p, o.kind);
        if (lock) return { ok: false, reason: lock };
        if (!inBounds(this.board, o.x, o.y)) return { ok: false, reason: `(${o.x},${o.y}) is outside the map` };
        if (!this.vision.canSee(p.id, o.x, o.y)) return { ok: false, reason: "build site must be visible" };
        if (this.board.isStatic(o.x, o.y) && this.board.site(o.x, o.y) !== e.id) return { ok: false, reason: `(${o.x},${o.y}) is occupied` };
        if (this.makesDoorCorner(p.id, kind, o.x, o.y)) return { ok: false, reason: "doors must stay on one wall axis; no corners or junctions" };
        const shortfall = this.production.shortfall(p, spec.cost);
        if (shortfall) return { ok: false, reason: shortfall };
        const near = this.enemyBuildingNear(p.id, o.x, o.y);
        if (near) return { ok: false, reason: `too close to enemy ${near.kind} ${near.id}: keep ${this.ruleset.buildExclusion}+ tiles away` };
        if (e.construction && (e.construction.kind !== o.kind || e.construction.x !== o.x || e.construction.y !== o.y)) this.clearConstruction(e);
        this.assignOrder(e, { type: "build", kind, x: o.x, y: o.y }, emit);
        return { ok: true };
      }
    }
  }

  private endOrder(e: Entity, reason: OrderEndReason, emit: (e: GameEvent) => void) {
    if (this.ruleset.reactiveOrders && e.order) {
      this.scripts.orderEnded(e, e.order, reason);
      e.orderSuspended = false;
    }
    e.order = null;
    this.settle(e);
    emit({ tick: this.clock.tick, type: "order_end", id: e.id, owner: e.owner, reason });
  }

  /** Drops a unit's route, order progress and unfinished construction. */
  private settle(e: Entity) {
    this.orderProgress.clear(e);
    delete e.moveTarget;
    this.clearConstruction(e);
    e.path = null;
  }

  private assignOrder(e: Entity, order: UnitOrder, emit: (e: GameEvent) => void) {
    if (e.order?.type !== "move" || order.type !== "move" || e.order.x !== order.x || e.order.y !== order.y) delete e.moveTarget;
    if (this.ruleset.reactiveOrders) {
      if (e.order && JSON.stringify(e.order) !== JSON.stringify(order)) this.endOrder(e, "replaced", emit);
      e.orderSuspended = false;
    }
    e.order = order;
    this.orderProgress.begin(e, order);
  }

  private reactiveOrderIntent(e: Entity, run: UnitRun, emit: (e: GameEvent) => void): Intent | null {
    if (!e.order) return null;
    if (run.orderControl === "cancel") { this.endOrder(e, "cancelled by script", emit); return null; }
    if (run.orderControl === "suspend" && !e.orderSuspended) {
      e.orderSuspended = true;
      // An interrupted builder releases the site and its unfinished work;
      // elapsed suspension time must never count as construction progress.
      this.clearConstruction(e);
      e.path = null;
    } else if (run.orderControl === "continue") e.orderSuspended = false;
    return e.orderSuspended ? null : this.orderIntent(e, emit);
  }

  // ───────────────────────── intents ─────────────────────────

  private orderIntent(e: Entity, emit: (e: GameEvent) => void): Intent | null {
    const o = e.order!;
    const range = e.spec.range ?? 1;
    switch (o.type) {
      case "move": {
        const goal = this.ruleset.coordinatedMovement ? e.moveTarget ?? o : o;
        if (this.movement.arrived(e, goal.x, goal.y, 0)) return this.endOrder(e, "arrived", emit), null;
        return { t: "goto", x: goal.x, y: goal.y, range: this.movement.arrivalRange(e.owner, goal.x, goal.y, 0) };
      }
      case "attack": {
        const t = this.ents.get(o.target);
        if (!t || !this.vision.canSee(e.owner, t.x, t.y)) return this.endOrder(e, "target lost", emit), null;
        if (inAttackRange(e, t)) return { t: "attack", id: t.id };
        return { t: "goto", x: t.x, y: t.y, range };
      }
      case "build": {
        const d = dist(e.x, e.y, o.x, o.y);
        if (d === 0) {
          const off = this.movement.freeNeighbor(e.x, e.y, e.owner);
          return off ? { t: "dir", dx: off[0] - e.x, dy: off[1] - e.y } : { t: "hold" };
        }
        return d <= 1 ? { t: "build" } : { t: "goto", x: o.x, y: o.y, range: 1 };
      }
      case "gather": {
        const step = this.gatherIntent(e, o);
        return "end" in step ? (this.endOrder(e, step.end, emit), null) : step;
      }
    }
  }

  /** The next gathering step, or why gathering cannot go on. Ending an order is the caller's decision. */
  private gatherIntent(e: Entity, o: { type: "gather"; deposit?: string }): Intent | { end: OrderEndReason } {
    let dep = o.deposit ? this.deps.get(o.deposit) : undefined;
    if (!dep) {
      dep = this.nearestDeposit(e);
      o.deposit = dep?.id;
    }
    if (e.carrying >= this.ruleset.gather.carry || (e.carrying > 0 && !dep)) {
      const drop = this.nearestOwn(e, (x) => !!x.spec.dropoff);
      if (!drop) return { end: "no dropoff" };
      return dist(e.x, e.y, drop.x, drop.y) <= 1 ? { t: "unload", id: drop.id } : { t: "goto", x: drop.x, y: drop.y, range: 1 };
    }
    if (!dep) return { end: "no deposits left" };
    return dist(e.x, e.y, dep.x, dep.y) <= 1 ? { t: "gather", id: dep.id } : { t: "goto", x: dep.x, y: dep.y, range: 1 };
  }

  /** Script actions are untrusted: anything invalid becomes hold. */
  private scriptIntent(e: Entity, a: ScriptAction): Intent {
    const { width, height } = this.ruleset.map;
    switch (a.a) {
      case "gather": {
        if (!e.spec.gathers) return { t: "hold" };
        if (a.id !== undefined && !this.vision.deposits(e.owner)?.has(a.id)) return { t: "hold" };
        const step = this.gatherIntent(e, { type: "gather", deposit: a.id });
        if (!("end" in step)) return step;
        // The script's own action never ends the order it suspended; a unit without one stops where it is.
        if (!e.order) this.settle(e);
        return { t: "hold" };
      }
      case "unload": {
        if (!e.spec.gathers || !e.carrying) return { t: "hold" };
        const drop = this.nearestOwn(e, x => !!x.spec.dropoff);
        if (!drop) return { t: "hold" };
        return dist(e.x, e.y, drop.x, drop.y) <= 1
          ? { t: "unload", id: drop.id }
          : { t: "goto", x: drop.x, y: drop.y, range: 1 };
      }
      case "move": {
        const [dx, dy] = DIRS[a.dir];
        return { t: "dir", dx, dy };
      }
      case "moveTo":
        return { t: "goto", x: clamp(a.x, 0, width - 1), y: clamp(a.y, 0, height - 1), range: 0 };
      case "attack": {
        const t = this.ents.get(a.id);
        if (!t || !this.vision.canSee(e.owner, t.x, t.y) || !this.hostile(t.owner, e.owner) || !e.spec.atk) return { t: "hold" };
        const range = e.spec.range ?? 1;
        if (inAttackRange(e, t)) return { t: "attack", id: t.id };
        return e.spec.moveMs ? { t: "goto", x: t.x, y: t.y, range } : { t: "hold" };
      }
      case "shootAt":
        return { t: "shoot", x: clamp(a.x, 0, width - 1), y: clamp(a.y, 0, height - 1) };
      case "flee": {
        const t = this.ents.get(a.id);
        if (!t || !this.vision.canSee(e.owner, t.x, t.y) || !e.spec.moveMs) return { t: "hold" };
        let best: [number, number] | null = null;
        let bestD = dist(e.x, e.y, t.x, t.y);
        for (const [dx, dy] of this.movement.directions(e.owner)) {
          const d = dist(e.x + dx, e.y + dy, t.x, t.y);
          if (d > bestD && this.movement.canStep(e, e.x + dx, e.y + dy)) [best, bestD] = [[dx, dy], d];
        }
        return best ? { t: "dir", dx: best[0], dy: best[1] } : { t: "hold" };
      }
      default:
        return { t: "hold" };
    }
  }

  // ───────────────────────── economy ─────────────────────────

  private gatherFrom(e: Entity, depId: string, emit: (e: GameEvent) => void) {
    const d = this.deps.get(depId);
    if (!d || this.clock.tick < e.nextGather || e.carrying >= this.ruleset.gather.carry) return;
    e.carrying++;
    d.amount--;
    e.nextGather = this.clock.tick + this.clock.ticks(this.ruleset.gather.ms);
    if (d.amount <= 0) {
      this.deps.delete(d.id);
      this.board.clearDeposit(d.x, d.y);
      emit({ tick: this.clock.tick, type: "depleted", id: d.id });
    }
  }

  private unload(e: Entity, emit: (e: GameEvent) => void) {
    if (e.carrying === 0) return;
    this.player(e.owner).mineral += e.carrying;
    emit({ tick: this.clock.tick, type: "unload", id: e.id, owner: e.owner, amount: e.carrying });
    e.carrying = 0;
  }

  /** Check the prospective layout, including reserved builds, in either construction order. */
  private makesDoorCorner(owner: PlayerId, kind: EntityKind, x: number, y: number): boolean {
    const lines = (k: EntityKind | undefined) => !!(k && (this.ruleset.kinds[k]?.barrier || this.ruleset.kinds[k]?.alliedPassage));
    if (!lines(kind)) return false;
    const at = (tx: number, ty: number): EntityKind | undefined => {
      if (tx === x && ty === y) return kind;
      if (!inBounds(this.board, tx, ty)) return undefined;
      const entity = this.ents.get(this.board.door(tx, ty) ?? this.board.occupant(tx, ty) ?? "");
      if (entity?.owner === owner) return entity.kind;
      const builder = this.ents.get(this.board.site(tx, ty) ?? "");
      return builder?.owner === owner ? builder.construction?.kind : undefined;
    };
    const has = (tx: number, ty: number) => lines(at(tx, ty));
    for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const k = at(x + dx, y + dy);
      if (!k || !this.ruleset.kinds[k]?.alliedPassage) continue;
      const { alongX, alongY } = barrierAxes(x + dx, y + dy, has);
      if (alongX && alongY) return true;
    }
    return false;
  }

  private build(e: Entity, emit: (e: GameEvent) => void) {
    const o = e.order;
    if (o?.type !== "build") return;
    const p = this.player(e.owner);
    const spec = this.ruleset.kinds[o.kind];
    const reserved = this.board.site(o.x, o.y);
    if (reserved && reserved !== e.id) return this.endOrder(e, "site reserved by another builder", emit);
    const occupant = this.board.door(o.x, o.y) ?? this.board.occupant(o.x, o.y);
    if (occupant !== null) {
      this.clearConstruction(e);
      if (this.board.isStatic(o.x, o.y)) this.endOrder(e, "tile blocked", emit);
      return; // a unit is standing there; wait
    }
    if (this.makesDoorCorner(p.id, o.kind, o.x, o.y)) return this.endOrder(e, "doors must stay on one wall axis; no corners or junctions", emit);
    if (p.mineral < spec.cost) return this.endOrder(e, "not enough mineral", emit);
    if (this.enemyBuildingNear(p.id, o.x, o.y)) return this.endOrder(e, "too close to an enemy building", emit);
    if (spec.buildMs) {
      if (!e.construction) {
        e.construction = { kind: o.kind, x: o.x, y: o.y, completesAtTick: this.clock.tick + this.clock.ticks(spec.buildMs) };
        this.board.reserve(o.x, o.y, e.id);
        emit({ tick: this.clock.tick, type: "construction_started", owner: p.id, builder: e.id, kind: o.kind,
          x: o.x, y: o.y, completesAtMs: this.clock.ms(e.construction.completesAtTick) });
      }
      if (this.clock.tick < e.construction.completesAtTick) return;
    }
    p.mineral -= spec.cost;
    const b = this.spawn(o.kind, p.id, o.x, o.y);
    emit({ tick: this.clock.tick, type: "spawn", id: b.id, kind: o.kind, owner: p.id, x: b.x, y: b.y, builder: e.id, mineral: { spent: spec.cost, remaining: p.mineral } });
    if (this.ruleset.reactiveOrders) this.endOrder(e, "completed", emit);
    e.order = e.spec.gathers && !e.spec.scriptable ? { type: "gather" } : null;
    this.clearConstruction(e);
    e.path = null;
  }

  // ───────────────────────── end ─────────────────────────

  /** Elimination takes priority; at the time limit there is no winning side. */
  private checkEnd(T: number, emit: (e: GameEvent) => void) {
    const teams = this.aliveTeams();
    if (teams.size <= 1 && this.players.some((p) => !p.alive)) {
      this.finish(this.teamOf([...teams][0]), "vital_lost", T, emit);
    } else if (T + 1 >= this.maxTicks) {
      this.finish([], "timeout", T, emit);
    }
  }

  private aliveTeams(): Set<number> {
    return new Set(this.players.filter((p) => p.alive).map((p) => p.team));
  }

  /** Every player of `team` (none for undefined: no winning side). */
  /** Every event goes through here: who may see it, combat memory, the event log and the conversation. */
  private record(e: GameEvent) {
    this.eventAudience.set(e, new Set(this.players.filter((p) => this.vision.canSeeEvent(p.id, e)).map((p) => p.id)));
    this.vision.recordCombat(e);
    this.log.push(e);
    if (e.type === "chat") this.conversation.push(e);
  }

  private teamOf(team: number | undefined): PlayerId[] {
    return this.players.filter((p) => p.team === team).map((p) => p.id);
  }

  private finish(winners: PlayerId[], reason: Outcome["reason"], T: number, emit: (e: GameEvent) => void) {
    const scores: Record<PlayerId, number> = {};
    for (const p of this.players) scores[p.id] = this.score(p);
    this._outcome = { winner: winners.length === 1 ? winners[0] : null, winners, reason, scores,
      ...(!winners.length && this.ruleset.drawsAreLosses ? { allDefeated: true as const } : {}) };
    const e: GameEvent = { tick: T, type: "match_end", outcome: this._outcome };
    emit(e);
  }

  // ───────────────────────── helpers ─────────────────────────

  private player(id: PlayerId): Player {
    const p = this.players.find((x) => x.id === id);
    if (!p) throw new Error(`unknown player ${id}`);
    return p;
  }

  /** Players in this tick's priority order: rotates every tick, so each goes first in turn. */
  private priority(): Player[] {
    const k = this.clock.tick % this.players.length;
    return [...this.players.slice(k), ...this.players.slice(0, k)];
  }

  /** Can `a`'s entities attack `b`'s? Teammates can't hurt each other. */
  private hostile(a: PlayerId, b: PlayerId): boolean {
    // Scenario walls can be attacked by every team, but never become a player.
    if (a === NEUTRAL_OWNER || b === NEUTRAL_OWNER) return a !== b;
    return this.player(a).team !== this.player(b).team;
  }

  /** A player whose vital entity died in a match that goes on: its units are removed and its buildings left as ruins. */
  private eliminate(p: Player, emit: (e: GameEvent) => void) {
    this.ruined.add(p.id);
    for (const e of [...this.ents.values()]) {
      if (e.owner !== p.id) continue;
      if (e.spec.building) { e.training = e.training && []; e.order = null; continue; }
      this.remove(e);
      emit({ tick: this.clock.tick, type: "death", id: e.id, kind: e.kind, owner: e.owner, x: e.x, y: e.y });
    }
    emit({ tick: this.clock.tick, type: "eliminated", owner: p.id });
  }

  /** Entities in creation order, alternating between players by priority. */
  private interleaved(prio: Player[]): Entity[] {
    const lists = prio.map((p) => [...this.ents.values()].filter((e) => e.owner === p.id));
    const out: Entity[] = [];
    for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
    return out;
  }

  private enemyBuildingNear(owner: PlayerId, x: number, y: number): Entity | undefined {
    for (const b of this.ents.values()) {
      if (b.spec.building && this.hostile(b.owner, owner) && !this.ruined.has(b.owner) && dist(x, y, b.x, b.y) < this.ruleset.buildExclusion) return b;
    }
    return undefined;
  }

  private score(p: Player): number {
    const s = this.ruleset.score;
    let units = 0;
    let buildings = 0;
    for (const e of this.ents.values()) if (e.owner === p.id) e.spec.building ? buildings++ : units++;
    return units * s.unit + buildings * s.building + p.mineral * s.mineral + p.kills * s.kill + p.buildingKills * s.buildingKill;
  }

  private nearestDeposit(e: Entity): Deposit | undefined {
    let best: Deposit | undefined;
    const known = this.vision.deposits(e.owner)?.values() ?? [];
    for (const d of known) if (!best || this.movement.closer(e, d, best)) best = d;
    return best;
  }

  private nearestOwn(e: Entity, pred: (x: Entity) => boolean): Entity | undefined {
    let best: Entity | undefined;
    for (const x of this.ents.values()) {
      if (x.owner !== e.owner || !pred(x)) continue;
      if (!best || this.movement.closer(e, x, best)) best = x;
    }
    return best;
  }

  private status(): MatchStatus {
    return this._outcome ? "finished" : "running";
  }

  /** A player's view names everyone by id: display names (often the model) stay with observers. */
  private stats(viewer?: PlayerId): PlayerStats[] {
    return this.players.map((p) => {
      if (viewer && this.hostile(p.id, viewer)) return { id: p.id, name: viewer ? p.id : p.name, popCap: this.ruleset.popCap, team: p.team, alive: p.alive };
      const { units, queued } = this.production.population(p.id), scriptRuntime = this.scripts.runtime(p);
      return {
        id: p.id, name: viewer ? p.id : p.name, mineral: p.mineral, pop: units, popCap: this.ruleset.popCap,
        queuedPop: queued,
        ...(scriptRuntime ? { scriptRuntime } : {}),
        score: this.score(p), kills: p.kills + p.buildingKills, team: p.team, alive: p.alive,
        upgrades: { ...p.upgrades }, ...(p.alive && p.research ? { research: {
          upgrade: p.research.upgrade, level: p.research.level, completesAtMs: this.clock.ms(p.research.completesAtTick),
        } } : {}),
      };
    });
  }

  /** `viewer` null = spectator (sees everything). Intent is private; heading is public. */
  private entityView(e: Entity, viewer: PlayerId | null = null): EntityView {
    const v: EntityView = { id: e.id, kind: e.kind, owner: e.owner, x: e.x, y: e.y, hp: e.hp, maxHp: e.spec.hp };
    v.vital = !!e.spec.vital;
    if (this.ruined.has(e.owner)) v.ruin = true;
    if (e.spec.alliedPassage) v.open = this.board.occupant(e.x, e.y) !== null;
    if (e.construction) v.construction = { kind: e.construction.kind, x: e.construction.x, y: e.construction.y,
      completesAtMs: this.clock.ms(e.construction.completesAtTick) };
    v.stats = {
      atk: e.spec.atk ?? 0, def: e.spec.def, range: e.spec.range ?? 0,
      attackMs: e.spec.attackMs ? this.clock.ms(this.clock.ticks(e.spec.attackMs)) : 0,
      moveMs: e.spec.moveMs ? this.clock.ms(this.clock.ticks(e.spec.moveMs)) : 0,
    };
    if (e.lastStep && this.clock.tick - e.lastStep.tick <= this.clock.ticks(1000)) v.heading = arrow(e.lastStep.dx, e.lastStep.dy);
    const own = viewer === null || viewer === e.owner;
    if (own && e.training?.length) v.training = e.training.map((job) => ({ kind: job.kind,
      ...(job.completesAtTick !== undefined ? { completesAtMs: this.clock.ms(job.completesAtTick) } : {}),
    }));
    if (own && e.doing) v.doing = e.doing;
    if (own && e.actionResult) v.actionResult = { ...e.actionResult };
    if (e.spec.gathers && e.doing.startsWith("gather ")) {
      const deposit = this.deps.get(e.doing.slice(7));
      if (deposit && dist(e.x, e.y, deposit.x, deposit.y) <= 1) v.gathering = { x: deposit.x, y: deposit.y };
    }
    const o = own ? e.order : null;
    if (o) {
      if (e.orderSuspended) v.orderSuspended = true;
      const progress = this.orderProgress.view(e);
      if (progress) v.orderProgress = progress;
      v.order =
        o.type === "move" ? `move ${o.x},${o.y}` :
        o.type === "attack" ? `attack ${o.target}` :
        o.type === "gather" ? `gather${o.deposit ? " " + o.deposit : ""}` :
        `build ${o.kind} ${o.x},${o.y}`;
    }
    if (own && e.carrying) v.carrying = e.carrying;
    return v;
  }

  private depositViews(): DepositView[] {
    return [...this.deps.values()].map((d) => ({ ...d }));
  }
}

function visibleTo(e: GameEvent, player: PlayerId): boolean {
  return (e.type !== "script_error" && e.type !== "log" && e.type !== "order_end") || e.owner === player;
}

const ARROWS: Record<string, string> = { "0,-1": "↑", "1,-1": "↗", "1,0": "→", "1,1": "↘", "0,1": "↓", "-1,1": "↙", "-1,0": "←", "-1,-1": "↖" };
function arrow(dx: number, dy: number): string {
  return ARROWS[`${dx},${dy}`] ?? "·";
}

function describeIntent(it: Intent): Doing {
  switch (it.t) {
    case "goto": return `→ ${it.x},${it.y}`;
    case "dir": return `step ${arrow(it.dx, it.dy)}`;
    case "attack": return `attack ${it.id}`;
    case "shoot": return `shoot ${+it.x.toFixed(1)},${+it.y.toFixed(1)}`;
    case "gather": return `gather ${it.id}`;
    case "unload": return "unload";
    case "build": return "build";
    case "hold": return "hold";
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}
