import type {
  DepositView, EntityView, GameEvent, KindSpec, MatchStatus, Order, OrderResult, Outcome, PlayerId, PlayerStats,
  PlayerView, ProjectileView, Ruleset, SpectatorView, UnderAttack,
} from "@aoa/shared";
import { createScriptHost, type ScriptAction, type ScriptHost, type ScriptWorld } from "@aoa/sandbox";
import { DIRS, DIR_LIST, SEAT_DIRS, canCross, cheb, findPath, inBounds, mapToSeat, seatToMap, type Grid } from "./grid";
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

type UnitOrder =
  | { type: "move"; x: number; y: number }
  | { type: "attack"; target: string }
  | { type: "gather"; deposit?: string }
  | { type: "build"; kind: string; x: number; y: number };

type Intent =
  | { t: "hold" }
  | { t: "goto"; x: number; y: number; range: number }
  | { t: "dir"; dx: number; dy: number }
  | { t: "attack"; id: string }
  | { t: "gather"; id: string }
  | { t: "unload"; id: string }
  | { t: "build" };

interface Entity {
  id: string;
  kind: string;
  spec: KindSpec;
  owner: PlayerId;
  x: number;
  y: number;
  hp: number;
  order: UnitOrder | null;
  nextMove: number;
  nextAttack: number;
  nextGather: number;
  carrying: number;
  path: number[] | null;
  pathKey: string;
  /** Consecutive ticks a unit stood in its way. */
  blocked: number;
  /** Last tick's intent, in words, for the owner's view. */
  doing: string;
  lastStep: { dx: number; dy: number; tick: number } | null;
  lastAttacked?: { id: string; tick: number };
  construction?: { kind: string; x: number; y: number; completesAtTick: number };
  training?: { kind: string; completesAtTick?: number }[];
}

