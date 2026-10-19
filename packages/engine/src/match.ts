import type {
  DepositView, EntityView, GameEvent, KindSpec, MatchStatus, Order, OrderResult, Outcome, PlayerId, PlayerStats,
  Doing, LastSeen, OrderEndReason, PlayerView, ProjectileView, RecordedKind, Ruleset, SpectatorView, UnderAttack, ActionFeedback, ActionAvailability, CombatSummary, UnitOrder, OrderProgress,
} from "@castellan/shared";
import { barrierAxes, blindSpotOnPath, eventOwner, HOLD_SCRIPT, matchLengthMs, NEUTRAL_OWNER, withMineralNames } from "@castellan/shared";
import { createScriptHost, testScript, type ScriptAction, type ScriptActionResult, type ScriptHost, type ScriptHostFactory, type ScriptWorld, type ScriptEvent, type UnitRun } from "@castellan/sandbox";
import { DIRS, DIR_LIST, SEAT_DIRS, canStep, dist, findPath, hypot, inBounds, mapToSeat, seatToMap, type Grid } from "./grid";
import { segmentCircleHit } from "./projectiles";
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

type Intent =
  | { t: "hold" }
  | { t: "goto"; x: number; y: number; range: number }
  | { t: "dir"; dx: number; dy: number }
  | { t: "attack"; id: string }
  | { t: "shoot"; x: number; y: number }
  | { t: "gather"; id: string }
  | { t: "unload"; id: string }
  | { t: "build" };

interface Entity {
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

interface Projectile extends ProjectileView { attack: number; launchedAt: number; source: string; aimedAt: string; fromX: number; fromY: number; minRange: number }

interface OrderHistory {
  order: UnitOrder;
  issuedTick: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastMovedAtTick: number;
  suspendedSince?: number;
  suspendedTicks: number;
  suspensions: number;
  steps: number;
  scriptActions: OrderProgress["scriptActions"];
  blockedTicks: number;
}

interface Deposit {
  id: string;
  x: number;
  y: number;
  amount: number;
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

/** An enemy entity as last seen, and the tick it was. */
type Sighting = Extract<LastSeen, { owner: PlayerId }> & { tick: number };

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
  private _tick = 0;
  private _outcome: Outcome | null = null;
  private players: Player[];
  private ents = new Map<string, Entity>();
  /** View-only counters: never used by simulation decisions, scripts or hashes.
   * One bounded record per unit; removed with the order or garbage-collected. */
  private orderHistory = new WeakMap<Entity, OrderHistory>();
  private deps = new Map<string, Deposit>();
  private occ: (string | null)[];
  /** Buildings that can share a tile with one allied unit. */
  private doors = new Map<number, string>();
  /** Bumped whenever a static tile changes, invalidating cached paths. */
  private staticVersion = 0;
  /** Active timed construction reserves its destination so traffic can route around it. */
  private buildSites = new Map<number, string>();
  private visible = new Map<PlayerId, Set<number>>();
  /** One footprint per living entity; movement or a vision upgrade replaces it. */
  private visionFootprints = new WeakMap<Entity, { x: number; y: number; radius: number; tiles: number[] }>();
  private explored = new Map<PlayerId, Set<number>>();
  private knownDeposits = new Map<PlayerId, Map<string, Deposit>>();
  /** View-only fog memory (not hashed, never shown to scripts): enemy buildings as last seen, and when each deposit was seen. */
  private seenBuildings = new Map<PlayerId, Map<string, Sighting>>();
  private seenUnits = new Map<PlayerId, Map<string, Sighting>>();
  private combatLog = new Map<PlayerId, { tick: number; id: string; kind: RecordedKind; owner: PlayerId; x: number; y: number; damage: number; death: boolean }[]>();
  private seenDeposits = new Map<PlayerId, Map<string, number>>();
  /** Eliminated players: their remaining buildings are inert ruins. */
  private ruined = new Set<PlayerId>();
  private eventAudience = new WeakMap<GameEvent, Set<PlayerId>>();
  private nextId = 1;
  private nextProjectileId = 1;
  private projectiles = new Map<string, Projectile>();
  private log: GameEvent[] = [];
  private conversation: Extract<GameEvent, { type: "chat" }>[] = [];
  private grid: Grid;
  private scriptHostFactory: ScriptHostFactory;

  constructor(cfg: MatchConfig) {
    if (cfg.players.some(p => p.id === NEUTRAL_OWNER)) throw new Error(`Player id ${NEUTRAL_OWNER} is reserved for scenario walls`);
    this.ruleset = withMineralNames(cfg.ruleset);
    this.tickRate = cfg.tickRate;
    this.seed = cfg.seed;
    this.scriptHostFactory = cfg.scriptHostFactory ?? createScriptHost;
    this.maxTicks = this.ticks(matchLengthMs(cfg.ruleset));
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
      for (const p of this.players) {
        for (const [kind, spec] of Object.entries(this.ruleset.kinds)) {
          if (!spec.scriptable) continue;
          const code = this.defaultScript(kind);
          p.host.setScript(kind, code);
          p.scripts.set(kind, { code, custom: false, errors: [] });
        }
      }
      this.setup();
      this.refreshVision();
    } catch (error) {
      for (const host of allocated) host.dispose();
      throw error;
    }
  }

