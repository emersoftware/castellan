import type { GameEvent, OrderEndReason, OrderResult, PlayerId, PlayerStats, PlayerView, Ruleset, UnitOrder } from "@castellan/shared";
import { dist, HOLD_SCRIPT } from "@castellan/shared";
import { testScript, type ScriptActionResult, type ScriptHost, type ScriptHostFactory, type ScriptWorld, type UnitRun } from "@castellan/sandbox";
import type { SimulationClock } from "./clock";
import type { Combat } from "./combat";
import type { Entity, Player } from "./entities";
import { DIRS, inBounds, type Grid } from "./grid";
import type { Movement } from "./movement";
import type { PlayerVision } from "./vision";

/** One player's script VM and what it has installed. */
interface Seat {
  host: ScriptHost;
  /** The VM's PRNG seed, derived from the match seed; a script test runs a fresh VM from it. */
  seed: number;
  /** Current source per scriptable kind, whether the player wrote it, and its last errors (three at most). */
  scripts: Map<string, { code: string; custom: boolean; errors: string[] }>;
  operationalFailureReported?: true;
  runtime?: PlayerStats["scriptRuntime"];
}

/**
 * The unit scripts players install: one VM per player, seeded from the match, running the player's
 * source per kind (the rules' default until it uploads its own). Builds what a script sees within the
 * player's sight, queues the events it hears (sightings, hits, ended orders) and delivers them once,
 * records what each decision achieved, keeps script errors for the player's view and limits logs.
 */
export class UnitScripts {
  private seats = new Map<PlayerId, Seat>();

  constructor(private rules: () => Ruleset, private clock: Readonly<SimulationClock>, private world: {
    players: readonly Player[];
    entities: ReadonlyMap<string, Entity>;
    ruined: ReadonlySet<PlayerId>;
    board: Grid;
    vision: Pick<PlayerVision, "canSee" | "deposits">;
    movement: Pick<Movement, "canStep" | "readingKey">;
    combat: Pick<Combat, "views">;
    hostile(a: PlayerId, b: PlayerId): boolean;
  }, private factory: ScriptHostFactory, matchSeed: number) {
    const allocated: ScriptHost[] = [];
    try {
      world.players.forEach((player, i) => {
        const seed = (matchSeed * 31 + i * 7919) >>> 0;
        const host = factory(rules().script, seed);
        allocated.push(host);
        this.seats.set(player.id, { host, seed, scripts: new Map() });
      });
      for (const seat of this.seats.values()) {
        for (const [kind, spec] of Object.entries(rules().kinds)) {
          if (!spec.scriptable) continue;
          const code = this.defaultScript(kind);
          seat.host.setScript(kind, code);
          seat.scripts.set(kind, { code, custom: false, errors: [] });
        }
      }
    } catch (error) {
      for (const host of allocated) host.dispose();
      throw error;
    }
  }

  dispose() {
    for (const seat of this.seats.values()) seat.host.dispose();
  }

  /** Installs `code` for `kind` (null: the rules' default); a script that does not compile leaves the current one. */
  setScript(player: Player, kind: string, code: string | null): OrderResult {
    const seat = this.seat(player), current = seat.scripts.get(kind);
    if (!current) return { ok: false, reason: `${kind} is not scriptable` };
    const source = code ?? this.defaultScript(kind);
    const compiled = seat.host.setScript(kind, source);
    if (!compiled.ok) {
      seat.host.setScript(kind, current.code);
      return { ok: false, reason: compiled.error };
    }
    seat.scripts.set(kind, { code: source, custom: code !== null, errors: [] });
    return { ok: true };
  }

  /** Source of the script `player` runs for `kind`. */
  source(player: Player, kind: string): { code: string; custom: boolean } | null {
    const script = this.seat(player).scripts.get(kind);
    return script ? { code: script.code, custom: script.custom } : null;
  }

  /** Each kind's provenance and latest errors, for the player's view. */
  view(player: Player): PlayerView["scripts"] {
    const scripts: PlayerView["scripts"] = {};
    for (const [kind, script] of this.seat(player).scripts) scripts[kind] = { custom: script.custom, errors: [...script.errors] };
    return scripts;
  }

  /** The VM's state once it stopped; undefined while it runs. */
  runtime(player: Player): PlayerStats["scriptRuntime"] | undefined {
    const runtime = this.seat(player).runtime;
    return runtime && { ...runtime };
  }

