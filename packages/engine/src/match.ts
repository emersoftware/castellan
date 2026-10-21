import type {
  DepositView, EntityView, GameEvent, KindSpec, MatchStatus, Order, OrderResult, Outcome, PlayerId, PlayerStats,
  Doing, OrderEndReason, PlayerView, RecordedKind, Ruleset, SpectatorView, UnderAttack, ActionAvailability, UnitOrder,
} from "@castellan/shared";
import { barrierAxes, HOLD_SCRIPT, matchLengthMs, NEUTRAL_OWNER, withMineralNames } from "@castellan/shared";
import { createScriptHost, testScript, type ScriptAction, type ScriptActionResult, type ScriptHost, type ScriptHostFactory, type ScriptWorld, type UnitRun } from "@castellan/sandbox";
import { DIRS, dist, inBounds, seatToMap, type Grid } from "./grid";
import { Combat, inAttackRange } from "./combat";
import { SimulationClock } from "./clock";
import { OrderTracker } from "./order-progress";
import { Movement } from "./movement";
import { PlayerVision } from "./vision";
import type { Entity, Intent, Deposit } from "./entities";
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

/** An order submitted by a player for the next tick. */
export interface PlayerOrder {
  player: PlayerId;
  order: Order;
}

interface Player {
  id: PlayerId;
  /** Seat 0..3: which rotation of the map is home. Tie-breaks follow it so mirrored play stays mirrored. */
  side: number;
  team: number;
  name: string;
  mineral: number;
  kills: number;
  buildingKills: number;
  alive: boolean;
  host: ScriptHost;
  /** Current source per scriptable kind, and whether the player wrote it. */
  scripts: Map<string, { code: string; custom: boolean; errors: string[] }>;
  logsThisTick: number;
  operationalFailureReported?: true;
  scriptRuntime?: PlayerStats["scriptRuntime"];
  upgrades: Record<string, number>;
  research: { upgrade: string; level: number; completesAtTick: number } | null;
}

/** Events kept for `view(player, since)`. */
const EVENT_WINDOW_TICKS = 600;
/** Occupancy marker for rock-wall terrain. */
const ROCK = "#rock";

/**
 * A match: the whole game state and the rules that advance it one tick at a
 * time. Deterministic: the same config and orders always give the same states.
 */
export class Match {
  readonly ruleset: Ruleset;
  readonly tickRate: number;
  readonly seed: number;
  readonly maxTicks: number;
  private clock: SimulationClock;
  private _outcome: Outcome | null = null;
  private players: Player[];
  private ents = new Map<string, Entity>();
  private orderProgress: OrderTracker;
  private deps = new Map<string, Deposit>();
  private occ: (string | null)[];
  /** Buildings that can share a tile with one allied unit. */
  private doors = new Map<number, string>();
  /** Bumped whenever a static tile changes, invalidating cached paths. */
  private staticVersion = 0;
  /** Active timed construction reserves its destination so traffic can route around it. */
  private buildSites = new Map<number, string>();
  /** Eliminated players: their remaining buildings are inert ruins. */
  private ruined = new Set<PlayerId>();
  private vision!: PlayerVision;
  private eventAudience = new WeakMap<GameEvent, Set<PlayerId>>();
  private nextId = 1;
  private combat: Combat;
  private log: GameEvent[] = [];
  private conversation: Extract<GameEvent, { type: "chat" }>[] = [];
  private grid: Grid;
  private movement: Movement;
  private scriptHostFactory: ScriptHostFactory;

  constructor(cfg: MatchConfig) {
    if (cfg.players.some(p => p.id === NEUTRAL_OWNER)) throw new Error(`Player id ${NEUTRAL_OWNER} is reserved for scenario walls`);
    this.ruleset = withMineralNames(cfg.ruleset);
    this.tickRate = cfg.tickRate;
    this.clock = new SimulationClock(cfg.tickRate);
    this.orderProgress = new OrderTracker(this.clock);
    // Balance continuations replace the ruleset; collaborators always read the current candidate.
    this.combat = new Combat(() => this.ruleset, this.clock, this.ents,
      (a, b) => this.hostile(a, b), (player, x, y) => this.vision.canSee(player, x, y), {
        result: (entity, status, effect, reason) => this.scriptResult(entity, status, effect, reason),
        attacked: (entity, attacker, damage) => this.attackedEvent(entity, attacker, damage),
      });
    this.seed = cfg.seed;
    this.scriptHostFactory = cfg.scriptHostFactory ?? createScriptHost;
    this.maxTicks = this.clock.ticks(matchLengthMs(cfg.ruleset));
    const { width, height } = cfg.ruleset.map;
    this.occ = new Array(width * height).fill(null);
    this.grid = {
      width,
      height,
      isStatic: (x, y) => {
        const id = this.occ[y * width + x];
        return this.doors.has(y * width + x) || this.buildSites.has(y * width + x) || (id !== null && (id === ROCK || this.deps.has(id) || this.ents.get(id)!.spec.building));
      },
    };
    this.movement = new Movement(() => this.ruleset, this.clock, {
      grid: this.grid, occupancy: this.occ, entities: this.ents, doors: this.doors, version: () => this.staticVersion,
    }, owner => this.player(owner).side, (a, b) => this.hostile(a, b));
    const allocated: ScriptHost[] = [];
    const allocate = (seed: number) => {
      const host = this.scriptHostFactory(cfg.ruleset.script, seed);
      allocated.push(host);
      return host;
    };
    try {
      this.players = cfg.players.map((p, i) => ({
        id: p.id, side: p.side ?? i % 2, team: p.team ?? i, name: p.name, mineral: this.ruleset.startMineral, kills: 0, buildingKills: 0, alive: true,
        host: allocate((cfg.seed * 31 + i * 7919) >>> 0),
        scripts: new Map(), logsThisTick: 0, upgrades: {}, research: null,
      }));
      this.vision = new PlayerVision(() => this.ruleset, this.clock, {
        players: this.players, entities: this.ents, deposits: this.deps, ruined: this.ruined,
      }, (a, b) => this.hostile(a, b));
      for (const p of this.players) {
        for (const [kind, spec] of Object.entries(this.ruleset.kinds)) {
          if (!spec.scriptable) continue;
          const code = this.defaultScript(kind);
          p.host.setScript(kind, code);
          p.scripts.set(kind, { code, custom: false, errors: [] });
        }
      }
      this.setup();
      this.vision.refresh();
    } catch (error) {
      for (const host of allocated) host.dispose();
      throw error;
    }
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
      this.eventAudience.set(e, new Set(this.players.filter((p) => this.vision.canSeeEvent(p.id, e)).map((p) => p.id)));
      this.vision.recordCombat(e);
      events.push(e);
    };
    const prio = this.priority();
    for (const p of this.players) p.logsThisTick = 0;
    // Finish research before this tick's orders/spawns; existing cooldowns are not reset.
    for (const p of this.players) {
      if (!p.alive || !p.research || T < p.research.completesAtTick) continue;
      const { upgrade, level } = p.research;
      p.upgrades[upgrade] = level;
      p.research = null;
      const kind = this.ruleset.upgrades[upgrade].kind;
      for (const e of this.ents.values()) if (e.owner === p.id && e.kind === kind) e.spec = this.effectiveSpec(p, kind);
      emit({ tick: T, type: "upgrade_completed", owner: p.id, upgrade, level });
    }