  get tick(): number {
    return this._tick;
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
    const T = this._tick;
    const emit = (e: GameEvent) => {
      this.eventAudience.set(e, new Set(this.players.filter((p) => this.canSeeEvent(p.id, e)).map((p) => p.id)));
      this.rememberCombat(e);
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

    if (this.ruleset.coordinatedMovement) this.assignMoveTargets();
    this.refreshVision();

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

    // 3. Movement: keep player priority, but let a departing friendly column
    // clear from front to back. Occupancy reserves every committed destination.
    const moved = new Set<string>();
    const visiting = new Set<string>();
    const move = (e: Entity) => {
      if (moved.has(e.id) || visiting.has(e.id)) return;
      const it = intents.get(e.id);
      if (!it || (it.t !== "goto" && it.t !== "dir")) return;
      visiting.add(e.id);
      if (this.ruleset.coordinatedMovement && e.spec.moveMs && T >= e.nextMove) {
        const next = it.t === "dir" ? (e.y + it.dy) * this.grid.width + e.x + it.dx : this.route(e, it.x, it.y, it.range)?.[0];
        const nx = it.t === "dir" ? e.x + it.dx : next === undefined ? e.x : next % this.grid.width;
        const ny = it.t === "dir" ? e.y + it.dy : next === undefined ? e.y : Math.floor(next / this.grid.width);
        const grid = this.movementGrid(e.owner);
        const occupant = next === undefined ? undefined : this.ents.get(this.occ[next] ?? "");
        // Never push idle units, borrow an enemy's turn, or exchange occupied tiles.
        if (occupant && occupant.id !== e.id && !this.hostile(e.owner, occupant.owner) && canStep(grid, e.x, e.y, nx - e.x, ny - e.y)) move(occupant);
      }
      visiting.delete(e.id);
      moved.add(e.id);
      if (!e.spec.moveMs) { this.scriptResult(e, "invalid", undefined, "unit cannot move"); return; }
      if (T < e.nextMove) { this.scriptResult(e, "cooldown", undefined, "movement cooldown"); return; }
      const before = { x: e.x, y: e.y };
      if (it.t === "dir") {
        if (this.canStep(e, e.x + it.dx, e.y + it.dy)) this.moveTo(e, e.x + it.dx, e.y + it.dy);
      } else if (!this.walk(e, it.x, it.y, it.range) && e.order && !e.orderSuspended) {
        this.endOrder(e, "unreachable", emit);
      }
      if (before.x !== e.x || before.y !== e.y) this.scriptResult(e, "acted", "move");
      else if (it.t === "goto" && dist(e.x, e.y, it.x, it.y) <= (it.range || (this.movementGrid(e.owner).isStatic(it.x, it.y) ? 1 : 0))) this.scriptResult(e, "arrived");
      else this.scriptResult(e, "blocked", undefined, "step blocked or destination unreachable");
    };
    for (const e of this.interleaved(prio)) move(e);

    this.refreshVision();

    // 4. Melee is immediate; ranged shots launch now and advance on later ticks.
    const damage = new Map<string, number>();
    const lastHit = new Map<string, PlayerId>();
    for (const e of this.interleaved(prio)) {
      const it = intents.get(e.id);
      if (it?.t !== "attack" && it?.t !== "shoot") continue;
      const ranged = (e.spec.range ?? 1) > 1;
      if (!e.spec.atk || (it.t === "shoot" && !ranged)) { this.scriptResult(e, "invalid", undefined, it.t === "shoot" ? "unit cannot shoot" : "unit cannot attack"); continue; }
      if (T < e.nextAttack) { this.scriptResult(e, "cooldown", undefined, "attack cooldown"); continue; }
      // Aim: after a step, the attacker must stand still before it strikes.
      if (e.spec.aimMs && e.lastStep && T - e.lastStep.tick < this.ticks(e.spec.aimMs)) { this.scriptResult(e, "aiming"); continue; }
      if (it.t === "shoot") {
        // Like an attack, but toward a visible point in range; the shot hits the first hostile on its path.
        if (!this.canSee(e.owner, Math.round(it.x), Math.round(it.y)) || !this.inReach(e, it)) { this.scriptResult(e, "blocked", undefined, "point not visible or not in range"); continue; }
        e.nextAttack = T + this.ticks(e.spec.attackMs ?? 1000);
        this.scriptResult(e, "acted", "attack");
        const dx = it.x - e.x, dy = it.y - e.y, distance = hypot(dx, dy) || 1;
        const id = `p${this.nextProjectileId++}`;
        this.projectiles.set(id, { id, owner: e.owner, x: e.x, y: e.y,
          vx: dx / distance * this.ruleset.projectiles.speed, vy: dy / distance * this.ruleset.projectiles.speed,
          endX: it.x, endY: it.y, attack: e.spec.atk, launchedAt: T, source: e.id, aimedAt: "", fromX: e.x, fromY: e.y, minRange: e.spec.minRange ?? 0 });
        emit({ tick: T, type: "attack", from: e.id, at: { x: it.x, y: it.y }, dmg: 0, projectile: id });
        continue;
      }
      const target = this.ents.get(it.id);
      if (!target || !this.canSee(e.owner, target.x, target.y) || !this.hostile(target.owner, e.owner) || !this.inReach(e, target)) { this.scriptResult(e, "blocked", undefined, "target no longer visible or in range"); continue; }
      e.nextAttack = T + this.ticks(e.spec.attackMs ?? 1000);
      this.scriptResult(e, "acted", "attack");
      if ((e.spec.range ?? 1) > 1) {
        const dx = target.x - e.x, dy = target.y - e.y;
        const distance = hypot(dx, dy);
        const id = `p${this.nextProjectileId++}`;
        this.projectiles.set(id, { id, owner: e.owner, x: e.x, y: e.y,
          vx: dx / distance * this.ruleset.projectiles.speed, vy: dy / distance * this.ruleset.projectiles.speed,
          endX: target.x, endY: target.y, attack: e.spec.atk, launchedAt: T, source: e.id, aimedAt: target.id, fromX: e.x, fromY: e.y, minRange: e.spec.minRange ?? 0 });
        emit({ tick: T, type: "attack", from: e.id, to: target.id, dmg: 0, projectile: id });
      } else {
        const dmg = Math.max(1, e.spec.atk - target.spec.def);
        damage.set(target.id, (damage.get(target.id) ?? 0) + dmg);
        lastHit.set(target.id, e.owner);
        target.lastAttacked = { id: e.id, tick: T };
        this.attackedEvent(target, e.id, dmg);
        emit({ tick: T, type: "attack", from: e.id, to: target.id, dmg });
      }
    }

    this.advanceProjectiles(damage, lastHit, emit);

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

    for (const e of this.ents.values()) this.recordOrderProgress(e);

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
    this.refreshVision();
    this._tick++;
    this.log.push(...events);
    this.conversation.push(...events.filter((e): e is Extract<GameEvent, { type: "chat" }> => e.type === "chat"));
    for (const [player, records] of this.combatLog) this.combatLog.set(player, records.filter(r => r.tick >= this._tick - this.ticks(120_000)));
    const cutoff = this._tick - EVENT_WINDOW_TICKS;
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
    const events = this.events(player, since ?? this._tick - this.ticks(10_000));
    const scripts: PlayerView["scripts"] = {};
    for (const [kind, s] of p.scripts) scripts[kind] = { custom: s.custom, errors: [...s.errors] };
    return {
      tick: this._tick,
      timeMs: this.ms(this._tick),
      matchMs: matchLengthMs(this.ruleset),
      drawsAreLosses: this.ruleset.drawsAreLosses,
      status: this.status(),
      you: player,
      players: this.stats(player),
      visibility: this.visibilityRows(player),
      grid: this.ascii(player),
      ...this.visibleEntities(player),
      deposits: this.depositViews().filter((d) => this.canSee(player, d.x, d.y)),
      projectiles: this.projectileViews(player),
      scripts,
      availableActions: this.availableActions(p),
      combat: this.combatSummary(player, since ?? this._tick - this.ticks(10_000)),
      events,
      underAttack: this.underAttack(player, since ?? this._tick - this.ticks(10_000)),
      lastSeen: this.lastSeen(player),
      outcome: this._outcome ?? undefined,
    };
  }

  /** Shared by agent observations and spectator perspectives, in creation order. */
  private visibleEntities(player: PlayerId): Pick<PlayerView, "mine" | "allies" | "enemy"> {
    const mine: EntityView[] = [], allies: EntityView[] = [], enemy: EntityView[] = [];
    for (const e of this.ents.values()) {
      if (e.owner === player) mine.push(this.entityView(e, player));
      else if (!this.hostile(e.owner, player)) allies.push(this.entityView(e, player));
      else if (this.canSee(player, e.x, e.y)) enemy.push(this.entityView(e, player));
    }
    return { mine, allies, enemy };
  }

  /** Remembered enemy buildings and deposits that are outside `player`'s vision now, most recent first. */
  private lastSeen(player: PlayerId): LastSeen[] {
    const out: (LastSeen & { tick: number })[] = [];
    for (const b of this.seenBuildings.get(player)?.values() ?? []) if (!this.canSee(player, b.x, b.y)) out.push({ ...b });
    for (const u of this.seenUnits.get(player)?.values() ?? []) {
      const current = this.ents.get(u.id);
      if (!current || !this.canSee(player, current.x, current.y)) out.push({ ...u });
    }
    const known = this.knownDeposits.get(player);
    for (const [id, tick] of this.seenDeposits.get(player) ?? []) {
      const d = known?.get(id);
      if (d && !this.canSee(player, d.x, d.y)) out.push({ id, kind: "deposit", x: d.x, y: d.y, amount: d.amount, seenMs: 0, tick });
    }
    return out.sort((a, b) => b.tick - a.tick).map(({ tick, ...rest }) => ({ ...rest, seenMs: this.ms(tick) }));
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
      const seen = [...h.attackers].map((a) => this.ents.get(a)).filter((a): a is Entity => !!a && this.canSee(player, a.x, a.y));
      return { id, kind: t.kind, x: t.x, y: t.y, hp: t.hp, maxHp: t.spec.hp, damage: h.damage,
        attackers: seen.map((a) => ({ id: a.id, kind: a.kind, owner: a.owner })), unseenAttackers: h.attackers.size - seen.length };
    }).sort((a, b) => b.damage - a.damage);
  }

  /** Events default to the last tick's. Only finished-match replays opt into private chat. */
  spectate(since?: number, options: { includePrivateChat?: boolean; includeTeamChat?: boolean; includePerspectives?: boolean } = {}): SpectatorView {
    const from = since ?? this._tick - 1;
    const message = (e: Extract<GameEvent, { type: "chat" }>) => ({ tick: e.tick, from: e.owner,
      name: this.player(e.owner).name, text: e.text, ...(e.channel ? { channel: e.channel } : {}), ...(e.to ? { to: e.to } : {}) });
    return {
      chat: this.conversation.filter((e) => e.channel === "private" ? options.includePrivateChat : e.channel !== "team" || options.includePrivateChat || options.includeTeamChat).map(message),
      playerChats: Object.fromEntries(this.players.map((p) => [p.id, this.conversation.filter((e) => e.channel === "private"
        ? e.owner === p.id || e.to === p.id : e.channel !== "team" || !this.hostile(e.owner, p.id)).map(message)])),
      tick: this._tick,
      timeMs: this.ms(this._tick),
      matchMs: matchLengthMs(this.ruleset),
      status: this.status(),
      players: this.stats(),
      entities: [...this.ents.values()].map((e) => this.entityView(e)),
      projectiles: this.projectileViews(),
      ...(options.includePerspectives === false ? {} : { perspectives: Object.fromEntries(this.players.map((p) => {
        const visible = this.visibleEntities(p.id);
        // The player's fog memory, so an observer sees explored ground as that player remembers it.
        const remembered = this.lastSeen(p.id);
        const buildings: EntityView[] = remembered.flatMap((l) => l.kind !== "deposit" && !l.positionCleared ? [{ id: l.id, kind: l.kind, owner: l.owner, x: l.x, y: l.y, hp: l.hp, maxHp: l.maxHp,
          vital: !!this.ruleset.kinds[l.kind]?.vital, ...(l.ruin ? { ruin: true } : {}), lastSeenMs: l.seenMs }] : []);
        const deposits: DepositView[] = remembered.flatMap((l) => l.kind === "deposit" ? [{ id: l.id, x: l.x, y: l.y, amount: l.amount, lastSeenMs: l.seenMs }] : []);
        return [p.id, { visibility: this.visibilityRows(p.id), entities: [...visible.mine, ...visible.allies, ...visible.enemy, ...buildings],
          projectiles: this.projectileViews(p.id),
          deposits: [...this.depositViews().filter(d => this.canSee(p.id, d.x, d.y)), ...deposits], players: this.stats(p.id).map((s) => ({ ...s, name: this.player(s.id).name })), events: [...this.events(p.id, from).filter((e) => e.type !== "log" && e.type !== "script_error"
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
    if (teams.size <= 1) this.finish(this.teamOf([...teams][0]), "forfeit", this._tick, () => {});
    else this.eliminate(p, (e) => {
      this.eventAudience.set(e, new Set(this.players.filter((q) => this.canSeeEvent(q.id, e)).map((q) => q.id)));
      this.log.push(e);
    });
    this.refreshVision();
  }

  /** Compact fingerprint of the state, to detect replay desyncs. */
  hash(): string {
    let h = 0x811c9dc5;
    const mix = (n: number) => {
      h ^= n & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (n >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (n >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
    };
    mix(this._tick);
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
    for (const p of this.players) {
      for (const tile of [...(this.explored.get(p.id) ?? [])].sort((a, b) => a - b)) mix(tile);
      for (const d of this.knownDeposits.get(p.id)?.values() ?? []) { mix(d.x); mix(d.y); mix(d.amount); }
    }
    mix(this.nextProjectileId);
    for (const { fromX, fromY, minRange, ...p } of this.projectiles.values()) for (const c of JSON.stringify(p)) mix(c.charCodeAt(0));
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
        emit({ tick: this._tick, type: "chat", owner: p.id, text: o.text.trim(), channel: "private", to: o.to });
        return { ok: true };
      }
      if (o.channel === "team" && !this.players.some((ally) => ally.id !== p.id && ally.team === p.team)) {
        return { ok: false, reason: "team chat requires a teammate" };
      }
      emit({ tick: this._tick, type: "chat", owner: p.id, text: o.text.trim(), ...(o.channel ? { channel: o.channel } : {}) });
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
        if (!t || !this.canSee(p.id, t.x, t.y)) return { ok: false, reason: `target ${o.target} is not visible or does not exist` };
        if (t.owner === p.id) return { ok: false, reason: `${o.target} is yours` };
        if (!this.hostile(t.owner, p.id)) return { ok: false, reason: `${o.target} is your ally's` };
        this.clearConstruction(e);
        this.assignOrder(e, { type: "attack", target: t.id }, emit);
        return { ok: true };
      }
      case "gather":
        if (!e.spec.gathers) return { ok: false, reason: `${e.kind} cannot gather` };
        if (o.deposit !== undefined && (!this.deps.has(o.deposit) || !this.knownDeposits.get(p.id)?.has(o.deposit))) return { ok: false, reason: `no deposit ${o.deposit}` };
        this.clearConstruction(e);
        this.assignOrder(e, { type: "gather", deposit: o.deposit }, emit);
        return { ok: true };
      case "build": {
        const spec = this.ruleset.kinds[o.kind], kind = e.spec.builds?.find((k) => k === o.kind);
        if (!kind || !spec) return { ok: false, reason: `${e.kind} cannot build ${o.kind}` };
        if (this.locked(p, o.kind)) return { ok: false, reason: `${o.kind} requires ${spec.requires} research` };
        if (!inBounds(this.grid, o.x, o.y)) return { ok: false, reason: `(${o.x},${o.y}) is outside the map` };
        if (!this.canSee(p.id, o.x, o.y)) return { ok: false, reason: "build site must be visible" };
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
    if (!spec.trainMs && !this.freeNeighbor(b.x, b.y, p.id)) reasons.push(`no free tile around ${b.id}`);
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
        blockedBy: [...inactive, ...this.trainBlockers(p, b, kind)], exitBlocked: !this.freeNeighbor(b.x, b.y, p.id) }))),
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

  private rememberCombat(event: GameEvent) {
    const target = event.type === "attack" && !event.projectile && event.to ? this.ents.get(event.to)
      : event.type === "projectile_end" && event.reason === "hit" && event.target ? this.ents.get(event.target) : undefined;
    const record = event.type === "death" ? { tick: event.tick, id: event.id, kind: event.kind, owner: event.owner,
      x: event.x, y: event.y, damage: 0, death: true }
      : target && "dmg" in event && event.dmg > 0 ? { tick: event.tick, id: target.id, kind: target.kind,
        owner: target.owner, x: target.x, y: target.y, damage: event.dmg, death: false } : null;
    if (!record) return;
    for (const p of this.players) {
      if (this.hostile(p.id, record.owner) && !this.canSee(p.id, record.x, record.y)) continue;
      if (record.death) this.seenUnits.get(p.id)?.delete(record.id);
      const records = this.combatLog.get(p.id) ?? [];
      records.push(record); this.combatLog.set(p.id, records);
    }
  }

  private combatSummary(player: PlayerId, since: number): CombatSummary {
    const retained = Math.max(0, this._tick - this.ticks(120_000));
    const from = Math.max(retained, since, 0);
    const encounters: CombatSummary["encounters"] = [];
    for (const r of this.combatLog.get(player) ?? []) {
      if (r.tick < from) continue;
      // Six-tile areas and five seconds of separation define reporting groups,
      // not tactical entities or a source of hidden attacker information.
      const x = Math.floor(r.x / 6) * 6, y = Math.floor(r.y / 6) * 6;
      let group = [...encounters].reverse().find(g => g.x === x && g.y === y && r.tick - g.toTick <= this.ticks(5000));
      if (!group) { group = { x, y, fromTick: r.tick, toTick: r.tick, damage: {}, losses: [] }; encounters.push(group); }
      group.toTick = r.tick;
      if (r.damage) group.damage[r.owner] = (group.damage[r.owner] ?? 0) + r.damage;
      if (r.death) group.losses.push({ id: r.id, kind: r.kind, owner: r.owner, x: r.x, y: r.y });
    }
    return { sinceTick: from, throughTick: this._tick, truncated: since < retained, encounters };
  }

  private research(p: Player, id: string, emit: (e: GameEvent) => void): OrderResult {
    const upgrade = this.ruleset.upgrades[id];
    if (!upgrade || !Object.hasOwn(this.ruleset.upgrades, id)) return { ok: false, reason: `unknown upgrade ${id}` };
    const blockedBy = this.researchBlockers(p, id);
    if (blockedBy.length) return { ok: false, reason: blockedBy[0] };
    const level = (p.upgrades[id] ?? 0) + 1;
    const next = upgrade.levels[level - 1];
    p.mineral -= next.cost;
    p.research = { upgrade: id, level, completesAtTick: this._tick + this.ticks(next.researchMs) };
    emit({ tick: this._tick, type: "research_started", owner: p.id, upgrade: id, level,
      completesAtMs: this.ms(p.research.completesAtTick), mineral: { spent: next.cost, remaining: p.mineral } });
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
      queue.push({ kind, ...(queue.length === 0 ? { completesAtTick: this._tick + this.ticks(spec.trainMs) } : {}) });
      emit({ tick: this._tick, type: "training_queued", owner: p.id, building: b.id, kind, position: queue.length });
      return { ok: true };
    }
    const tile = this.freeNeighbor(b.x, b.y, p.id);
    if (!tile) return { ok: false, reason: `no free tile around ${buildingId}` };
    p.mineral -= spec.cost;
    const u = this.spawn(kind, p.id, tile[0], tile[1]);
    emit({ tick: this._tick, type: "spawn", id: u.id, kind, owner: p.id, x: u.x, y: u.y });
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
      if (!job || job.completesAtTick === undefined || this._tick < job.completesAtTick) continue;
      const tile = this.freeNeighbor(b.x, b.y, b.owner);
      if (!tile) continue; // Ready, but blocked: preserve the paid unit until an exit opens.
      const unit = this.spawn(job.kind, b.owner, tile[0], tile[1]);
      b.training!.shift();
      const next = b.training![0];
      if (next) next.completesAtTick = this._tick + this.ticks(this.ruleset.kinds[next.kind].trainMs!);
      emit({ tick: this._tick, type: "spawn", id: unit.id, kind: unit.kind, owner: b.owner, x: unit.x, y: unit.y });
    }
  }

  private endOrder(e: Entity, reason: OrderEndReason, emit: (e: GameEvent) => void) {
    this.orderHistory.delete(e);
    delete e.moveTarget;
    if (this.ruleset.reactiveOrders && e.order) {
      (e.scriptEvents ??= []).push({ type: "order_ended", tick: this._tick, order: { ...e.order }, reason });
      e.orderSuspended = false;
    }
    e.order = null;
    this.clearConstruction(e);
    e.path = null;
    emit({ tick: this._tick, type: "order_end", id: e.id, owner: e.owner, reason });
  }

  private assignOrder(e: Entity, order: UnitOrder, emit: (e: GameEvent) => void) {
    if (e.order?.type !== "move" || order.type !== "move" || e.order.x !== order.x || e.order.y !== order.y) delete e.moveTarget;
    if (this.ruleset.reactiveOrders) {
      if (e.order && JSON.stringify(e.order) !== JSON.stringify(order)) this.endOrder(e, "replaced", emit);
      e.orderSuspended = false;
    }
    e.order = order;
    this.orderHistory.set(e, { order, issuedTick: this._tick, startX: e.x, startY: e.y,
      lastX: e.x, lastY: e.y, lastMovedAtTick: this._tick,
      suspendedTicks: 0, suspensions: 0, steps: 0, scriptActions: {}, blockedTicks: 0 });
  }

  private recordOrderProgress(e: Entity) {
    const h = this.orderHistory.get(e);
    if (!h) return;
    if (h.order !== e.order) { this.orderHistory.delete(e); return; }
    if (e.x !== h.lastX || e.y !== h.lastY) {
      h.steps++;
      h.lastMovedAtTick = this._tick + 1;
      h.lastX = e.x; h.lastY = e.y;
    }
    if (e.orderSuspended) {
      if (h.suspendedSince === undefined) { h.suspendedSince = this._tick; h.suspensions++; }
      h.suspendedTicks++;
    } else h.suspendedSince = undefined;
    const result = e.actionResult;
    if (result?.tick !== this._tick) return;
    if (result.status === "blocked") h.blockedTicks++;
    if (e.orderSuspended && result.source === "script" && result.status === "acted" && result.effect) {
      h.scriptActions[result.effect] = (h.scriptActions[result.effect] ?? 0) + 1;
    }
  }

  private orderProgress(e: Entity): OrderProgress | undefined {
    const h = this.orderHistory.get(e);
    if (!h || h.order !== e.order) return;
    return {
      ageMs: this.ms(this._tick - h.issuedTick), suspendedMs: this.ms(h.suspendedTicks),
      currentSuspensionMs: h.suspendedSince === undefined ? 0 : this.ms(this._tick - h.suspendedSince),
      suspensions: h.suspensions,
      movement: { steps: h.steps, netTiles: dist(h.startX, h.startY, e.x, e.y),
        stationaryMs: this.ms(this._tick - h.lastMovedAtTick),
        ...(e.order?.type === "move" ? { towardDestination: dist(h.startX, h.startY, e.order.x, e.order.y) - dist(e.x, e.y, e.order.x, e.order.y) } : {}),
      },
      scriptActions: { ...h.scriptActions }, blockedMs: this.ms(h.blockedTicks),
    };
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
      && this.canSee(p.id, other.x, other.y));
    for (const e of units) {
      const seen = enemies.filter(other => this.ruleset.scriptSight === "player" || dist(e.x, e.y, other.x, other.y) <= e.spec.vision)
        .sort((a, b) => dist(e.x, e.y, a.x, a.y) - dist(e.x, e.y, b.x, b.y) || this.readingKey(a.x, a.y, p.side) - this.readingKey(b.x, b.y, p.side));
      const before = new Set(e.seenEnemies ?? []);
      for (const enemy of seen) if (!before.has(enemy.id)) (e.scriptEvents ??= []).push({ type: "enemy_seen", tick: this._tick, enemy: enemy.id });
      e.seenEnemies = seen.map(enemy => enemy.id);
    }
  }

  private attackedEvent(e: Entity, attacker: string, damage: number) {
    if (!this.ruleset.reactiveOrders || !e.spec.scriptable) return;
    const events = e.scriptEvents ??= [];
    const same = events.find(event => event.type === "attacked" && event.tick === this._tick && event.attacker === attacker);
    if (same?.type === "attacked") same.damage += damage;
    else events.push({ type: "attacked", tick: this._tick, damage, attacker });
  }

  // ───────────────────────── intents ─────────────────────────

  private orderIntent(e: Entity, emit: (e: GameEvent) => void): Intent | null {
    const o = e.order!;
    const range = e.spec.range ?? 1;
    switch (o.type) {
      case "move": {
        const goal = this.ruleset.coordinatedMovement ? e.moveTarget ?? o : o;
        if (e.x === goal.x && e.y === goal.y) return this.endOrder(e, "arrived", emit), null;
        const r = this.movementGrid(e.owner).isStatic(goal.x, goal.y) ? 1 : 0;
        if (r === 1 && dist(e.x, e.y, goal.x, goal.y) <= 1) return this.endOrder(e, "arrived", emit), null;
        return { t: "goto", x: goal.x, y: goal.y, range: r };
      }
      case "attack": {
        const t = this.ents.get(o.target);
        if (!t || !this.canSee(e.owner, t.x, t.y)) return this.endOrder(e, "target lost", emit), null;
        if (this.inReach(e, t)) return { t: "attack", id: t.id };
        return { t: "goto", x: t.x, y: t.y, range };
      }
      case "build": {
        const d = dist(e.x, e.y, o.x, o.y);
        if (d === 0) {
          const off = this.freeNeighbor(e.x, e.y, e.owner);
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
        if (a.id !== undefined && !this.knownDeposits.get(e.owner)?.has(a.id)) return { t: "hold" };
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
        if (!t || !this.canSee(e.owner, t.x, t.y) || !this.hostile(t.owner, e.owner) || !e.spec.atk) return { t: "hold" };
        const range = e.spec.range ?? 1;
        if (this.inReach(e, t)) return { t: "attack", id: t.id };
        return e.spec.moveMs ? { t: "goto", x: t.x, y: t.y, range } : { t: "hold" };
      }
      case "shootAt":
        return { t: "shoot", x: clamp(a.x, 0, width - 1), y: clamp(a.y, 0, height - 1) };
      case "flee": {
        const t = this.ents.get(a.id);
        if (!t || !this.canSee(e.owner, t.x, t.y) || !e.spec.moveMs) return { t: "hold" };
        let best: [number, number] | null = null;
        let bestD = dist(e.x, e.y, t.x, t.y);
        for (const [dx, dy] of this.dirs(e.owner)) {
          const d = dist(e.x + dx, e.y + dy, t.x, t.y);
          if (d > bestD && this.canStep(e, e.x + dx, e.y + dy)) [best, bestD] = [[dx, dy], d];
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
        emit({ tick: this._tick, type: "script_error", owner: p.id, kind: e.kind, unit: e.id, message,
          ...(operationalFailure ? { operationalFailure } : {}) });
        if (operationalFailure) {
          p.operationalFailureReported = true;
          p.scriptRuntime = { status: "stopped", tick: this._tick, message };
        }
      }
    }
  }

  private scriptResult(e: Entity, status: ScriptActionResult["status"], effect?: ScriptActionResult["effect"], reason?: string) {
    if (e.actionResult?.tick === this._tick) e.actionResult = { ...e.actionResult, status, ...(effect ? { effect } : {}), ...(reason ? { reason } : {}) };
    // Persistent/manual orders do not replace the previous script's feedback.
    if (e.lastActionResult?.tick !== this._tick) return;
    e.lastActionResult = { tick: this._tick, action: e.lastActionResult.action, status,
      ...(effect ? { effect } : {}), ...(reason ? { reason } : {}) };
  }

  private scriptWorld(p: Player, units: Entity[]): ScriptWorld {
    const baseOf = (owner: PlayerId) => {
      const own = [...this.ents.values()].filter((e) => e.owner === owner && (!this.hostile(owner, p.id) || this.canSee(p.id, e.x, e.y)));
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
        attackMs: e.spec.attackMs ? this.ms(this.ticks(e.spec.attackMs)) : 0,
        moveMs: e.spec.moveMs ? this.ms(this.ticks(e.spec.moveMs)) : 0,
        attackReadyInTicks: Math.max(0, e.nextAttack - this._tick),
        moveReadyInTicks: Math.max(0, e.nextMove - this._tick),
        aimReadyInTicks: e.spec.aimMs && e.lastStep ? Math.max(0, e.lastStep.tick + this.ticks(e.spec.aimMs) - this._tick) : 0,
        gatherReadyInTicks: Math.max(0, e.nextGather - this._tick),
        lastActionResult: e.lastActionResult ?? null,
        moves: Object.fromEntries(Object.entries(DIRS).map(([dir, [dx, dy]]) => {
          const x = e.x + dx, y = e.y + dy;
          if (!e.spec.moveMs || !inBounds(this.grid, x, y)) return [dir, false];
          // A movement query must never expose occupancy behind fog, including
          // the two orthogonal tiles used to check a diagonal crossing.
          if (!this.canSee(p.id, x, y) || (dx && dy && (!this.canSee(p.id, e.x + dx, e.y) || !this.canSee(p.id, e.x, e.y + dy)))) return [dir, null];
          return [dir, this.canStep(e, x, y)];
        })),
        lastAttackedTick: e.lastAttacked?.tick ?? null,
        lastAttacker: e.lastAttacked && this._tick - e.lastAttacked.tick <= this.ticks(5000) ? e.lastAttacked.id : null,
        ...(this.ruleset.reactiveOrders ? {
          order: e.order ? { ...e.order } : null, orderSuspended: !!e.orderSuspended,
          events: (e.scriptEvents ?? []).map(event => {
            if (event.type !== "attacked") return event;
            const attacker = event.attacker ? this.ents.get(event.attacker) : undefined;
            return { ...event, attacker: attacker && this.hostile(attacker.owner, p.id) && this.canSee(p.id, attacker.x, attacker.y) ? attacker.id : null };
          }),
        } : {}),
        ...(e.spec.gathers ? { carrying: e.carrying, carryCapacity: this.ruleset.gather.carry } : {}),
      };
    }
    return {
      ...(this.ruleset.reactiveOrders ? { reactiveOrders: true } : {}),
      tick: this._tick,
      side: p.side,
      units: u,
      deposits: [...this.knownDeposits.get(p.id)?.values() ?? []].map(d => ({ ...d, tie: this.readingKey(d.x, d.y, p.side) })),
      projectiles: this.projectileViews(p.id),
      all: [...this.ents.values()].filter((e) => !this.hostile(e.owner, p.id) || this.canSee(p.id, e.x, e.y)).map((e) => [
        e.id, e.kind, e.owner, relation(e.owner), e.x, e.y, e.hp, e.spec.hp, e.spec.building ? 1 : 0, this.readingKey(e.x, e.y, p.side),
        { atk: e.spec.atk ?? 0, def: e.spec.def, range: e.spec.range ?? 0, minRange: e.spec.minRange ?? 0, vision: e.spec.vision,
          attackMs: e.spec.attackMs ? this.ms(this.ticks(e.spec.attackMs)) : 0, moveMs: e.spec.moveMs ? this.ms(this.ticks(e.spec.moveMs)) : 0,
          ruin: this.ruined.has(e.owner) },
      ]),
      myBase,
      enemyBase,
      sight: this.ruleset.scriptSight === "player" ? "player" : "unit",
    };
  }

  private projectileViews(player?: PlayerId): ProjectileView[] {
    return [...this.projectiles.values()]
      .filter((p) => !player || this.canSee(player, Math.round(p.x), Math.round(p.y)))
      .map(({ attack, launchedAt, source, aimedAt, fromX, fromY, minRange, ...view }) => ({ ...view }));
  }

  /** Sweep each segment, so fast shots cannot tunnel through an occupied tile. */
  private advanceProjectiles(damage: Map<string, number>, lastHit: Map<string, PlayerId>, emit: (e: GameEvent) => void) {
    const config = this.ruleset.projectiles;
    const blindSpot = blindSpotOnPath(this.ruleset);
    for (const p of this.projectiles.values()) {
      if (p.launchedAt === this._tick) continue;
      const remaining = hypot(p.endX - p.x, p.endY - p.y);
      const step = Math.min(remaining, config.speed / this.tickRate);
      const nx = p.x + p.vx / config.speed * step, ny = p.y + p.vy / config.speed * step;
      let fraction = Infinity;
      let target: Entity | undefined;
      for (const e of this.ents.values()) {
        if (!this.hostile(p.owner, e.owner)) continue;
        if (config.flyOver.includes(e.kind) && e.id !== p.aimedAt) continue;
        // The shooter's blind spot: a minimum-range shooter hits nothing closer than it (the guide promises adjacent units are safe).
        if (blindSpot && p.minRange && dist(p.fromX, p.fromY, e.x, e.y) < p.minRange) continue;
        const hit = segmentCircleHit(p.x, p.y, nx, ny, e.x, e.y, e.spec.building ? config.buildingRadius : config.unitRadius);
        if (hit !== null && hit < fraction) { fraction = hit; target = e; }
      }
      if (fraction !== Infinity) {
        p.x += (nx - p.x) * fraction; p.y += (ny - p.y) * fraction;
        const dmg = target ? Math.max(1, p.attack - target.spec.def) : 0;
        if (target) {
          damage.set(target.id, (damage.get(target.id) ?? 0) + dmg);
          lastHit.set(target.id, p.owner);
          target.lastAttacked = { id: p.source, tick: this._tick };
          this.attackedEvent(target, p.source, dmg);
        }
        emit({ tick: this._tick, type: "projectile_end", id: p.id, x: p.x, y: p.y,
          ...(target ? { target: target.id } : {}), dmg, reason: target ? "hit" : "blocked" });
        this.projectiles.delete(p.id);
      } else if (remaining <= step + 1e-9) {
        emit({ tick: this._tick, type: "projectile_end", id: p.id, x: p.endX, y: p.endY, dmg: 0, reason: "miss" });
        this.projectiles.delete(p.id);
      } else { p.x = nx; p.y = ny; }
    }
  }

  // ───────────────────────── movement ─────────────────────────

  /** Doors remain solid for placement, but pathfinding depends on the moving side. */
  private movementGrid(owner: PlayerId): Grid {
    if (!this.doors.size) return this.grid;
    return { width: this.grid.width, height: this.grid.height, isStatic: (x, y) => {
      const tile = y * this.grid.width + x;
      const door = this.doors.get(tile);
      if (door) return this.hostile(owner, this.ents.get(door)!.owner);
      return this.grid.isStatic(x, y);
    } };
  }

  private pathDiagonalCost(e: Entity): number {
    return this.ruleset.tickPathCosts ? this.ticks(e.spec.moveMs! * this.ruleset.diagonalMove) : Math.round(10 * this.ruleset.diagonalMove);
  }

  private pathStraightCost(e: Entity): number | undefined {
    return this.ruleset.tickPathCosts ? this.ticks(e.spec.moveMs!) : undefined;
  }

  /** Within attack range, and not inside the attacker's blind spot (`minRange`). */
  private inReach(e: Entity, t: { x: number; y: number }): boolean {
    const d = dist(e.x, e.y, t.x, t.y);
    return d <= (e.spec.range ?? 1) && d >= (e.spec.minRange ?? 0);
  }

  private canStep(e: Entity, x: number, y: number): boolean {
    const grid = this.movementGrid(e.owner);
    return canStep(grid, e.x, e.y, x - e.x, y - e.y) && this.occ[y * grid.width + x] === null;
  }

  private moveTo(e: Entity, x: number, y: number) {
    const W = this.grid.width;
    this.occ[e.y * W + e.x] = null;
    const diagonal = x !== e.x && y !== e.y;
    e.lastStep = { dx: x - e.x, dy: y - e.y, tick: this._tick };
    e.x = x;
    e.y = y;
    this.occ[y * W + x] = e.id;
    e.nextMove = this._tick + this.ticks(e.spec.moveMs! * (diagonal ? this.ruleset.diagonalMove : 1));
  }

  private route(e: Entity, gx: number, gy: number, range: number): number[] | null {
    const grid = this.movementGrid(e.owner);
    if (range === 0 && grid.isStatic(gx, gy)) range = 1;
    if (dist(e.x, e.y, gx, gy) <= range) return [];
    const W = grid.width;
    const key = `${gx},${gy},${range},${this.staticVersion}` + (this.ruleset.tickPathCosts ? `,${this.pathStraightCost(e)},${this.pathDiagonalCost(e)}` : "");
    const adjacent = (i: number) => dist(e.x, e.y, i % W, (i / W) | 0) === 1;
    // A cached null means "unreachable" and stays valid until the key changes.
    const stale = e.pathKey !== key || (e.path !== null && (e.path.length === 0 || !adjacent(e.path[0])));
    if (stale) {
      e.path = findPath(grid, e.x, e.y, gx, gy, range, this.dirs(e.owner), undefined, this.pathDiagonalCost(e), this.pathStraightCost(e));
      e.pathKey = key;
    }
    return e.path;
  }

  /** Assign only explicit same-owner move orders; scripts keep exact destinations. */
  private assignMoveTargets() {
    const groups = new Map<string, Entity[]>();
    for (const e of this.ents.values()) {
      if (e.order?.type !== "move") continue;
      const key = `${e.owner},${e.order.x},${e.order.y}`;
      const group = groups.get(key) ?? []; group.push(e); groups.set(key, group);
    }
    // Compute each owner's static connected components lazily. This bounds
    // destination allocation even if every nearby candidate is unreachable.
    const components = new Map<PlayerId, Map<number, Set<number>>>();
    const reachable = (e: Entity) => {
      const grid = this.movementGrid(e.owner), W = grid.width;
      const cache = components.get(e.owner) ?? new Map<number, Set<number>>();
      components.set(e.owner, cache);
      const origin = e.y * W + e.x;
      if (cache.has(origin)) return cache.get(origin)!;
      const seen = new Set([origin]), queue = [origin];
      for (let i = 0; i < queue.length; i++) {
        const x = queue[i] % W, y = Math.floor(queue[i] / W);
        for (const [dx, dy] of this.dirs(e.owner)) {
          const nx = x + dx, ny = y + dy, tile = ny * W + nx;
          if (seen.has(tile) || !canStep(grid, x, y, dx, dy)) continue;
          seen.add(tile); queue.push(tile);
        }
      }
      for (const tile of seen) cache.set(tile, seen);
      return seen;
    };
    const reserved = new Map<PlayerId, Set<number>>();
    for (const group of groups.values()) {
      for (const e of group) {
        const grid = this.movementGrid(e.owner);
        if (e.moveTarget && grid.isStatic(e.moveTarget.x, e.moveTarget.y)) delete e.moveTarget;
        const target = e.moveTarget ?? (group.length === 1 ? e.order as Extract<UnitOrder, {type: "move"}> : undefined);
        const tiles = reserved.get(e.owner) ?? new Set<number>();
        if (target) tiles.add(target.y * grid.width + target.x);
        reserved.set(e.owner, tiles);
      }
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const goal = group[0].order as Extract<UnitOrder, { type: "move" }>;
      const grid = this.movementGrid(group[0].owner), W = grid.width;
      const members = new Set(group.map(e => e.id));
      const claimed = reserved.get(group[0].owner)!;
      if (group.every(e => e.moveTarget)) continue;
      // A narrow passage may need one approach-side tile per arriving unit.
      const radius = group.length;
      const candidates: { x: number; y: number }[] = [];
      for (let y = Math.max(0, goal.y - radius); y <= Math.min(grid.height - 1, goal.y + radius); y++) {
        for (let x = Math.max(0, goal.x - radius); x <= Math.min(W - 1, goal.x + radius); x++) {
          const occupant = this.occ[y * W + x];
          if (!grid.isStatic(x, y) && (occupant === null || members.has(occupant))) candidates.push({ x, y });
        }
      }
      const squared = (a: {x: number; y: number}, b: {x: number; y: number}) => (a.x-b.x)**2 + (a.y-b.y)**2;
      // Closest units claim first; the existing entity order breaks exact ties.
      for (const e of [...group].sort((a,b) => squared(a,goal) - squared(b,goal))) {
        if (e.moveTarget) continue;
        candidates.sort((a,b) => squared(a,goal) - squared(b,goal) || squared(a,e) - squared(b,e)
          || this.readingKey(a.x,a.y,this.player(e.owner).side) - this.readingKey(b.x,b.y,this.player(e.owner).side));
        const accessible = reachable(e);
        if (!grid.isStatic(goal.x, goal.y) && !accessible.has(goal.y * W + goal.x)) continue;
        for (const tile of candidates) {
          if (claimed.has(tile.y * W + tile.x) || !accessible.has(tile.y * W + tile.x)) continue;
          // Do not ask followers to pass a leader that has already parked at the goal.
          if ((tile.x-goal.x)*(e.x-goal.x) + (tile.y-goal.y)*(e.y-goal.y) < 0) continue;
          e.moveTarget = { ...tile }; claimed.add(tile.y * W + tile.x); break;
        }
      }
    }
  }

  /** One step toward being within `range` of (gx,gy). False if unreachable. */
  private walk(e: Entity, gx: number, gy: number, range: number): boolean {
    // A static goal tile can't be entered: standing next to it is arriving.
    const grid = this.movementGrid(e.owner);
    if (range === 0 && grid.isStatic(gx, gy)) range = 1;
    if (dist(e.x, e.y, gx, gy) <= range) return true;
    const W = this.grid.width;
    this.route(e, gx, gy, range);
    if (!e.path) return false;
    if (e.path.length === 0) return true;
    const next = e.path[0];
    const nx = next % W;
    const ny = (next / W) | 0;
    if (this.canStep(e, nx, ny)) {
      this.moveTo(e, nx, ny);
      e.path.shift();
      e.blocked = 0;
      return true;
    }
    // A unit is in the way. First try a free tile that still gets closer.
    e.blocked++;
    const h = (x: number, y: number) => Math.max(0, dist(x, y, gx, gy) - range);
    const here = h(e.x, e.y);
    let best: [number, number] | null = null;
    for (const [dx, dy] of this.dirs(e.owner)) {
      const x = e.x + dx;
      const y = e.y + dy;
      if (h(x, y) < here && this.canStep(e, x, y) && (!best || h(x, y) < h(best[0], best[1]))) best = [x, y];
    }
    // Still stuck after a moment: plan around the units next to us.
    if (!best && e.blocked >= 3) {
      const avoid = new Set<number>();
      for (const [dx, dy] of DIR_LIST) {
        const x = e.x + dx;
        const y = e.y + dy;
        if (inBounds(this.grid, x, y) && this.occ[y * W + x] !== null) avoid.add(y * W + x);
      }
      const detour = findPath(grid, e.x, e.y, gx, gy, range, this.dirs(e.owner), avoid, this.pathDiagonalCost(e), this.pathStraightCost(e));
      if (detour && detour.length > 0 && this.canStep(e, detour[0] % W, (detour[0] / W) | 0)) best = [detour[0] % W, (detour[0] / W) | 0];
    }
    if (best) {
      this.moveTo(e, best[0], best[1]);
      e.path = null;
      e.pathKey = "";
      e.blocked = 0;
    }
    return true;
  }

  // ───────────────────────── economy ─────────────────────────

  private gatherFrom(e: Entity, depId: string, emit: (e: GameEvent) => void) {
    const d = this.deps.get(depId);
    if (!d || this._tick < e.nextGather || e.carrying >= this.ruleset.gather.carry) return;
    e.carrying++;
    d.amount--;
    e.nextGather = this._tick + this.ticks(this.ruleset.gather.ms);
    if (d.amount <= 0) {
      this.deps.delete(d.id);
      this.occ[d.y * this.grid.width + d.x] = null;
      this.staticVersion++;
      emit({ tick: this._tick, type: "depleted", id: d.id });
    }
  }

  private unload(e: Entity, emit: (e: GameEvent) => void) {
    if (e.carrying === 0) return;
    this.player(e.owner).mineral += e.carrying;
    emit({ tick: this._tick, type: "unload", id: e.id, owner: e.owner, amount: e.carrying });
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
        e.construction = { kind: o.kind, x: o.x, y: o.y, completesAtTick: this._tick + this.ticks(spec.buildMs) };
        this.buildSites.set(tile, e.id);
        this.staticVersion++;
        emit({ tick: this._tick, type: "construction_started", owner: p.id, builder: e.id, kind: o.kind,
          x: o.x, y: o.y, completesAtMs: this.ms(e.construction.completesAtTick) });
      }
      if (this._tick < e.construction.completesAtTick) return;
    }
    p.mineral -= spec.cost;
    const b = this.spawn(o.kind, p.id, o.x, o.y);
    emit({ tick: this._tick, type: "spawn", id: b.id, kind: o.kind, owner: p.id, x: b.x, y: b.y, builder: e.id, mineral: { spent: spec.cost, remaining: p.mineral } });
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

  private ticks(ms: number): number {
    return Math.max(1, Math.round((ms * this.tickRate) / 1000));
  }
  private ms(ticks: number): number {
    return Math.round((ticks * 1000) / this.tickRate);
  }

  private player(id: PlayerId): Player {
    const p = this.players.find((x) => x.id === id);
    if (!p) throw new Error(`unknown player ${id}`);
    return p;
  }

  /** Players in this tick's priority order: rotates every tick, so each goes first in turn. */
  private priority(): Player[] {
    const k = this._tick % this.players.length;
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
      emit({ tick: this._tick, type: "death", id: e.id, kind: e.kind, owner: e.owner, x: e.x, y: e.y });
    }
    emit({ tick: this._tick, type: "eliminated", owner: p.id });
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

  private dirs(owner: PlayerId): [number, number][] {
    return SEAT_DIRS[this.player(owner).side] ?? DIR_LIST;
  }

  /** Is `a` closer to `e` than `b`? Ties go to the tile first in `e`'s owner's reading order. */
  private closer(e: Entity, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
    const da = dist(e.x, e.y, a.x, a.y);
    const db = dist(e.x, e.y, b.x, b.y);
    if (da !== db) return da < db;
    const side = this.player(e.owner).side;
    return this.readingKey(a.x, a.y, side) < this.readingKey(b.x, b.y, side);
  }

  /** Position of a tile in a seat's own reading order (row by row from its corner). */
  private readingKey(x: number, y: number, side: number): number {
    const { width: W, height: H } = this.ruleset.map;
    const [lx, ly] = mapToSeat(x, y, side, W, H);
    return ly * W + lx;
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

  private freeNeighbor(x: number, y: number, owner: PlayerId): [number, number] | null {
    for (const [dx, dy] of this.dirs(owner)) {
      const nx = x + dx;
      const ny = y + dy;
      if (inBounds(this.grid, nx, ny) && !this.movementGrid(owner).isStatic(nx, ny) && this.occ[ny * this.grid.width + nx] === null) return [nx, ny];
    }
    return null;
  }

  private nearestDeposit(e: Entity): Deposit | undefined {
    let best: Deposit | undefined;
    const known = this.knownDeposits.get(e.owner)?.values() ?? [];
    for (const d of known) if (!best || this.closer(e, d, best)) best = d;
    return best;
  }

  private nearestOwn(e: Entity, pred: (x: Entity) => boolean): Entity | undefined {
    let best: Entity | undefined;
    for (const x of this.ents.values()) {
      if (x.owner !== e.owner || !pred(x)) continue;
      if (!best || this.closer(e, x, best)) best = x;
    }
    return best;
  }

  private canSee(player: PlayerId, x: number, y: number): boolean {
    return !!this.visible.get(player)?.has(y * this.grid.width + x);
  }

  /** Tiles within `e`'s vision, cached until it moves or its vision changes. */
  private visionTiles(e: Entity): number[] {
    const cached = this.visionFootprints.get(e);
    if (cached && cached.x === e.x && cached.y === e.y && cached.radius === e.spec.vision) return cached.tiles;
    const { width, height } = this.grid;
    const tiles: number[] = [];
    for (let y = Math.max(0, e.y - e.spec.vision); y <= Math.min(height - 1, e.y + e.spec.vision); y++)
      for (let x = Math.max(0, e.x - e.spec.vision); x <= Math.min(width - 1, e.x + e.spec.vision); x++)
        if (dist(e.x, e.y, x, y) <= e.spec.vision) tiles.push(y * width + x);
    this.visionFootprints.set(e, { x: e.x, y: e.y, radius: e.spec.vision, tiles });
    return tiles;
  }

  private refreshVision() {
    const { width } = this.grid;
    for (const p of this.players) {
      const visible = new Set<number>();
      const reveal = this.ruleset.revealAttackerMs ? this.ticks(this.ruleset.revealAttackerMs) : -1;
      for (const e of this.ents.values()) {
        if (this.hostile(p.id, e.owner) || this.ruined.has(e.owner)) continue;
        for (const tile of this.visionTiles(e)) visible.add(tile);
        // Whoever recently damaged it is revealed, wherever it stands.
        const by = e.lastAttacked && this._tick - e.lastAttacked.tick <= reveal ? this.ents.get(e.lastAttacked.id) : undefined;
        if (by && this.hostile(p.id, by.owner)) visible.add(by.y * width + by.x);
      }
      this.visible.set(p.id, visible);
      const explored = this.explored.get(p.id) ?? new Set<number>();
      for (const tile of visible) explored.add(tile);
      this.explored.set(p.id, explored);
      const known = this.knownDeposits.get(p.id) ?? new Map<string, Deposit>();
      for (const [id, d] of known) if (visible.has(d.y * width + d.x) && !this.deps.has(id)) known.delete(id);
      for (const d of this.deps.values()) if (visible.has(d.y * width + d.x)) known.set(d.id, { ...d });
      this.knownDeposits.set(p.id, known);
      const depositSeen = this.seenDeposits.get(p.id) ?? new Map<string, number>();
      for (const id of depositSeen.keys()) if (!known.has(id)) depositSeen.delete(id);
      for (const d of known.values()) if (visible.has(d.y * width + d.x)) depositSeen.set(d.id, this._tick);
      this.seenDeposits.set(p.id, depositSeen);
      const buildings = this.seenBuildings.get(p.id) ?? new Map<string, Sighting>();
      for (const [id, b] of buildings) if (visible.has(b.y * width + b.x) && !this.ents.has(id)) buildings.delete(id);
      for (const e of this.ents.values()) if (e.spec.building && this.hostile(p.id, e.owner) && visible.has(e.y * width + e.x)) {
        buildings.set(e.id, { id: e.id, kind: e.kind, owner: e.owner, x: e.x, y: e.y, hp: e.hp, maxHp: e.spec.hp,
          ...(this.ruined.has(e.owner) ? { ruin: true } : {}), seenMs: 0, tick: this._tick });
      }
      this.seenBuildings.set(p.id, buildings);
      const units = this.seenUnits.get(p.id) ?? new Map<string, Sighting>();
      // Unit sightings are history, not occupied tiles. Seeing an empty former
      // position marks it cleared without revealing the unit's hidden new one.
      for (const u of units.values()) if (visible.has(u.y * width + u.x)) u.positionCleared = true;
      for (const e of this.ents.values()) if (!e.spec.building && this.hostile(p.id, e.owner) && visible.has(e.y * width + e.x)) {
        units.set(e.id, { id: e.id, kind: e.kind, owner: e.owner, x: e.x, y: e.y, hp: e.hp, maxHp: e.spec.hp, entityType: "unit", seenMs: 0, tick: this._tick });
      }
      this.seenUnits.set(p.id, units);
    }
  }

  private visibilityRows(player: PlayerId): string[] {
    const { width, height } = this.grid;
    return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => this.canSee(player, x, y) ? "2" : this.explored.get(player)?.has(y * width + x) ? "1" : "0").join(""));
  }

  private canSeeEvent(player: PlayerId, event: GameEvent): boolean {
    if (event.type === "match_end" || event.type === "eliminated" || event.type === "chat") return true;
    const owner = eventOwner(event);
    if (owner !== undefined && !this.hostile(player, owner)) return true;
    if (event.type === "research_started" || event.type === "upgrade_completed" || event.type === "training_queued" || event.type === "unload" || event.type === "log" || event.type === "script_error" || event.type === "order_end") return false;
    if ("x" in event) return this.canSee(player, Math.round(event.x), Math.round(event.y));
    if (event.type === "depleted") { const d = this.knownDeposits.get(player)?.get(event.id); return !!d && this.canSee(player, d.x, d.y); }
    if (event.type === "attack") {
      const attacker = this.ents.get(event.from);
      const aim = event.to ? this.ents.get(event.to) : event.at && { x: Math.round(event.at.x), y: Math.round(event.at.y) };
      return !!aim && !!attacker && this.canSee(player, aim.x, aim.y) && this.canSee(player, attacker.x, attacker.y);
    }
    return false;
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
        upgrade: p.research.upgrade, level: p.research.level, completesAtMs: this.ms(p.research.completesAtTick),
      } } : {}),
    }));
  }

  private ascii(player: PlayerId): string[] {
    const { width, height } = this.ruleset.map;
    const rows = Array.from({ length: height }, () => new Array<string>(width).fill("·"));
    for (const w of this.ruleset.map.walls ?? []) rows[w.y][w.x] = "^";
    for (const d of this.knownDeposits.get(player)?.values() ?? []) rows[d.y][d.x] = "$";
    const entities = [...this.ents.values()];
    if (this.doors.size) entities.sort((a, b) => Number(!!b.spec.alliedPassage) - Number(!!a.spec.alliedPassage));
    for (const e of entities) {
      if (!this.canSee(player, e.x, e.y)) continue;
      rows[e.y][e.x] = e.owner === player ? e.spec.symbol : this.hostile(e.owner, player) ? e.spec.enemySymbol : e.spec.building ? "=" : "+";
    }
    for (const b of this.seenBuildings.get(player)?.values() ?? []) {
      if (!this.canSee(player, b.x, b.y)) rows[b.y][b.x] = this.ruleset.kinds[b.kind]?.enemySymbol ?? "?";
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (this.canSee(player, x, y)) continue;
      if (!this.explored.get(player)?.has(y * width + x)) rows[y][x] = "?";
      else if (rows[y][x] === "·") rows[y][x] = ":";
    }
    return rows.map((r) => r.join(""));
  }

  /** `viewer` null = spectator (sees everything). Intent is private; heading is public. */
  private entityView(e: Entity, viewer: PlayerId | null = null): EntityView {
    const v: EntityView = { id: e.id, kind: e.kind, owner: e.owner, x: e.x, y: e.y, hp: e.hp, maxHp: e.spec.hp };
    v.vital = !!e.spec.vital;
    if (this.ruined.has(e.owner)) v.ruin = true;
    if (e.spec.alliedPassage) v.open = this.occ[e.y * this.grid.width + e.x] !== null;
    if (e.construction) v.construction = { kind: e.construction.kind, x: e.construction.x, y: e.construction.y,
      completesAtMs: this.ms(e.construction.completesAtTick) };
    v.stats = {
      atk: e.spec.atk ?? 0, def: e.spec.def, range: e.spec.range ?? 0,
      attackMs: e.spec.attackMs ? this.ms(this.ticks(e.spec.attackMs)) : 0,
      moveMs: e.spec.moveMs ? this.ms(this.ticks(e.spec.moveMs)) : 0,
    };
    if (e.lastStep && this._tick - e.lastStep.tick <= this.ticks(1000)) v.heading = arrow(e.lastStep.dx, e.lastStep.dy);
    const own = viewer === null || viewer === e.owner;
    if (own && e.training?.length) v.training = e.training.map((job) => ({ kind: job.kind,
      ...(job.completesAtTick !== undefined ? { completesAtMs: this.ms(job.completesAtTick) } : {}),
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
      const progress = this.orderProgress(e);
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