interface Projectile extends ProjectileView { attack: number; launchedAt: number; source?: string }

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
  capital: number;
  kills: number;
  buildingKills: number;
  alive: boolean;
  host: ScriptHost;
  /** Current source per scriptable kind, and whether the player wrote it. */
  scripts: Map<string, { code: string; custom: boolean; errors: string[] }>;
  logsThisTick: number;
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
  private _tick = 0;
  private _outcome: Outcome | null = null;
  private players: Player[];
  private ents = new Map<string, Entity>();
  private deps = new Map<string, Deposit>();
  private occ: (string | null)[];
  /** Buildings that can share a tile with one allied unit. */
  private doors = new Map<number, string>();
  /** Bumped whenever a static tile changes, invalidating cached paths. */
  private staticVersion = 0;
  /** Active timed construction reserves its destination so traffic can route around it. */
  private buildSites = new Map<number, string>();
  private visible = new Map<PlayerId, Set<number>>();
  private explored = new Map<PlayerId, Set<number>>();
  private knownDeposits = new Map<PlayerId, Map<string, Deposit>>();
  private eventAudience = new WeakMap<GameEvent, Set<PlayerId>>();
  private nextId = 1;
  private nextProjectileId = 1;
  private projectiles = new Map<string, Projectile>();
  private log: GameEvent[] = [];
  private conversation: Extract<GameEvent, { type: "chat" }>[] = [];
  private grid: Grid;

  constructor(cfg: MatchConfig) {
    this.ruleset = cfg.ruleset;
    this.tickRate = cfg.tickRate;
    this.seed = cfg.seed;
    this.maxTicks = this.ticks(cfg.ruleset.matchMs);
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
    this.players = cfg.players.map((p, i) => ({
      id: p.id, side: p.side ?? i % 2, team: p.team ?? i, name: p.name, capital: cfg.ruleset.startCapital, kills: 0, buildingKills: 0, alive: true,
      host: createScriptHost(cfg.ruleset.script, (cfg.seed * 31 + i * 7919) >>> 0),
      scripts: new Map(), logsThisTick: 0, upgrades: {}, research: null,
    }));
    for (const p of this.players) {
      for (const [kind, spec] of Object.entries(this.ruleset.kinds)) {
        if (!spec.scriptable) continue;
        const code = this.ruleset.defaultScripts[kind] ?? "self.hold();";
        p.host.setScript(kind, code);
        p.scripts.set(kind, { code, custom: false, errors: [] });
      }
    }
    this.setup();
    this.refreshVision();
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
    const results: OrderResult[] = input.map(() => ({ ok: false, reason: "not processed" }));
    const events: GameEvent[] = [];
    if (this._outcome) return { results: input.map(() => ({ ok: false, reason: "match over" })), events };
    const T = this._tick;
    const emit = (e: GameEvent) => {
      if (this.ruleset.fogOfWar) this.eventAudience.set(e, new Set(this.players.filter((p) => this.canSeeEvent(p.id, e)).map((p) => p.id)));
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
      const kind = this.ruleset.upgrades![upgrade].kind;
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
        const before = p.capital;
        const result = this.apply(po, emit);
        if (po.order?.type === "train" || po.order?.type === "build" || po.order?.type === "upgrade") {
          result.capital = { spent: before - p.capital, remaining: p.capital,
            ...(result.ok && po.order.type === "build" ? { pending: this.ruleset.kinds[po.order.kind].cost } : {}) };
        }
        results[index] = result;
      }
    }

    this.refreshVision();

    // 2. What each entity wants to do: its order, else its script.
    const intents = new Map<string, Intent>();
    const scripted: Entity[] = [];
    for (const e of this.ents.values()) {
      if (!e.spec.moveMs && !e.spec.atk) continue;
      const intent = e.order ? this.orderIntent(e, emit) : null;
      if (intent) intents.set(e.id, intent);
      else if (e.spec.scriptable) scripted.push(e);
    }
    for (const p of prio) {
      const mine = scripted.filter((e) => e.owner === p.id);
      if (mine.length === 0) continue;
      const runs = p.host.run(this.scriptWorld(p, mine), mine.map((e) => e.id));
      for (const e of mine) {
        const r = runs[e.id];
        if (r.error) this.scriptError(p, e, r.error, emit);
        if (r.log && p.logsThisTick++ < 10) emit({ tick: T, type: "log", owner: p.id, unit: e.id, message: r.log });
        intents.set(e.id, this.scriptIntent(e, r.action));
      }
    }

    for (const e of this.ents.values()) {
      const it = intents.get(e.id);
      e.doing = it ? describeIntent(it) : e.spec.moveMs || e.spec.atk ? "hold" : "";
    }

    // 3. Movement, interleaving players.
    for (const e of this.interleaved(prio)) {
      const it = intents.get(e.id);
      if (!it || (it.t !== "goto" && it.t !== "dir") || T < e.nextMove || !e.spec.moveMs) continue;
      if (it.t === "dir") {
        if (this.canStep(e, e.x + it.dx, e.y + it.dy)) this.moveTo(e, e.x + it.dx, e.y + it.dy);
      } else if (!this.walk(e, it.x, it.y, it.range) && e.order) {
        this.endOrder(e, "unreachable", emit);
      }
    }

    this.refreshVision();

    // 4. Melee is immediate; ranged shots launch now and advance on later ticks.
    const damage = new Map<string, number>();
    const lastHit = new Map<string, PlayerId>();
    for (const e of this.interleaved(prio)) {
      const it = intents.get(e.id);
      if (it?.t !== "attack" || T < e.nextAttack || !e.spec.atk) continue;
      const target = this.ents.get(it.id);
      if (!target || !this.canSee(e.owner, target.x, target.y) || !this.hostile(target.owner, e.owner) || cheb(e.x, e.y, target.x, target.y) > (e.spec.range ?? 1)) continue;
      e.nextAttack = T + this.ticks(e.spec.attackMs ?? 1000);
      if (this.ruleset.projectiles && (e.spec.range ?? 1) > 1) {
        const dx = target.x - e.x, dy = target.y - e.y;
        const distance = Math.hypot(dx, dy);
        const id = `p${this.nextProjectileId++}`;
        this.projectiles.set(id, { id, owner: e.owner, x: e.x, y: e.y,
          vx: dx / distance * this.ruleset.projectiles.speed, vy: dy / distance * this.ruleset.projectiles.speed,
          endX: target.x, endY: target.y, attack: e.spec.atk, launchedAt: T, ...(this.ruleset.reactiveScripts ? { source: e.id } : {}) });
        emit({ tick: T, type: "attack", from: e.id, to: target.id, dmg: 0, projectile: id });
      } else {
        const dmg = Math.max(1, e.spec.atk - target.spec.def);
        damage.set(target.id, (damage.get(target.id) ?? 0) + dmg);
        lastHit.set(target.id, e.owner);
        if (this.ruleset.reactiveScripts) target.lastAttacked = { id: e.id, tick: T };
        emit({ tick: T, type: "attack", from: e.id, to: target.id, dmg });
      }
    }

    this.advanceProjectiles(damage, lastHit, emit);

    // 5. Economy and construction.
    for (const e of this.interleaved(prio)) {
      const it = intents.get(e.id);
      if (it?.t === "gather") this.gatherFrom(e, it.id, emit);
      else if (it?.t === "unload") this.unload(e, emit);
      else if (it?.t === "build") this.build(e, emit);
    }

    // 6. Deaths and the vital rule.
    const fallen: Player[] = [];
    for (const [id, dmg] of damage) {
      const e = this.ents.get(id)!;
      e.hp -= dmg;
      if (e.hp > 0) continue;
      const by = lastHit.get(id);
      const killer = this.players.find((p) => p.id === by);
      if (killer) e.spec.building ? killer.buildingKills++ : killer.kills++;
      this.remove(e);
      emit({ tick: T, type: "death", id, kind: e.kind, owner: e.owner, x: e.x, y: e.y, by });
      const owner = this.player(e.owner);
      if (e.spec.vital && owner.alive) (owner.alive = false), fallen.push(owner);
    }
    this.checkEnd(T, emit);
    // In team matches the game can go on without them: everything they had falls.
    if (!this._outcome) for (const p of fallen) this.eliminate(p, emit);

    // A build may complete in the same tick as its order. Otherwise its later
    // spawn event carries the actual charge, rather than claiming it was prepaid.
    input.forEach(({ order, player }, i) => {
      if (order?.type !== "build" || !results[i].ok) return;
      if (input.some((later, j) => j > i && results[j].ok && later.player === player && later.order?.type === "build" && later.order.unit === order.unit)) return;
      const built = events.find((e) => e.type === "spawn" && e.builder === order.unit && e.owner === player && e.kind === order.kind && e.x === order.x && e.y === order.y);
      if (built?.type === "spawn" && built.capital) results[i].capital = built.capital;
    });
    this.refreshVision();
    this._tick++;
    this.log.push(...events);
    this.conversation.push(...events.filter((e): e is Extract<GameEvent, { type: "chat" }> => e.type === "chat"));
    const cutoff = this._tick - EVENT_WINDOW_TICKS;
    if (this.log.length > 0 && this.log[0].tick < cutoff) this.log = this.log.filter((e) => e.tick >= cutoff);
    return { results, events };
  }

  /** Events `player` may see with tick ≥ `since` (attacks excluded: too many). */
  events(player: PlayerId, since: number): GameEvent[] {
    return this.log.filter((e) => e.tick >= since && e.type !== "attack" && e.type !== "projectile_end" && visibleTo(e, player)
      && (!this.ruleset.fogOfWar || e.type === "match_end" || this.eventAudience.get(e)?.has(player))
      && (e.type !== "chat" || (e.channel === "private"
        ? e.owner === player || e.to === player
        : e.channel !== "team" || !this.hostile(e.owner, player))))
      .map((e) => {
        if (this.ruleset.fogOfWar && e.type === "spawn" && this.hostile(e.owner, player)) {
          const { capital, ...publicEvent } = e; return publicEvent;
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
    const all = [...this.ents.values()];
    return {
      tick: this._tick,
      timeMs: this.ms(this._tick),
      matchMs: this.ruleset.matchMs,
      status: this.status(),
      you: player,
      players: this.stats(player),
      ...(this.ruleset.fogOfWar ? { visibility: this.visibilityRows(player) } : {}),
      grid: this.ascii(player),
      mine: all.filter((e) => e.owner === player).map((e) => this.entityView(e, player)),
      allies: all.filter((e) => e.owner !== player && !this.hostile(e.owner, player)).map((e) => this.entityView(e, player)),
      enemy: all.filter((e) => this.hostile(e.owner, player) && this.canSee(player, e.x, e.y)).map((e) => this.entityView(e, player)),
      deposits: this.depositViews().filter((d) => this.canSee(player, d.x, d.y)),
      ...(this.ruleset.projectiles ? { projectiles: this.projectileViews(player) } : {}),
      scripts,
      events,
      underAttack: this.underAttack(player, since ?? this._tick - this.ticks(10_000)),
      timeoutOutcome: this.ruleset.timeoutOutcome ?? "score",
      outcome: this._outcome ?? undefined,
    };
  }

  /** Damage to `player`'s living entities since `since`, grouped by target, from hits and landed projectiles. */
  private underAttack(player: PlayerId, since: number): UnderAttack[] {
    const shooters = new Map<string, string>();
    const hits = new Map<string, { damage: number; attackers: Set<string> }>();
    for (const e of this.log) {
      if (e.type === "attack" && e.projectile) shooters.set(e.projectile, e.from);
      if (e.tick < since) continue;
      const hit = e.type === "attack" && !e.projectile ? { target: e.to, from: e.from, dmg: e.dmg }
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
  spectate(since?: number, options: { includePrivateChat?: boolean; includeTeamChat?: boolean } = {}): SpectatorView {
    const from = since ?? this._tick - 1;
    const message = (e: Extract<GameEvent, { type: "chat" }>) => ({ tick: e.tick, from: e.owner,
      name: this.player(e.owner).name, text: e.text, ...(e.channel ? { channel: e.channel } : {}), ...(e.to ? { to: e.to } : {}) });
    return {
      chat: this.conversation.filter((e) => e.channel === "private" ? options.includePrivateChat : e.channel !== "team" || options.includePrivateChat || options.includeTeamChat).map(message),
      playerChats: Object.fromEntries(this.players.map((p) => [p.id, this.conversation.filter((e) => e.channel === "private"
        ? e.owner === p.id || e.to === p.id : e.channel !== "team" || !this.hostile(e.owner, p.id)).map(message)])),
      tick: this._tick,
      timeMs: this.ms(this._tick),
      matchMs: this.ruleset.matchMs,
      status: this.status(),
      players: this.stats(),
      entities: [...this.ents.values()].map((e) => this.entityView(e)),
      ...(this.ruleset.projectiles ? { projectiles: this.projectileViews() } : {}),
      ...(this.ruleset.fogOfWar ? { perspectives: Object.fromEntries(this.players.map((p) => {
        const view = this.view(p.id, from);
        return [p.id, { visibility: view.visibility!, entities: [...view.mine, ...view.allies, ...view.enemy],
          ...(this.ruleset.projectiles ? { projectiles: view.projectiles } : {}),
          deposits: view.deposits, players: view.players, events: [...view.events.filter((e) => e.type !== "log" && e.type !== "script_error"
            && (e.type !== "chat" || (e.channel === "private" ? options.includePrivateChat : e.channel !== "team" || options.includePrivateChat || options.includeTeamChat))),
            ...this.log.filter((e) => e.tick >= from && (e.type === "attack" || e.type === "projectile_end") && this.eventAudience.get(e)?.has(p.id))] }];
      })) } : {}),
      deposits: this.depositViews(),
      events: this.log.filter((e) => e.tick >= from && e.type !== "log" && e.type !== "script_error"
        && (e.type !== "chat" || (e.channel === "private" ? options.includePrivateChat
          : e.channel !== "team" || options.includePrivateChat || options.includeTeamChat))),
      outcome: this._outcome ?? undefined,
    };
  }

  /** Source of the script `player` runs for `kind`. */
  scriptSource(player: PlayerId, kind: string): { code: string; custom: boolean } | null {
    const s = this.player(player).scripts.get(kind);
    return s ? { code: s.code, custom: s.custom } : null;
  }

  /** `player` leaves (e.g. disconnected): its side loses if it has nobody else left, else it is out. */
  forfeit(player: PlayerId): void {
    if (this._outcome) return;
    const p = this.player(player);
    p.alive = false;
    const teams = this.aliveTeams();
    if (teams.size <= 1) this.finish(this.teamOf([...teams][0]), "forfeit", this._tick, () => {});
    else this.eliminate(p, (e) => {
      if (this.ruleset.fogOfWar) this.eventAudience.set(e, new Set(this.players.filter((q) => this.canSeeEvent(q.id, e)).map((q) => q.id)));
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
    for (const p of this.players) mix(p.capital);
    for (const e of this.ents.values()) {
      for (let i = 0; i < e.id.length; i++) mix(e.id.charCodeAt(i));
      mix(e.x); mix(e.y); mix(e.hp); mix(e.carrying);
      if (this.ruleset.reactiveScripts) {
        mix(e.lastAttacked?.tick ?? -1);
        for (const ch of e.lastAttacked?.id ?? "") mix(ch.charCodeAt(0));
      }
    }
    for (const d of this.deps.values()) mix(d.amount);
    // Keep the legacy hash untouched for rulesets without research.
    if (this.ruleset.upgrades) for (const p of this.players) {
      for (const id of Object.keys(this.ruleset.upgrades).sort()) {
        mix(p.upgrades[id] ?? 0);
        mix(p.research?.upgrade === id ? p.research.level : 0);
        mix(p.research?.upgrade === id ? p.research.completesAtTick : 0);
      }
    }
    if (Object.values(this.ruleset.kinds).some((k) => k.buildMs)) for (const e of this.ents.values()) {
      mix(e.construction?.completesAtTick ?? 0);
      mix(e.construction?.x ?? 0); mix(e.construction?.y ?? 0);
      for (const ch of e.construction?.kind ?? "") mix(ch.charCodeAt(0));
    }
    if (this.ruleset.trainingQueueLimit) for (const e of this.ents.values()) {
      mix(e.training?.length ?? 0);
      for (const job of e.training ?? []) {
        for (const ch of job.kind) mix(ch.charCodeAt(0));
        mix(job.completesAtTick ?? 0);
      }
    }
    if (this.ruleset.fogOfWar) for (const p of this.players) {
      for (const tile of [...(this.explored.get(p.id) ?? [])].sort((a, b) => a - b)) mix(tile);
      for (const d of this.knownDeposits.get(p.id)?.values() ?? []) { mix(d.x); mix(d.y); mix(d.amount); }
    }
    if (this.ruleset.projectiles) {
      mix(this.nextProjectileId);
      for (const p of this.projectiles.values()) for (const c of JSON.stringify(p)) mix(c.charCodeAt(0));
    }
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
  }

  private addDeposit(x: number, y: number, amount: number) {
    const id = `d${this.deps.size + 1}`;
    this.deps.set(id, { id, x, y, amount });
    this.occ[y * this.grid.width + x] = id;
  }

  private spawn(kind: string, owner: PlayerId, x: number, y: number): Entity {
    const spec = this.effectiveSpec(this.player(owner), kind);
    const e: Entity = {
      id: `e${this.nextId++}`, kind, spec, owner, x, y, hp: spec.hp,
      order: spec.gathers && !(this.ruleset.reactiveScripts && spec.scriptable) ? { type: "gather" } : null,
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
    if (this.ruleset.fogOfWar && (!e || e.owner !== p.id)) return { ok: false, reason: `no entity ${o.unit} of yours` };
    if (!e) return { ok: false, reason: `no entity ${o.unit}` };
    if (e.owner !== p.id) return { ok: false, reason: `${o.unit} is not yours` };
    if (!e.spec.moveMs) return { ok: false, reason: `${e.kind} cannot take orders` };
    const { width, height } = this.ruleset.map;
    switch (o.type) {
      case "stop":
        this.clearConstruction(e);
        e.order = null;
        e.path = null;
        return { ok: true };
      case "move":
        if (!inBounds(this.grid, o.x, o.y)) return { ok: false, reason: `(${o.x},${o.y}) is outside the ${width}x${height} map` };
        this.clearConstruction(e);
        e.order = { type: "move", x: o.x, y: o.y };
        return { ok: true };
      case "attack": {
        const t = this.ents.get(o.target);
        if (!e.spec.atk) return { ok: false, reason: `${e.kind} cannot attack` };
        if (!t || !this.canSee(p.id, t.x, t.y)) return { ok: false, reason: `target ${o.target} is not visible or does not exist` };
        if (t.owner === p.id) return { ok: false, reason: `${o.target} is yours` };
        if (!this.hostile(t.owner, p.id)) return { ok: false, reason: `${o.target} is your ally's` };
        this.clearConstruction(e);
        e.order = { type: "attack", target: t.id };
        return { ok: true };
      }
      case "gather":
        if (!e.spec.gathers) return { ok: false, reason: `${e.kind} cannot gather` };
        if (o.deposit !== undefined && (!this.deps.has(o.deposit) || (this.ruleset.fogOfWar && !this.knownDeposits.get(p.id)?.has(o.deposit)))) return { ok: false, reason: `no deposit ${o.deposit}` };
        this.clearConstruction(e);
        e.order = { type: "gather", deposit: o.deposit };
        return { ok: true };
      case "build": {
        const spec = this.ruleset.kinds[o.kind];
        if (!e.spec.builds?.includes(o.kind) || !spec) return { ok: false, reason: `${e.kind} cannot build ${o.kind}` };
        if (!inBounds(this.grid, o.x, o.y)) return { ok: false, reason: `(${o.x},${o.y}) is outside the map` };
        if (!this.canSee(p.id, o.x, o.y)) return { ok: false, reason: "build site must be visible" };
        if (this.grid.isStatic(o.x, o.y) && this.buildSites.get(o.y * this.grid.width + o.x) !== e.id) return { ok: false, reason: `(${o.x},${o.y}) is occupied` };
        if (p.capital < spec.cost) return { ok: false, reason: `needs ${spec.cost} capital, you have ${p.capital}` };
        const near = this.enemyBuildingNear(p.id, o.x, o.y);
        if (near) return { ok: false, reason: `too close to enemy ${near.kind} ${near.id}: keep ${this.ruleset.buildExclusion}+ tiles away` };
        if (e.construction && (e.construction.kind !== o.kind || e.construction.x !== o.x || e.construction.y !== o.y)) this.clearConstruction(e);
        e.order = { type: "build", kind: o.kind, x: o.x, y: o.y };
        return { ok: true };
      }
    }
  }

  private setScript(p: Player, kind: string, code: string | null): OrderResult {
    const cur = p.scripts.get(kind);
    if (!cur) return { ok: false, reason: `${kind} is not scriptable` };
    const source = code ?? this.ruleset.defaultScripts[kind] ?? "self.hold();";
    const r = p.host.setScript(kind, source);
    if (!r.ok) {
      p.host.setScript(kind, cur.code);
      return { ok: false, reason: r.error };
    }
    p.scripts.set(kind, { code: source, custom: code !== null, errors: [] });
    return { ok: true };
  }

  private effectiveSpec(p: Player, kind: string): KindSpec {
    const base = this.ruleset.kinds[kind];
    if (!this.ruleset.upgrades) return base;
    const spec = { ...base };
    for (const [id, level] of Object.entries(p.upgrades)) {
      const upgrade = this.ruleset.upgrades[id];
      if (upgrade.kind === kind) spec[upgrade.stat] = upgrade.levels[level - 1].value;
    }
    return spec;
  }

  private research(p: Player, id: string, emit: (e: GameEvent) => void): OrderResult {
    const upgrade = this.ruleset.upgrades?.[id];
    if (!upgrade || !Object.hasOwn(this.ruleset.upgrades!, id)) return { ok: false, reason: `unknown upgrade ${id}` };
    if (p.research) return { ok: false, reason: `already researching ${p.research.upgrade}` };
    const level = (p.upgrades[id] ?? 0) + 1;
    const next = upgrade.levels[level - 1];
    if (!next) return { ok: false, reason: `${id} is already at maximum level` };
    if (p.capital < next.cost) return { ok: false, reason: `needs ${next.cost} capital, you have ${p.capital}` };
    p.capital -= next.cost;
    p.research = { upgrade: id, level, completesAtTick: this._tick + this.ticks(next.researchMs) };
    emit({ tick: this._tick, type: "research_started", owner: p.id, upgrade: id, level,
      completesAtMs: this.ms(p.research.completesAtTick), capital: { spent: next.cost, remaining: p.capital } });
    return { ok: true };
  }

  private train(p: Player, buildingId: string, kind: string, emit: (e: GameEvent) => void): OrderResult {
    const b = this.ents.get(buildingId);
    const spec = this.ruleset.kinds[kind];
    if (!b || b.owner !== p.id) return { ok: false, reason: `no building ${buildingId} of yours` };
    if (!b.spec.trains?.includes(kind) || !spec) return { ok: false, reason: `${b.kind} cannot train ${kind}` };
    if (p.capital < spec.cost) return { ok: false, reason: `needs ${spec.cost} capital, you have ${p.capital}` };
    if (this.pop(p.id) + this.queuedPop(p.id) >= this.ruleset.popCap) return { ok: false, reason: `population cap ${this.ruleset.popCap} reached` };
    if (spec.trainMs) {
      const queue = b.training ??= [];
      if (queue.length >= (this.ruleset.trainingQueueLimit ?? 5)) return { ok: false, reason: "training queue full" };
      p.capital -= spec.cost;
      queue.push({ kind, ...(queue.length === 0 ? { completesAtTick: this._tick + this.ticks(spec.trainMs) } : {}) });
      emit({ tick: this._tick, type: "training_queued", owner: p.id, building: b.id, kind, position: queue.length });
      return { ok: true };
    }
    const tile = this.freeNeighbor(b.x, b.y, p.id);
    if (!tile) return { ok: false, reason: `no free tile around ${buildingId}` };
    p.capital -= spec.cost;
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

  private endOrder(e: Entity, reason: string, emit: (e: GameEvent) => void) {
    e.order = null;
    this.clearConstruction(e);
    e.path = null;
    emit({ tick: this._tick, type: "order_end", id: e.id, owner: e.owner, reason });
  }

  // ───────────────────────── intents ─────────────────────────

  private orderIntent(e: Entity, emit: (e: GameEvent) => void): Intent | null {
    const o = e.order!;
    const range = e.spec.range ?? 1;
    switch (o.type) {
      case "move": {
        if (e.x === o.x && e.y === o.y) return this.endOrder(e, "arrived", emit), null;
        const r = this.movementGrid(e.owner).isStatic(o.x, o.y) ? 1 : 0;
        if (r === 1 && cheb(e.x, e.y, o.x, o.y) <= 1) return this.endOrder(e, "arrived", emit), null;
        return { t: "goto", x: o.x, y: o.y, range: r };
      }
      case "attack": {
        const t = this.ents.get(o.target);
        if (!t || !this.canSee(e.owner, t.x, t.y)) return this.endOrder(e, "target lost", emit), null;
        if (cheb(e.x, e.y, t.x, t.y) <= range) return { t: "attack", id: t.id };
        return { t: "goto", x: t.x, y: t.y, range };
      }
      case "build": {
        const d = cheb(e.x, e.y, o.x, o.y);
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
      return cheb(e.x, e.y, drop.x, drop.y) <= 1 ? { t: "unload", id: drop.id } : { t: "goto", x: drop.x, y: drop.y, range: 1 };
    }
    if (!dep) return this.endOrder(e, "no deposits left", emit), null;
    return cheb(e.x, e.y, dep.x, dep.y) <= 1 ? { t: "gather", id: dep.id } : { t: "goto", x: dep.x, y: dep.y, range: 1 };
  }

  /** Script actions are untrusted: anything invalid becomes hold. */
  private scriptIntent(e: Entity, a: ScriptAction): Intent {
    const { width, height } = this.ruleset.map;
    switch (a.a) {
      case "gather": {
        if (!this.ruleset.reactiveScripts || !e.spec.gathers) return { t: "hold" };
        if (a.id !== undefined && !(this.ruleset.fogOfWar ? this.knownDeposits.get(e.owner)?.has(a.id) : this.deps.has(a.id))) return { t: "hold" };
        return this.gatherIntent(e, { type: "gather", deposit: a.id }, () => {}) ?? { t: "hold" };
      }
      case "unload": {
        if (!this.ruleset.reactiveScripts || !e.spec.gathers || !e.carrying) return { t: "hold" };
        const drop = this.nearestOwn(e, x => !!x.spec.dropoff);
        if (!drop) return { t: "hold" };
        return cheb(e.x, e.y, drop.x, drop.y) <= 1
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
        if (cheb(e.x, e.y, t.x, t.y) <= range) return { t: "attack", id: t.id };
        return e.spec.moveMs ? { t: "goto", x: t.x, y: t.y, range } : { t: "hold" };
      }
      case "flee": {
        const t = this.ents.get(a.id);
        if (!t || !this.canSee(e.owner, t.x, t.y) || !e.spec.moveMs) return { t: "hold" };
        let best: [number, number] | null = null;
        let bestD = cheb(e.x, e.y, t.x, t.y);
        for (const [dx, dy] of this.dirs(e.owner)) {
          const d = cheb(e.x + dx, e.y + dy, t.x, t.y);
          if (d > bestD && this.canStep(e, e.x + dx, e.y + dy)) [best, bestD] = [[dx, dy], d];
        }
        return best ? { t: "dir", dx: best[0], dy: best[1] } : { t: "hold" };
      }
      default:
        return { t: "hold" };
    }
  }

  private scriptError(p: Player, e: Entity, message: string, emit: (e: GameEvent) => void) {
    const s = p.scripts.get(e.kind);
    if (!s) return;
    if (s.errors.at(-1) !== message) {
      s.errors.push(message);
      if (s.errors.length > 3) s.errors.shift();
      emit({ tick: this._tick, type: "script_error", owner: p.id, kind: e.kind, unit: e.id, message });
    }
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
      if (b && (!enemyBase || (myBase && cheb(myBase.x, myBase.y, b.x, b.y) < cheb(myBase.x, myBase.y, enemyBase.x, enemyBase.y)))) enemyBase = b;
    }
    const relation = (owner: PlayerId) => (owner === p.id ? 1 : this.hostile(owner, p.id) ? 0 : 2);
    const u: ScriptWorld["units"] = {};
    for (const e of units) {
      u[e.id] = {
        id: e.id, type: e.kind, x: e.x, y: e.y, hp: e.hp, maxHp: e.spec.hp, atk: e.spec.atk ?? 0,
        def: e.spec.def, range: e.spec.range ?? 0, vision: e.spec.vision,
        ...(this.ruleset.upgrades ? {
          attackMs: e.spec.attackMs ? this.ms(this.ticks(e.spec.attackMs)) : 0,
          moveMs: e.spec.moveMs ? this.ms(this.ticks(e.spec.moveMs)) : 0,
        } : {}),
        ...(this.ruleset.reactiveScripts ? {
          lastAttackedTick: e.lastAttacked?.tick ?? null,
          lastAttacker: e.lastAttacked && this._tick - e.lastAttacked.tick <= this.ticks(5000) ? e.lastAttacked.id : null,
          ...(e.spec.gathers ? { carrying: e.carrying, carryCapacity: this.ruleset.gather.carry } : {}),
        } : {}),
      };
    }
    return {
      tick: this._tick,
      side: p.side,
      units: u,
      ...(this.ruleset.reactiveScripts ? {
        deposits: [...(this.ruleset.fogOfWar ? this.knownDeposits.get(p.id)?.values() ?? [] : this.deps.values())]
          .map(d => ({ ...d, tie: this.readingKey(d.x, d.y, p.side) })),
      } : {}),
      ...(this.ruleset.projectiles ? { projectiles: this.projectileViews(p.id) } : {}),
      all: [...this.ents.values()].filter((e) => !this.hostile(e.owner, p.id) || this.canSee(p.id, e.x, e.y)).map((e) => [
        e.id, e.kind, e.owner, relation(e.owner), e.x, e.y, e.hp, e.spec.hp, e.spec.building ? 1 : 0, this.readingKey(e.x, e.y, p.side),
      ]),
      myBase,
      enemyBase,
    };
  }

  private projectileViews(player?: PlayerId): ProjectileView[] {
    return [...this.projectiles.values()]
      .filter((p) => !player || this.canSee(player, Math.round(p.x), Math.round(p.y)))
      .map(({ attack, launchedAt, source, ...view }) => ({ ...view }));
  }

  /** Sweep each segment, so fast shots cannot tunnel through an occupied tile. */
  private advanceProjectiles(damage: Map<string, number>, lastHit: Map<string, PlayerId>, emit: (e: GameEvent) => void) {
    const config = this.ruleset.projectiles;
    if (!config) return;
    for (const p of this.projectiles.values()) {
      if (p.launchedAt === this._tick) continue;
      const remaining = Math.hypot(p.endX - p.x, p.endY - p.y);
      const step = Math.min(remaining, config.speed / this.tickRate);
      const nx = p.x + p.vx / config.speed * step, ny = p.y + p.vy / config.speed * step;
      let fraction = Infinity;
      let target: Entity | undefined;
      for (const rock of this.ruleset.map.walls) {
        const hit = segmentCircleHit(p.x, p.y, nx, ny, rock.x, rock.y, config.buildingRadius);
        if (hit !== null && hit < fraction) { fraction = hit; target = undefined; }
      }
      for (const e of this.ents.values()) {
        if (!this.hostile(p.owner, e.owner)) continue;
        const hit = segmentCircleHit(p.x, p.y, nx, ny, e.x, e.y, e.spec.building ? config.buildingRadius : config.unitRadius);
        if (hit !== null && hit < fraction) { fraction = hit; target = e; }
      }
      if (fraction !== Infinity) {
        p.x += (nx - p.x) * fraction; p.y += (ny - p.y) * fraction;
        const dmg = target ? Math.max(1, p.attack - target.spec.def) : 0;
        if (target) {
          damage.set(target.id, (damage.get(target.id) ?? 0) + dmg);
          lastHit.set(target.id, p.owner);
          if (this.ruleset.reactiveScripts) target.lastAttacked = { id: p.source!, tick: this._tick };
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

  private canStep(e: Entity, x: number, y: number): boolean {
    const grid = this.movementGrid(e.owner);
    return inBounds(grid, x, y) && !grid.isStatic(x, y) && this.occ[y * grid.width + x] === null && canCross(grid, e.x, e.y, x - e.x, y - e.y);
  }

  private moveTo(e: Entity, x: number, y: number) {
    const W = this.grid.width;
    this.occ[e.y * W + e.x] = null;
    e.lastStep = { dx: x - e.x, dy: y - e.y, tick: this._tick };
    e.x = x;
    e.y = y;
    this.occ[y * W + x] = e.id;
    e.nextMove = this._tick + this.ticks(e.spec.moveMs!);
  }

  /** One step toward being within `range` of (gx,gy). False if unreachable. */
  private walk(e: Entity, gx: number, gy: number, range: number): boolean {
    // A static goal tile can't be entered: standing next to it is arriving.
    const grid = this.movementGrid(e.owner);
    if (range === 0 && grid.isStatic(gx, gy)) range = 1;
    if (cheb(e.x, e.y, gx, gy) <= range) return true;
    const W = this.grid.width;
    const key = `${gx},${gy},${range},${this.staticVersion}`;
    const adjacent = (i: number) => cheb(e.x, e.y, i % W, (i / W) | 0) === 1;
    // A cached null means "unreachable" and stays valid until the key changes.
    const stale = e.pathKey !== key || (e.path !== null && (e.path.length === 0 || !adjacent(e.path[0])));
    if (stale) {
      e.path = findPath(grid, e.x, e.y, gx, gy, range, this.dirs(e.owner));
      e.pathKey = key;
    }
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
    const h = (x: number, y: number) => Math.max(0, cheb(x, y, gx, gy) - range);
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
      const detour = findPath(grid, e.x, e.y, gx, gy, range, this.dirs(e.owner), avoid);
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
    this.player(e.owner).capital += e.carrying;
    emit({ tick: this._tick, type: "unload", id: e.id, owner: e.owner, amount: e.carrying });
    e.carrying = 0;
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
    if (p.capital < spec.cost) return this.endOrder(e, "not enough capital", emit);
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
    p.capital -= spec.cost;
    const b = this.spawn(o.kind, p.id, o.x, o.y);
    emit({ tick: this._tick, type: "spawn", id: b.id, kind: o.kind, owner: p.id, x: b.x, y: b.y, builder: e.id, capital: { spent: spec.cost, remaining: p.capital } });
    e.order = e.spec.gathers && !(this.ruleset.reactiveScripts && e.spec.scriptable) ? { type: "gather" } : null;
    this.clearConstruction(e);
    e.path = null;
  }

  // ───────────────────────── end ─────────────────────────

  /** Elimination takes priority; a time limit follows the embedded ruleset. */
  private checkEnd(T: number, emit: (e: GameEvent) => void) {
    const teams = this.aliveTeams();
    if (teams.size <= 1 && this.players.some((p) => !p.alive)) {
      this.finish(this.teamOf([...teams][0]), "vital_lost", T, emit);
    } else if (T + 1 >= this.maxTicks) {
      if (this.ruleset.timeoutOutcome === "draw") {
        this.finish([], "timeout", T, emit);
        return;
      }
      const score = new Map<number, number>();
      for (const p of this.players) score.set(p.team, (score.get(p.team) ?? 0) + this.score(p));
      const top = Math.max(...score.values());
      const leaders = [...score].filter(([, s]) => s === top);
      this.finish(leaders.length === 1 ? this.teamOf(leaders[0][0]) : [], "timeout", T, emit);
    }
  }

  private aliveTeams(): Set<number> {
    return new Set(this.players.filter((p) => p.alive).map((p) => p.team));
  }

  /** Every player of `team` (none for undefined: a draw). */
  private teamOf(team: number | undefined): PlayerId[] {
    return this.players.filter((p) => p.team === team).map((p) => p.id);
  }

  private finish(winners: PlayerId[], reason: Outcome["reason"], T: number, emit: (e: GameEvent) => void) {
    const scores: Record<PlayerId, number> = {};
    for (const p of this.players) scores[p.id] = this.score(p);
    this._outcome = { winner: winners.length === 1 ? winners[0] : null, winners, reason, scores };
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
    return this.player(a).team !== this.player(b).team;
  }

  /** A player whose vital entity died in a match that goes on: its entities are removed. */
  private eliminate(p: Player, emit: (e: GameEvent) => void) {
    for (const e of [...this.ents.values()]) {
      if (e.owner !== p.id) continue;
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
      if (b.spec.building && this.hostile(b.owner, owner) && cheb(x, y, b.x, b.y) < this.ruleset.buildExclusion) return b;
    }
    return undefined;
  }

  private dirs(owner: PlayerId): [number, number][] {
    return SEAT_DIRS[this.player(owner).side] ?? DIR_LIST;
  }

  /** Is `a` closer to `e` than `b`? Ties go to the tile first in `e`'s owner's reading order. */
  private closer(e: Entity, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
    const da = cheb(e.x, e.y, a.x, a.y);
    const db = cheb(e.x, e.y, b.x, b.y);
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
    return units * s.unit + buildings * s.building + p.capital * s.capital + p.kills * s.kill + p.buildingKills * s.buildingKill;
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
    const known = this.ruleset.fogOfWar ? this.knownDeposits.get(e.owner)?.values() ?? [] : this.deps.values();
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
    return !this.ruleset.fogOfWar || !!this.visible.get(player)?.has(y * this.grid.width + x);
  }

  private refreshVision() {
    if (!this.ruleset.fogOfWar) return;
    const { width, height } = this.grid;
    for (const p of this.players) {
      const visible = new Set<number>();
      for (const e of this.ents.values()) {
        if (this.hostile(p.id, e.owner)) continue;
        for (let y = Math.max(0, e.y - e.spec.vision); y <= Math.min(height - 1, e.y + e.spec.vision); y++)
          for (let x = Math.max(0, e.x - e.spec.vision); x <= Math.min(width - 1, e.x + e.spec.vision); x++) visible.add(y * width + x);
      }
      this.visible.set(p.id, visible);
      const explored = this.ruleset.fogOfWar.rememberTerrain ? this.explored.get(p.id) ?? new Set<number>() : new Set<number>();
      for (const tile of visible) explored.add(tile);
      this.explored.set(p.id, explored);
      const known = this.knownDeposits.get(p.id) ?? new Map<string, Deposit>();
      for (const [id, d] of known) if (visible.has(d.y * width + d.x) && !this.deps.has(id)) known.delete(id);
      for (const d of this.deps.values()) if (visible.has(d.y * width + d.x)) known.set(d.id, { ...d });
      this.knownDeposits.set(p.id, known);
    }
  }

  private visibilityRows(player: PlayerId): string[] {
    const { width, height } = this.grid;
    return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => this.canSee(player, x, y) ? "2" : this.explored.get(player)?.has(y * width + x) ? "1" : "0").join(""));
  }

  private canSeeEvent(player: PlayerId, event: GameEvent): boolean {
    if (event.type === "match_end" || event.type === "eliminated" || event.type === "chat") return true;
    if ("owner" in event && !this.hostile(player, event.owner)) return true;
    if (event.type === "research_started" || event.type === "upgrade_completed" || event.type === "training_queued" || event.type === "unload" || event.type === "log" || event.type === "script_error" || event.type === "order_end") return false;
    if ("x" in event) return this.canSee(player, Math.round(event.x), Math.round(event.y));
    if (event.type === "depleted") { const d = this.knownDeposits.get(player)?.get(event.id); return !!d && this.canSee(player, d.x, d.y); }
    if (event.type === "attack") {
      const target = this.ents.get(event.to), attacker = this.ents.get(event.from);
      return !!target && !!attacker && this.canSee(player, target.x, target.y) && this.canSee(player, attacker.x, attacker.y);
    }
    return false;
  }

  private status(): MatchStatus {
    return this._outcome ? "finished" : "running";
  }

  private stats(viewer?: PlayerId): PlayerStats[] {
    return this.players.map((p) => (viewer && this.ruleset.fogOfWar && this.hostile(p.id, viewer) ? {
      id: p.id, name: p.name, popCap: this.ruleset.popCap, team: p.team, alive: p.alive,
    } : {
      id: p.id, name: p.name, capital: p.capital, pop: this.pop(p.id), popCap: this.ruleset.popCap,
      ...(this.ruleset.trainingQueueLimit ? { queuedPop: this.queuedPop(p.id) } : {}),
      score: this.score(p), kills: p.kills + p.buildingKills, team: p.team, alive: p.alive,
      ...(this.ruleset.upgrades ? { upgrades: { ...p.upgrades }, ...(p.alive && p.research ? { research: {
        upgrade: p.research.upgrade, level: p.research.level, completesAtMs: this.ms(p.research.completesAtTick),
      } } : {}) } : {}),
    }));
  }

  private ascii(player: PlayerId): string[] {
    const { width, height } = this.ruleset.map;
    const rows = Array.from({ length: height }, () => new Array<string>(width).fill("·"));
    for (const w of this.ruleset.map.walls ?? []) rows[w.y][w.x] = "^";
    for (const d of (this.ruleset.fogOfWar ? this.knownDeposits.get(player)?.values() ?? [] : this.deps.values())) rows[d.y][d.x] = "$";
    const entities = [...this.ents.values()];
    if (this.doors.size) entities.sort((a, b) => Number(!!b.spec.alliedPassage) - Number(!!a.spec.alliedPassage));
    for (const e of entities) {
      if (!this.canSee(player, e.x, e.y)) continue;
      rows[e.y][e.x] = e.owner === player ? e.spec.symbol : this.hostile(e.owner, player) ? e.spec.enemySymbol : e.spec.building ? "=" : "+";
    }
    if (this.ruleset.fogOfWar) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
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
    if (e.spec.alliedPassage) v.open = this.occ[e.y * this.grid.width + e.x] !== null;
    if (e.construction) v.construction = { kind: e.construction.kind, x: e.construction.x, y: e.construction.y,
      completesAtMs: this.ms(e.construction.completesAtTick) };
    if (this.ruleset.upgrades) v.stats = {
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
    if (e.spec.gathers && e.doing.startsWith("gather ")) {
      const deposit = this.deps.get(e.doing.slice(7));
      if (deposit && cheb(e.x, e.y, deposit.x, deposit.y) <= 1) v.gathering = { x: deposit.x, y: deposit.y };
    }
    const o = own ? e.order : null;
    if (o) {
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

function describeIntent(it: Intent): string {
  switch (it.t) {
    case "goto": return `→ ${it.x},${it.y}`;
    case "dir": return `step ${arrow(it.dx, it.dy)}`;
    case "attack": return `attack ${it.id}`;
    case "gather": return `gather ${it.id}`;
    case "unload": return "unload";
    case "build": return "build";
    case "hold": return "hold";
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}