  /**
   * Runs the scripts of `player`'s `units` and hands each decision to `choose` in unit order, once the
   * unit's error is remembered and its log forwarded (ten per player per tick). Queued events are
   * delivered to this run only; what a decision queues (e.g. a cancelled order) waits for the next.
   */
  decide(player: Player, units: readonly Entity[], emit: (e: GameEvent) => void, choose: (unit: Entity, run: UnitRun) => void) {
    const seat = this.seat(player);
    if (this.rules().reactiveOrders) this.sight(player, units);
    const runs = seat.host.run(this.worldOf(player, units), units.map((e) => e.id));
    let logs = 0;
    for (const e of units) {
      const r = runs[e.id];
      if (this.rules().reactiveOrders) e.scriptEvents = [];
      if (r.error) this.remember(seat, player, e, r.error, emit, r.operationalFailure);
      if (r.log && logs++ < 10) emit({ tick: this.clock.tick, type: "log", owner: player.id, unit: e.id, message: r.log });
      choose(e, r);
    }
  }

  /**
   * Compiles and runs a proposed script against `player`'s current units of `kind` in a separate VM.
   * Returns requested actions, errors and gas; it does not advance the match or modify the player's
   * installed script, memory, PRNG or event cursor.
   */
  test(player: Player, kind: string, code: string) {
    const seat = this.seat(player);
    if (!seat.scripts.has(kind)) return { ok: false as const, error: `${kind} is not scriptable` };
    const units = [...this.world.entities.values()].filter(e => e.owner === player.id && e.kind === kind)
      .map(e => ({ ...e, scriptEvents: [...e.scriptEvents ?? []] }));
    if (this.rules().reactiveOrders) this.sight(player, units);
    return testScript(code, kind, [this.worldOf(player, units)], this.rules().script, seat.seed, this.factory);
  }

  /** Under reactive orders, a scriptable unit hears each hit; hits by one attacker in a tick merge. */
  attacked(e: Entity, attacker: string, damage: number) {
    if (!this.rules().reactiveOrders || !e.spec.scriptable) return;
    const events = e.scriptEvents ??= [];
    const same = events.find(event => event.type === "attacked" && event.tick === this.clock.tick && event.attacker === attacker);
    if (same?.type === "attacked") same.damage += damage;
    else events.push({ type: "attacked", tick: this.clock.tick, damage, attacker });
  }

  /** The unit hears that `order` ended and why. */
  orderEnded(e: Entity, order: UnitOrder, reason: OrderEndReason) {
    (e.scriptEvents ??= []).push({ type: "order_ended", tick: this.clock.tick, order: { ...order }, reason });
  }

  /** What this tick's intent achieved, for the owner's view and for the script's next decision. */
  result(e: Entity, status: ScriptActionResult["status"], effect?: ScriptActionResult["effect"], reason?: string) {
    if (e.actionResult?.tick === this.clock.tick) e.actionResult = { ...e.actionResult, status, ...(effect ? { effect } : {}), ...(reason ? { reason } : {}) };
    // Persistent/manual orders do not replace the previous script's feedback.
    if (e.lastActionResult?.tick !== this.clock.tick) return;
    e.lastActionResult = { tick: this.clock.tick, action: e.lastActionResult.action, status,
      ...(effect ? { effect } : {}), ...(reason ? { reason } : {}) };
  }

  /** The script a kind runs while its player has none of its own. */
  private defaultScript(kind: string): string {
    return this.rules().defaultScripts[kind] ?? HOLD_SCRIPT;
  }

  /** Every player of the match got a seat in the constructor, and Match hands over only its own players. */
  private seat(player: Player): Seat {
    return this.seats.get(player.id)!;
  }

  /** Queues an enemy_seen event for each enemy newly in a unit's sight, nearest first. */
  private sight(player: Player, units: readonly Entity[]) {
    if (!units.length) return;
    // Visibility is shared throughout this player's preparation; each unit
    // still gets its own range filter and distance/reading-order sort.
    const enemies = [...this.world.entities.values()].filter(other => this.world.hostile(other.owner, player.id)
      && this.world.vision.canSee(player.id, other.x, other.y));
    for (const e of units) {
      const seen = enemies.filter(other => this.rules().scriptSight === "player" || dist(e.x, e.y, other.x, other.y) <= e.spec.vision)
        .sort((a, b) => dist(e.x, e.y, a.x, a.y) - dist(e.x, e.y, b.x, b.y) || this.world.movement.readingKey(a.x, a.y, player.side) - this.world.movement.readingKey(b.x, b.y, player.side));
      const before = new Set(e.seenEnemies ?? []);
      for (const enemy of seen) if (!before.has(enemy.id)) (e.scriptEvents ??= []).push({ type: "enemy_seen", tick: this.clock.tick, enemy: enemy.id });
      e.seenEnemies = seen.map(enemy => enemy.id);
    }
  }