    this.finishTraining(emit);

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
      if (this.ruleset.reactiveOrders) this.prepareScriptEvents(mine, p);
      const runs = p.host.run(this.scriptWorld(p, mine), mine.map((e) => e.id));
      for (const e of mine) {
        const r = runs[e.id];
        // Delivered once, including failed invocations. Events generated by
        // this decision (e.g. cancellation) remain queued for the next tick.
        if (this.ruleset.reactiveOrders) e.scriptEvents = [];
        if (r.error) this.scriptError(p, e, r.error, emit, r.operationalFailure);
        if (r.log && p.logsThisTick++ < 10) emit({ tick: T, type: "log", owner: p.id, unit: e.id, message: r.log });
        const orderIntent = this.ruleset.reactiveOrders ? this.reactiveOrderIntent(e, r, emit) : null;
        if (orderIntent) {
          intents.set(e.id, orderIntent);
          e.actionResult = { tick: T, source: "order", intent: describeIntent(orderIntent), status: orderIntent.t === "hold" ? "held" : orderIntent.t === "build" ? "working" : "blocked" };
          continue;
        }
        const intent = this.scriptIntent(e, r.action);
        const impossible = intent.t === "hold" && r.action.a !== "hold";
        e.lastActionResult = { tick: T, action: r.action,
          status: r.error || impossible ? "invalid" : intent.t === "hold" ? "held" : "blocked",
          ...(r.error ? { reason: r.error } : impossible ? { reason: "action has no valid target or cannot be performed" } : {}) };
        e.actionResult = { tick: T, source: "script", intent: describeIntent(intent), status: e.lastActionResult.status, ...(e.lastActionResult.reason ? { reason: e.lastActionResult.reason } : {}) };
        intents.set(e.id, intent);
      }
    }

    for (const e of this.ents.values()) {
      const it = intents.get(e.id);
      e.doing = it ? describeIntent(it) : e.spec.moveMs || e.spec.atk ? "hold" : "";
    }

    // 3. Resolve movement in player priority, allowing friendly columns to depart front to back.
    this.movement.advance(this.interleaved(prio), intents, {
      result: (entity, status, effect, reason) => this.scriptResult(entity, status, effect, reason),
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
        this.scriptResult(e, e.carrying > before ? "acted" : T < e.nextGather ? "cooldown" : "blocked", e.carrying > before ? "gather" : undefined);
      } else if (it?.t === "unload") {
        const before = e.carrying;
        this.unload(e, emit);
        this.scriptResult(e, before > 0 ? "acted" : "invalid", before > 0 ? "unload" : undefined);
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
        if (owner.alive) (owner.alive = false), fallen.push(owner);
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
    this.log.push(...events);
    this.conversation.push(...events.filter((e): e is Extract<GameEvent, { type: "chat" }> => e.type === "chat"));
    this.vision.trimCombat();
    const cutoff = this.clock.tick - EVENT_WINDOW_TICKS;
    if (this.log.length > 0 && this.log[0].tick < cutoff) this.log = this.log.filter((e) => e.tick >= cutoff);
    return { results: orderResults, events };
  }

  /** Events `player` may see with tick ≥ `since` (attacks excluded: too many). */
  events(player: PlayerId, since: number): GameEvent[] {
    return this.log.filter((e) => e.tick >= since && e.type !== "attack" && e.type !== "projectile_end" && visibleTo(e, player)
      && (e.type === "match_end" || this.eventAudience.get(e)?.has(player))
      && (e.type !== "chat" || (e.channel === "private"
        ? e.owner === player || e.to === player
        : e.channel !== "team" || !this.hostile(e.owner, player))))
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
    const scripts: PlayerView["scripts"] = {};
    for (const [kind, s] of p.scripts) scripts[kind] = { custom: s.custom, errors: [...s.errors] };
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
      scripts,
      availableActions: this.availableActions(p),
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
    const message = (e: Extract<GameEvent, { type: "chat" }>) => ({ tick: e.tick, from: e.owner,
      name: this.player(e.owner).name, text: e.text, ...(e.channel ? { channel: e.channel } : {}), ...(e.to ? { to: e.to } : {}) });
    return {
      chat: this.conversation.filter((e) => e.channel === "private" ? options.includePrivateChat : e.channel !== "team" || options.includePrivateChat || options.includeTeamChat).map(message),
      playerChats: Object.fromEntries(this.players.map((p) => [p.id, this.conversation.filter((e) => e.channel === "private"
        ? e.owner === p.id || e.to === p.id : e.channel !== "team" || !this.hostile(e.owner, p.id)).map(message)])),
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
          deposits: [...this.depositViews().filter(d => this.vision.canSee(p.id, d.x, d.y)), ...deposits], players: this.stats(p.id).map((s) => ({ ...s, name: this.player(s.id).name })), events: [...this.events(p.id, from).filter((e) => e.type !== "log" && e.type !== "script_error"
            && (e.type !== "chat" || (e.channel === "private" ? options.includePrivateChat : e.channel !== "team" || options.includePrivateChat || options.includeTeamChat))),
            ...this.log.filter((e) => e.tick >= from && (e.type === "attack" || e.type === "projectile_end") && this.eventAudience.get(e)?.has(p.id))] }];
      })) }),
      deposits: this.depositViews(),
      events: this.log.filter((e) => e.tick >= from && e.type !== "log" && e.type !== "script_error"
        && (e.type !== "chat" || (e.channel === "private" ? options.includePrivateChat
          : e.channel !== "team" || options.includePrivateChat || options.includeTeamChat))),
      outcome: this._outcome ?? undefined,
    };
  }

  isAlive(player: PlayerId): boolean {
    return this.player(player).alive;
  }

  /** Source of the script `player` runs for `kind`. */
  scriptSource(player: PlayerId, kind: string): { code: string; custom: boolean } | null {
    const s = this.player(player).scripts.get(kind);
    return s ? { code: s.code, custom: s.custom } : null;
  }

  /** Compile and run a proposed script against own current units in a separate VM.
   * Returns requested actions, errors and gas; it does not advance the match or
   * modify the player's installed script, memory, PRNG or event cursor.
   */
  testScript(player: PlayerId, kind: string, code: string) {
    const p = this.player(player);
    if (!p.scripts.has(kind)) return { ok: false as const, error: `${kind} is not scriptable` };
    const units = [...this.ents.values()].filter(e => e.owner === player && e.kind === kind)
      .map(e => ({ ...e, scriptEvents: [...e.scriptEvents ?? []] }));
    if (this.ruleset.reactiveOrders) this.prepareScriptEvents(units, p);
    return testScript(code, kind, [this.scriptWorld(p, units)], this.ruleset.script, (this.seed * 31 + this.players.indexOf(p) * 7919) >>> 0, this.scriptHostFactory);
  }

  /** `player` leaves (e.g. disconnected): its side loses if it has nobody else left, else it is out. */
  forfeit(player: PlayerId): void {
    if (this._outcome) return;
    const p = this.player(player);
    p.alive = false;
    const teams = this.aliveTeams();
    if (teams.size <= 1) this.finish(this.teamOf([...teams][0]), "forfeit", this.clock.tick, () => {});
    else this.eliminate(p, (e) => {
      this.eventAudience.set(e, new Set(this.players.filter((q) => this.vision.canSeeEvent(q.id, e)).map((q) => q.id)));
      this.log.push(e);
    });
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
    for (const p of this.players) p.host.dispose();
  }

  // ───────────────────────── setup ─────────────────────────

  private setup() {
    const { map } = this.ruleset;
    const mirror = (x: number, y: number, side: number) => seatToMap(x, y, side, map.width, map.height);
    for (const w of map.walls ?? []) this.occ[w.y * map.width + w.x] = ROCK;
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
      const wall = this.ruleset.kinds.wall;
      if (!wall?.building || wall.vital || wall.alliedPassage) throw new Error("Neutral walls require a non-vital wall building without allied passage");
      this.ruined.add(NEUTRAL_OWNER);
      for (const w of map.neutralWalls) {
        if (!Number.isInteger(w.x) || !Number.isInteger(w.y) || !inBounds(this.grid, w.x, w.y)
          || this.occ[w.y * map.width + w.x] !== null || this.doors.has(w.y * map.width + w.x)) {
          throw new Error(`Invalid or occupied neutral wall tile ${w.x},${w.y}`);
        }
        this.spawn("wall", NEUTRAL_OWNER, w.x, w.y);
      }
    }
  }

  private addDeposit(x: number, y: number, amount: number) {
    const id = `d${this.deps.size + 1}`;
    this.deps.set(id, { id, x, y, amount });
    this.occ[y * this.grid.width + x] = id;
  }

  private spawn(kind: RecordedKind, owner: PlayerId, x: number, y: number): Entity {
    const spec = owner === NEUTRAL_OWNER ? this.ruleset.kinds[kind] : this.effectiveSpec(this.player(owner), kind);
    const e: Entity = {
      id: `e${this.nextId++}`, kind, spec, owner, x, y, hp: spec.hp,
      order: spec.gathers && !spec.scriptable ? { type: "gather" } : null,
      nextMove: 0, nextAttack: 0, nextGather: 0, carrying: 0, path: null, pathKey: "", blocked: 0, doing: "", lastStep: null,
    };
    this.ents.set(e.id, e);
    if (spec.alliedPassage) this.doors.set(y * this.grid.width + x, e.id);
    else this.occ[y * this.grid.width + x] = e.id;
    if (spec.building) this.staticVersion++;
    return e;
  }

  private clearConstruction(e: Entity) {
    if (!e.construction) return;
    const tile = e.construction.y * this.grid.width + e.construction.x;
    if (this.buildSites.get(tile) === e.id) { this.buildSites.delete(tile); this.staticVersion++; }
    e.construction = undefined;
  }

  private remove(e: Entity) {
    this.clearConstruction(e);
    this.ents.delete(e.id);
    if (e.spec.alliedPassage) this.doors.delete(e.y * this.grid.width + e.x);
    else this.occ[e.y * this.grid.width + e.x] = null;
    if (e.spec.building) this.staticVersion++;
  }

  // ───────────────────────── orders ─────────────────────────

  private apply(po: PlayerOrder, emit: (e: GameEvent) => void): OrderResult {
    const bad = validateOrder(po.order);
    if (bad) return { ok: false, reason: bad };
    const p = this.player(po.player);
    const o = po.order;
    if (!p.alive) return { ok: false, reason: "you are out of the match" };
    if (o.type === "script") return this.setScript(p, o.kind, o.code);
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
    if (o.type === "train") return this.train(p, o.building, o.kind, emit);
    if (o.type === "upgrade") return this.research(p, o.upgrade, emit);

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
        if (!inBounds(this.grid, o.x, o.y)) return { ok: false, reason: `(${o.x},${o.y}) is outside the ${width}x${height} map` };
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
        if (this.locked(p, o.kind)) return { ok: false, reason: `${o.kind} requires ${spec.requires} research` };
        if (!inBounds(this.grid, o.x, o.y)) return { ok: false, reason: `(${o.x},${o.y}) is outside the map` };
        if (!this.vision.canSee(p.id, o.x, o.y)) return { ok: false, reason: "build site must be visible" };
        if (this.grid.isStatic(o.x, o.y) && this.buildSites.get(o.y * this.grid.width + o.x) !== e.id) return { ok: false, reason: `(${o.x},${o.y}) is occupied` };
        if (this.makesDoorCorner(p.id, kind, o.x, o.y)) return { ok: false, reason: "doors must stay on one wall axis; no corners or junctions" };
        if (p.mineral < spec.cost) return { ok: false, reason: `needs ${spec.cost} mineral, you have ${p.mineral}` };
        const near = this.enemyBuildingNear(p.id, o.x, o.y);
        if (near) return { ok: false, reason: `too close to enemy ${near.kind} ${near.id}: keep ${this.ruleset.buildExclusion}+ tiles away` };
        if (e.construction && (e.construction.kind !== o.kind || e.construction.x !== o.x || e.construction.y !== o.y)) this.clearConstruction(e);
        this.assignOrder(e, { type: "build", kind, x: o.x, y: o.y }, emit);
        return { ok: true };
      }
    }
  }

  private setScript(p: Player, kind: string, code: string | null): OrderResult {
    const cur = p.scripts.get(kind);
    if (!cur) return { ok: false, reason: `${kind} is not scriptable` };
    const source = code ?? this.defaultScript(kind);
    const r = p.host.setScript(kind, source);
    if (!r.ok) {
      p.host.setScript(kind, cur.code);
      return { ok: false, reason: r.error };
    }
    p.scripts.set(kind, { code: source, custom: code !== null, errors: [] });
    return { ok: true };
  }

  /** The script a kind runs while its player has none of its own. */
  private defaultScript(kind: string): string {
    return this.ruleset.defaultScripts[kind] ?? HOLD_SCRIPT;
  }

  /** A kind that needs a research this player has not completed. */
  private locked(p: Player, kind: string): boolean {
    const req = this.ruleset.kinds[kind]?.requires;
    return !!req && !p.upgrades[req];
  }

  private effectiveSpec(p: Player, kind: string): KindSpec {
    const base = this.ruleset.kinds[kind];
    const spec = { ...base };
    for (const [id, level] of Object.entries(p.upgrades)) {
      const upgrade = this.ruleset.upgrades[id];
      if (upgrade.kind !== kind || upgrade.stat === "unlock") continue;
      const bought = upgrade.levels[level - 1];
      spec[upgrade.stat] = bought.value;
      if (bought.vision !== undefined) spec.vision = bought.vision;
    }
    return spec;
  }

  private trainBlockers(p: Player, b: Entity, kind: string): string[] {
    const spec = this.ruleset.kinds[kind], reasons: string[] = [];
    if (this.locked(p, kind)) reasons.push(`${kind} requires ${spec.requires} research`);
    if (p.mineral < spec.cost) reasons.push(`needs ${spec.cost} mineral, you have ${p.mineral}`);
    if (this.pop(p.id) + this.queuedPop(p.id) >= this.ruleset.popCap) reasons.push(`population cap ${this.ruleset.popCap} reached`);
    if (spec.trainMs && (b.training?.length ?? 0) >= this.ruleset.trainingQueueLimit) reasons.push("training queue full");
    if (!spec.trainMs && !this.movement.freeNeighbor(b.x, b.y, p.id)) reasons.push(`no free tile around ${b.id}`);
    return reasons;
  }

  private researchBlockers(p: Player, id: string): string[] {
    const upgrade = this.ruleset.upgrades[id], next = upgrade.levels[p.upgrades[id] ?? 0], reasons: string[] = [];
    if (p.research) reasons.push(`already researching ${p.research.upgrade}`);
    if (!next) reasons.push(`${id} is already at maximum level`);
    if (upgrade.stat !== "unlock" && this.locked(p, upgrade.kind)) reasons.push(`${upgrade.kind} requires ${this.ruleset.kinds[upgrade.kind].requires} research`);
    if (next && p.mineral < next.cost) reasons.push(`needs ${next.cost} mineral, you have ${p.mineral}`);
    return reasons;
  }

  private availableActions(p: Player): ActionAvailability {
    const mine = [...this.ents.values()].filter(e => e.owner === p.id);
    const inactive = !p.alive ? ["player eliminated"] : this._outcome ? ["match over"] : [];
    return {
      train: mine.flatMap(b => (b.spec.trains ?? []).map(kind => ({ building: b.id, kind, cost: this.ruleset.kinds[kind].cost,
        queue: b.training?.length ?? 0, queueLimit: this.ruleset.trainingQueueLimit,
        blockedBy: [...inactive, ...this.trainBlockers(p, b, kind)], exitBlocked: !this.movement.freeNeighbor(b.x, b.y, p.id) }))),
      build: [...new Set(Object.values(this.ruleset.kinds).flatMap(k => k.builds ?? []))].map(kind => ({ kind,
        cost: this.ruleset.kinds[kind].cost, siteCheckRequired: true,
        blockedBy: [...inactive, ...(!mine.some(e => e.spec.builds?.includes(kind)) ? ["no builder"] : []),
          ...(this.locked(p, kind) ? [`${kind} requires ${this.ruleset.kinds[kind].requires} research`] : []),
          ...(p.mineral < this.ruleset.kinds[kind].cost ? [`needs ${this.ruleset.kinds[kind].cost} mineral, you have ${p.mineral}`] : [])] })),
      research: Object.entries(this.ruleset.upgrades).map(([upgrade, spec]) => ({ upgrade,
        level: (p.upgrades[upgrade] ?? 0) + 1, cost: spec.levels[p.upgrades[upgrade] ?? 0]?.cost ?? null,
        blockedBy: [...inactive, ...this.researchBlockers(p, upgrade)] })),
    };
  }

  private research(p: Player, id: string, emit: (e: GameEvent) => void): OrderResult {
    const upgrade = this.ruleset.upgrades[id];
    if (!upgrade || !Object.hasOwn(this.ruleset.upgrades, id)) return { ok: false, reason: `unknown upgrade ${id}` };
    const blockedBy = this.researchBlockers(p, id);
    if (blockedBy.length) return { ok: false, reason: blockedBy[0] };
    const level = (p.upgrades[id] ?? 0) + 1;
    const next = upgrade.levels[level - 1];
    p.mineral -= next.cost;
    p.research = { upgrade: id, level, completesAtTick: this.clock.tick + this.clock.ticks(next.researchMs) };
    emit({ tick: this.clock.tick, type: "research_started", owner: p.id, upgrade: id, level,
      completesAtMs: this.clock.ms(p.research.completesAtTick), mineral: { spent: next.cost, remaining: p.mineral } });
    return { ok: true };
  }

  private train(p: Player, buildingId: string, ordered: string, emit: (e: GameEvent) => void): OrderResult {
    const b = this.ents.get(buildingId);
    const spec = this.ruleset.kinds[ordered];
    if (!b || b.owner !== p.id) return { ok: false, reason: `no building ${buildingId} of yours` };
    const kind = b.spec.trains?.find((k) => k === ordered);
    if (!kind || !spec) return { ok: false, reason: `${b.kind} cannot train ${ordered}` };
    const blockedBy = this.trainBlockers(p, b, kind);
    if (blockedBy.length) return { ok: false, reason: blockedBy[0] };
    if (spec.trainMs) {
      const queue = b.training ??= [];
      if (queue.length >= this.ruleset.trainingQueueLimit) return { ok: false, reason: "training queue full" };
      p.mineral -= spec.cost;
      queue.push({ kind, ...(queue.length === 0 ? { completesAtTick: this.clock.tick + this.clock.ticks(spec.trainMs) } : {}) });
      emit({ tick: this.clock.tick, type: "training_queued", owner: p.id, building: b.id, kind, position: queue.length });
      return { ok: true };
    }
    const tile = this.movement.freeNeighbor(b.x, b.y, p.id);
    if (!tile) return { ok: false, reason: `no free tile around ${buildingId}` };
    p.mineral -= spec.cost;
    const u = this.spawn(kind, p.id, tile[0], tile[1]);
    emit({ tick: this.clock.tick, type: "spawn", id: u.id, kind, owner: p.id, x: u.x, y: u.y });
    return { ok: true, id: u.id };
  }

  private queuedPop(owner: PlayerId): number {
    let count = 0;
    for (const e of this.ents.values()) if (e.owner === owner) count += e.training?.length ?? 0;
    return count;
  }

  private finishTraining(emit: (e: GameEvent) => void) {
    for (const b of this.interleaved(this.priority())) {
      if (this.ruined.has(b.owner)) continue;
      const job = b.training?.[0];
      if (!job || job.completesAtTick === undefined || this.clock.tick < job.completesAtTick) continue;
      const tile = this.movement.freeNeighbor(b.x, b.y, b.owner);
      if (!tile) continue; // Ready, but blocked: preserve the paid unit until an exit opens.
      const unit = this.spawn(job.kind, b.owner, tile[0], tile[1]);
      b.training!.shift();
      const next = b.training![0];
      if (next) next.completesAtTick = this.clock.tick + this.clock.ticks(this.ruleset.kinds[next.kind].trainMs!);
      emit({ tick: this.clock.tick, type: "spawn", id: unit.id, kind: unit.kind, owner: b.owner, x: unit.x, y: unit.y });
    }
  }

  private endOrder(e: Entity, reason: OrderEndReason, emit: (e: GameEvent) => void) {
    this.orderProgress.clear(e);
    delete e.moveTarget;
    if (this.ruleset.reactiveOrders && e.order) {
      (e.scriptEvents ??= []).push({ type: "order_ended", tick: this.clock.tick, order: { ...e.order }, reason });
      e.orderSuspended = false;
    }
    e.order = null;
    this.clearConstruction(e);
    e.path = null;
    emit({ tick: this.clock.tick, type: "order_end", id: e.id, owner: e.owner, reason });
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

  private prepareScriptEvents(units: readonly Entity[], p: Player) {
    if (!units.length) return;
    // Visibility is shared throughout this player's preparation; each unit
    // still gets its own range filter and distance/reading-order sort.
    const enemies = [...this.ents.values()].filter(other => this.hostile(other.owner, p.id)
      && this.vision.canSee(p.id, other.x, other.y));
    for (const e of units) {
      const seen = enemies.filter(other => this.ruleset.scriptSight === "player" || dist(e.x, e.y, other.x, other.y) <= e.spec.vision)
        .sort((a, b) => dist(e.x, e.y, a.x, a.y) - dist(e.x, e.y, b.x, b.y) || this.movement.readingKey(a.x, a.y, p.side) - this.movement.readingKey(b.x, b.y, p.side));
      const before = new Set(e.seenEnemies ?? []);
      for (const enemy of seen) if (!before.has(enemy.id)) (e.scriptEvents ??= []).push({ type: "enemy_seen", tick: this.clock.tick, enemy: enemy.id });
      e.seenEnemies = seen.map(enemy => enemy.id);
    }
  }

  private attackedEvent(e: Entity, attacker: string, damage: number) {
    if (!this.ruleset.reactiveOrders || !e.spec.scriptable) return;
    const events = e.scriptEvents ??= [];
    const same = events.find(event => event.type === "attacked" && event.tick === this.clock.tick && event.attacker === attacker);
    if (same?.type === "attacked") same.damage += damage;
    else events.push({ type: "attacked", tick: this.clock.tick, damage, attacker });
  }

  // ───────────────────────── intents ─────────────────────────

  private orderIntent(e: Entity, emit: (e: GameEvent) => void): Intent | null {
    const o = e.order!;
    const range = e.spec.range ?? 1;
    switch (o.type) {
      case "move": {
        const goal = this.ruleset.coordinatedMovement ? e.moveTarget ?? o : o;
        if (e.x === goal.x && e.y === goal.y) return this.endOrder(e, "arrived", emit), null;
        const r = this.movement.gridFor(e.owner).isStatic(goal.x, goal.y) ? 1 : 0;
        if (r === 1 && dist(e.x, e.y, goal.x, goal.y) <= 1) return this.endOrder(e, "arrived", emit), null;
        return { t: "goto", x: goal.x, y: goal.y, range: r };
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
      case "gather":
        return this.gatherIntent(e, o, emit);
    }
  }

  private gatherIntent(e: Entity, o: { type: "gather"; deposit?: string }, emit: (e: GameEvent) => void): Intent | null {
    let dep = o.deposit ? this.deps.get(o.deposit) : undefined;
    if (!dep) {
      dep = this.nearestDeposit(e);
      o.deposit = dep?.id;
    }
    if (e.carrying >= this.ruleset.gather.carry || (e.carrying > 0 && !dep)) {
      const drop = this.nearestOwn(e, (x) => !!x.spec.dropoff);
      if (!drop) return this.endOrder(e, "no dropoff", emit), null;
      return dist(e.x, e.y, drop.x, drop.y) <= 1 ? { t: "unload", id: drop.id } : { t: "goto", x: drop.x, y: drop.y, range: 1 };
    }
    if (!dep) return this.endOrder(e, "no deposits left", emit), null;
    return dist(e.x, e.y, dep.x, dep.y) <= 1 ? { t: "gather", id: dep.id } : { t: "goto", x: dep.x, y: dep.y, range: 1 };
  }

  /** Script actions are untrusted: anything invalid becomes hold. */
  private scriptIntent(e: Entity, a: ScriptAction): Intent {
    const { width, height } = this.ruleset.map;
    switch (a.a) {
      case "gather": {
        if (!e.spec.gathers) return { t: "hold" };
        if (a.id !== undefined && !this.vision.deposits(e.owner)?.has(a.id)) return { t: "hold" };
        return this.gatherIntent(e, { type: "gather", deposit: a.id }, () => {}) ?? { t: "hold" };
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

  private scriptError(p: Player, e: Entity, message: string, emit: (e: GameEvent) => void, operationalFailure?: true) {
    const s = p.scripts.get(e.kind);
    if (!s) return;
    if (s.errors.at(-1) !== message || (operationalFailure && !p.operationalFailureReported)) {
      s.errors.push(message);
      if (s.errors.length > 3) s.errors.shift();
      if (!operationalFailure || !p.operationalFailureReported) {
        emit({ tick: this.clock.tick, type: "script_error", owner: p.id, kind: e.kind, unit: e.id, message,
          ...(operationalFailure ? { operationalFailure } : {}) });
        if (operationalFailure) {
          p.operationalFailureReported = true;
          p.scriptRuntime = { status: "stopped", tick: this.clock.tick, message };
        }
      }
    }
  }

  private scriptResult(e: Entity, status: ScriptActionResult["status"], effect?: ScriptActionResult["effect"], reason?: string) {
    if (e.actionResult?.tick === this.clock.tick) e.actionResult = { ...e.actionResult, status, ...(effect ? { effect } : {}), ...(reason ? { reason } : {}) };
    // Persistent/manual orders do not replace the previous script's feedback.
    if (e.lastActionResult?.tick !== this.clock.tick) return;
    e.lastActionResult = { tick: this.clock.tick, action: e.lastActionResult.action, status,
      ...(effect ? { effect } : {}), ...(reason ? { reason } : {}) };
  }

  private scriptWorld(p: Player, units: Entity[]): ScriptWorld {
    const baseOf = (owner: PlayerId) => {
      const own = [...this.ents.values()].filter((e) => e.owner === owner && (!this.hostile(owner, p.id) || this.vision.canSee(p.id, e.x, e.y)));
      const b = own.find((e) => e.spec.building && e.spec.dropoff)
        ?? own.find((e) => e.spec.building && e.spec.vital) ?? own.find((e) => e.spec.vital);
      return b ? { x: b.x, y: b.y } : null;
    };
    const myBase = baseOf(p.id);
    // The enemy base is the nearest hostile player's (ties: player order).
    let enemyBase: { x: number; y: number } | null = null;
    for (const q of this.players) {
      if (!q.alive || !this.hostile(q.id, p.id)) continue;
      const b = baseOf(q.id);
      if (b && (!enemyBase || (myBase && dist(myBase.x, myBase.y, b.x, b.y) < dist(myBase.x, myBase.y, enemyBase.x, enemyBase.y)))) enemyBase = b;
    }
    const relation = (owner: PlayerId) => (owner === p.id ? 1 : this.hostile(owner, p.id) ? 0 : 2);
    const u: ScriptWorld["units"] = {};
    for (const e of units) {
      u[e.id] = {
        id: e.id, type: e.kind, x: e.x, y: e.y, hp: e.hp, maxHp: e.spec.hp, atk: e.spec.atk ?? 0,
        def: e.spec.def, range: e.spec.range ?? 0, minRange: e.spec.minRange ?? 0, vision: e.spec.vision,
        attackMs: e.spec.attackMs ? this.clock.ms(this.clock.ticks(e.spec.attackMs)) : 0,
        moveMs: e.spec.moveMs ? this.clock.ms(this.clock.ticks(e.spec.moveMs)) : 0,
        attackReadyInTicks: Math.max(0, e.nextAttack - this.clock.tick),
        moveReadyInTicks: Math.max(0, e.nextMove - this.clock.tick),
        aimReadyInTicks: e.spec.aimMs && e.lastStep ? Math.max(0, e.lastStep.tick + this.clock.ticks(e.spec.aimMs) - this.clock.tick) : 0,
        gatherReadyInTicks: Math.max(0, e.nextGather - this.clock.tick),
        lastActionResult: e.lastActionResult ?? null,
        moves: Object.fromEntries(Object.entries(DIRS).map(([dir, [dx, dy]]) => {
          const x = e.x + dx, y = e.y + dy;
          if (!e.spec.moveMs || !inBounds(this.grid, x, y)) return [dir, false];
          // A movement query must never expose occupancy behind fog, including
          // the two orthogonal tiles used to check a diagonal crossing.
          if (!this.vision.canSee(p.id, x, y) || (dx && dy && (!this.vision.canSee(p.id, e.x + dx, e.y) || !this.vision.canSee(p.id, e.x, e.y + dy)))) return [dir, null];
          return [dir, this.movement.canStep(e, x, y)];
        })),
        lastAttackedTick: e.lastAttacked?.tick ?? null,
        lastAttacker: e.lastAttacked && this.clock.tick - e.lastAttacked.tick <= this.clock.ticks(5000) ? e.lastAttacked.id : null,
        ...(this.ruleset.reactiveOrders ? {
          order: e.order ? { ...e.order } : null, orderSuspended: !!e.orderSuspended,
          events: (e.scriptEvents ?? []).map(event => {
            if (event.type !== "attacked") return event;
            const attacker = event.attacker ? this.ents.get(event.attacker) : undefined;
            return { ...event, attacker: attacker && this.hostile(attacker.owner, p.id) && this.vision.canSee(p.id, attacker.x, attacker.y) ? attacker.id : null };
          }),
        } : {}),
        ...(e.spec.gathers ? { carrying: e.carrying, carryCapacity: this.ruleset.gather.carry } : {}),
      };
    }
    return {
      ...(this.ruleset.reactiveOrders ? { reactiveOrders: true } : {}),
      tick: this.clock.tick,
      side: p.side,
      units: u,
      deposits: [...this.vision.deposits(p.id)?.values() ?? []].map(d => ({ ...d, tie: this.movement.readingKey(d.x, d.y, p.side) })),
      projectiles: this.combat.views(p.id),
      all: [...this.ents.values()].filter((e) => !this.hostile(e.owner, p.id) || this.vision.canSee(p.id, e.x, e.y)).map((e) => [
        e.id, e.kind, e.owner, relation(e.owner), e.x, e.y, e.hp, e.spec.hp, e.spec.building ? 1 : 0, this.movement.readingKey(e.x, e.y, p.side),
        { atk: e.spec.atk ?? 0, def: e.spec.def, range: e.spec.range ?? 0, minRange: e.spec.minRange ?? 0, vision: e.spec.vision,
          attackMs: e.spec.attackMs ? this.clock.ms(this.clock.ticks(e.spec.attackMs)) : 0, moveMs: e.spec.moveMs ? this.clock.ms(this.clock.ticks(e.spec.moveMs)) : 0,
          ruin: this.ruined.has(e.owner) },
      ]),
      myBase,
      enemyBase,
      sight: this.ruleset.scriptSight === "player" ? "player" : "unit",
    };
  }

  // ───────────────────────── movement ─────────────────────────

  // ───────────────────────── economy ─────────────────────────

  private gatherFrom(e: Entity, depId: string, emit: (e: GameEvent) => void) {
    const d = this.deps.get(depId);
    if (!d || this.clock.tick < e.nextGather || e.carrying >= this.ruleset.gather.carry) return;
    e.carrying++;
    d.amount--;
    e.nextGather = this.clock.tick + this.clock.ticks(this.ruleset.gather.ms);
    if (d.amount <= 0) {
      this.deps.delete(d.id);
      this.occ[d.y * this.grid.width + d.x] = null;
      this.staticVersion++;
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
  private makesDoorCorner(owner: PlayerId, kind: RecordedKind, x: number, y: number): boolean {
    if (kind !== "wall" && !this.ruleset.kinds[kind]?.alliedPassage) return false;
    const at = (tx: number, ty: number): RecordedKind | undefined => {
      if (tx === x && ty === y) return kind;
      if (!inBounds(this.grid, tx, ty)) return undefined;
      const tile = ty * this.grid.width + tx;
      const entity = this.ents.get(this.doors.get(tile) ?? this.occ[tile] ?? "");
      if (entity?.owner === owner) return entity.kind;
      const builder = this.ents.get(this.buildSites.get(tile) ?? "");
      return builder?.owner === owner ? builder.construction?.kind : undefined;
    };
    const has = (tx: number, ty: number) => {
      const k = at(tx, ty);
      return k === "wall" || !!(k && this.ruleset.kinds[k]?.alliedPassage);
    };
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
    const tile = o.y * this.grid.width + o.x;
    const reserved = this.buildSites.get(tile);
    if (reserved && reserved !== e.id) return this.endOrder(e, "site reserved by another builder", emit);
    const occupant = this.doors.get(tile) ?? this.occ[tile];
    if (occupant !== null) {
      this.clearConstruction(e);
      if (this.grid.isStatic(o.x, o.y)) this.endOrder(e, "tile blocked", emit);
      return; // a unit is standing there; wait
    }
    if (this.makesDoorCorner(p.id, o.kind, o.x, o.y)) return this.endOrder(e, "doors must stay on one wall axis; no corners or junctions", emit);
    if (p.mineral < spec.cost) return this.endOrder(e, "not enough mineral", emit);
    if (this.enemyBuildingNear(p.id, o.x, o.y)) return this.endOrder(e, "too close to an enemy building", emit);
    if (spec.buildMs) {
      if (!e.construction) {
        e.construction = { kind: o.kind, x: o.x, y: o.y, completesAtTick: this.clock.tick + this.clock.ticks(spec.buildMs) };
        this.buildSites.set(tile, e.id);
        this.staticVersion++;
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
    if (reason === "forfeit") this.log.push(e);
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

  private pop(owner: PlayerId): number {
    let n = 0;
    for (const e of this.ents.values()) if (e.owner === owner && !e.spec.building) n++;
    return n;
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
    return this.players.map((p) => (viewer && this.hostile(p.id, viewer) ? {
      id: p.id, name: viewer ? p.id : p.name, popCap: this.ruleset.popCap, team: p.team, alive: p.alive,
    } : {
      id: p.id, name: viewer ? p.id : p.name, mineral: p.mineral, pop: this.pop(p.id), popCap: this.ruleset.popCap,
      queuedPop: this.queuedPop(p.id),
      ...(p.scriptRuntime ? { scriptRuntime: { ...p.scriptRuntime } } : {}),
      score: this.score(p), kills: p.kills + p.buildingKills, team: p.team, alive: p.alive,
      upgrades: { ...p.upgrades }, ...(p.alive && p.research ? { research: {
        upgrade: p.research.upgrade, level: p.research.level, completesAtMs: this.clock.ms(p.research.completesAtTick),
      } } : {}),
    }));
  }

  /** `viewer` null = spectator (sees everything). Intent is private; heading is public. */
  private entityView(e: Entity, viewer: PlayerId | null = null): EntityView {
    const v: EntityView = { id: e.id, kind: e.kind, owner: e.owner, x: e.x, y: e.y, hp: e.hp, maxHp: e.spec.hp };
    v.vital = !!e.spec.vital;
    if (this.ruined.has(e.owner)) v.ruin = true;
    if (e.spec.alliedPassage) v.open = this.occ[e.y * this.grid.width + e.x] !== null;
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