  /** Keeps a unit's error for the view and reports it once; a trusted host failure stops the VM for good. */
  private remember(seat: Seat, player: Player, e: Entity, message: string, emit: (e: GameEvent) => void, operationalFailure?: true) {
    const script = seat.scripts.get(e.kind);
    if (!script) return;
    if (script.errors.at(-1) !== message || (operationalFailure && !seat.operationalFailureReported)) {
      script.errors.push(message);
      if (script.errors.length > 3) script.errors.shift();
      if (!operationalFailure || !seat.operationalFailureReported) {
        emit({ tick: this.clock.tick, type: "script_error", owner: player.id, kind: e.kind, unit: e.id, message,
          ...(operationalFailure ? { operationalFailure } : {}) });
        if (operationalFailure) {
          seat.operationalFailureReported = true;
          seat.runtime = { status: "stopped", tick: this.clock.tick, message };
        }
      }
    }
  }

  /** What `player`'s `units` see this tick: themselves in full, everything else within the player's sight. */
  private worldOf(player: Player, units: readonly Entity[]): ScriptWorld {
    const { entities, vision, movement, hostile } = this.world;
    const baseOf = (owner: PlayerId) => {
      const own = [...entities.values()].filter((e) => e.owner === owner && (!hostile(owner, player.id) || vision.canSee(player.id, e.x, e.y)));
      const b = own.find((e) => e.spec.building && e.spec.dropoff)
        ?? own.find((e) => e.spec.building && e.spec.vital) ?? own.find((e) => e.spec.vital);
      return b ? { x: b.x, y: b.y } : null;
    };
    const myBase = baseOf(player.id);
    // The enemy base is the nearest hostile player's (ties: player order).
    let enemyBase: { x: number; y: number } | null = null;
    for (const q of this.world.players) {
      if (!q.alive || !hostile(q.id, player.id)) continue;
      const b = baseOf(q.id);
      if (b && (!enemyBase || (myBase && dist(myBase.x, myBase.y, b.x, b.y) < dist(myBase.x, myBase.y, enemyBase.x, enemyBase.y)))) enemyBase = b;
    }
    const relation = (owner: PlayerId) => (owner === player.id ? 1 : hostile(owner, player.id) ? 0 : 2);
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
          if (!e.spec.moveMs || !inBounds(this.world.board, x, y)) return [dir, false];
          // A movement query must never expose occupancy behind fog, including
          // the two orthogonal tiles used to check a diagonal crossing.
          if (!vision.canSee(player.id, x, y) || (dx && dy && (!vision.canSee(player.id, e.x + dx, e.y) || !vision.canSee(player.id, e.x, e.y + dy)))) return [dir, null];
          return [dir, movement.canStep(e, x, y)];
        })),
        lastAttackedTick: e.lastAttacked?.tick ?? null,
        lastAttacker: e.lastAttacked && this.clock.tick - e.lastAttacked.tick <= this.clock.ticks(this.rules().lastAttackerMs) ? e.lastAttacked.id : null,
        ...(this.rules().reactiveOrders ? {
          order: e.order ? { ...e.order } : null, orderSuspended: !!e.orderSuspended,
          events: (e.scriptEvents ?? []).map(event => {
            if (event.type !== "attacked") return event;
            const attacker = event.attacker ? entities.get(event.attacker) : undefined;
            return { ...event, attacker: attacker && hostile(attacker.owner, player.id) && vision.canSee(player.id, attacker.x, attacker.y) ? attacker.id : null };
          }),
        } : {}),
        ...(e.spec.gathers ? { carrying: e.carrying, carryCapacity: this.rules().gather.carry } : {}),
      };
    }
    return {
      ...(this.rules().reactiveOrders ? { reactiveOrders: true } : {}),
      tick: this.clock.tick,
      side: player.side,
      units: u,
      deposits: [...vision.deposits(player.id)?.values() ?? []].map(d => ({ ...d, tie: movement.readingKey(d.x, d.y, player.side) })),
      projectiles: this.world.combat.views(player.id),
      all: [...entities.values()].filter((e) => !hostile(e.owner, player.id) || vision.canSee(player.id, e.x, e.y)).map((e) => [
        e.id, e.kind, e.owner, relation(e.owner), e.x, e.y, e.hp, e.spec.hp, e.spec.building ? 1 : 0, movement.readingKey(e.x, e.y, player.side),
        { atk: e.spec.atk ?? 0, def: e.spec.def, range: e.spec.range ?? 0, minRange: e.spec.minRange ?? 0, vision: e.spec.vision,
          attackMs: e.spec.attackMs ? this.clock.ms(this.clock.ticks(e.spec.attackMs)) : 0, moveMs: e.spec.moveMs ? this.clock.ms(this.clock.ticks(e.spec.moveMs)) : 0,
          ruin: this.world.ruined.has(e.owner) },
      ]),
      myBase,
      enemyBase,
      sight: this.rules().scriptSight === "player" ? "player" : "unit",
    };
  }
}
