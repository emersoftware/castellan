import type { ActionAvailability, GameEvent, KindSpec, OrderResult, PlayerId, EntityKind, Ruleset } from "@castellan/shared";
import type { SimulationClock } from "./clock";
import type { Entity, Player } from "./entities";
import type { Movement } from "./movement";

/**
 * Research and training. Owns the rule that a kind requires research (one answer for an order, a build
 * site or the availability list), what a player's completed research does to its units' stats, what
 * blocks a training or research order, and the queues that deliver units and research when due.
 */
export class Production {
  constructor(private rules: () => Ruleset, private clock: Readonly<SimulationClock>, private world: {
    players: readonly Player[];
    entities: ReadonlyMap<string, Entity>;
    /** Owners whose buildings are inert ruins: nothing is delivered for them. */
    ruined: ReadonlySet<PlayerId>;
  }, private movement: Pick<Movement, "freeNeighbor">,
  private spawn: (kind: EntityKind, owner: PlayerId, x: number, y: number) => Entity) {}

  /** A kind's stats for `player`: the rules' base with each completed research level applied. */
  specFor(player: Player, kind: string): KindSpec {
    const base = this.rules().kinds[kind];
    const spec = { ...base };
    for (const [id, level] of Object.entries(player.upgrades)) {
      const upgrade = this.rules().upgrades[id];
      if (upgrade.kind !== kind || upgrade.stat === "unlock") continue;
      const bought = upgrade.levels[level - 1];
      spec[upgrade.stat] = bought.value;
      if (bought.vision !== undefined) spec.vision = bought.vision;
    }
    return spec;
  }

  /** Why `player` cannot produce `kind`: the research it requires is incomplete. Undefined once it can. */
  lockReason(player: Player, kind: string): string | undefined {
    const required = this.rules().kinds[kind]?.requires;
    return required && !player.upgrades[required] ? `${kind} requires ${required} research` : undefined;
  }

  /** Why `player` cannot pay `cost` now. Undefined when it can. */
  shortfall(player: Player, cost: number): string | undefined {
    return player.mineral < cost ? `needs ${cost} mineral, you have ${player.mineral}` : undefined;
  }

  /** Living units and paid training reservations; the population cap counts both. */
  population(owner: PlayerId): { units: number; queued: number } {
    let units = 0, queued = 0;
    for (const e of this.world.entities.values()) {
      if (e.owner !== owner) continue;
      if (!e.spec.building) units++;
      queued += e.training?.length ?? 0;
    }
    return { units, queued };
  }

  /** What `player` could order now and what blocks each option; `inactive` reasons (eliminated, match over) come first. */
  availableActions(player: Player, inactive: readonly string[]): ActionAvailability {
    const rules = this.rules();
    const mine = [...this.world.entities.values()].filter(e => e.owner === player.id);
    return {
      train: mine.flatMap(b => (b.spec.trains ?? []).map(kind => ({ building: b.id, kind, cost: rules.kinds[kind].cost,
        queue: b.training?.length ?? 0, queueLimit: rules.trainingQueueLimit,
        blockedBy: [...inactive, ...this.trainBlockers(player, b, kind)], exitBlocked: !this.movement.freeNeighbor(b.x, b.y, player.id) }))),
      build: [...new Set(Object.values(rules.kinds).flatMap(k => k.builds ?? []))].map(kind => ({ kind,
        cost: rules.kinds[kind].cost, siteCheckRequired: true,
        blockedBy: [...inactive, ...(!mine.some(e => e.spec.builds?.includes(kind)) ? ["no builder"] : []), ...this.eligibility(player, kind)] })),
      research: Object.entries(rules.upgrades).map(([upgrade, spec]) => ({ upgrade,
        level: (player.upgrades[upgrade] ?? 0) + 1, cost: spec.levels[player.upgrades[upgrade] ?? 0]?.cost ?? null,
        blockedBy: [...inactive, ...this.researchBlockers(player, upgrade)] })),
    };
  }

  /** The research lock and the price, in that order: the first two reasons of every production option. */
  private eligibility(player: Player, kind: string): string[] {
    return [this.lockReason(player, kind), this.shortfall(player, this.rules().kinds[kind].cost)].filter((reason): reason is string => reason !== undefined);
  }

  private trainBlockers(player: Player, building: Entity, kind: string): string[] {
    const rules = this.rules(), spec = rules.kinds[kind], reasons = this.eligibility(player, kind);
    const { units, queued } = this.population(player.id);
    if (units + queued >= rules.popCap) reasons.push(`population cap ${rules.popCap} reached`);
    if (spec.trainMs && (building.training?.length ?? 0) >= rules.trainingQueueLimit) reasons.push("training queue full");
    if (!spec.trainMs && !this.movement.freeNeighbor(building.x, building.y, player.id)) reasons.push(`no free tile around ${building.id}`);
    return reasons;
  }

  private researchBlockers(player: Player, id: string): string[] {
    const upgrade = this.rules().upgrades[id], next = upgrade.levels[player.upgrades[id] ?? 0], reasons: string[] = [];
    if (player.research) reasons.push(`already researching ${player.research.upgrade}`);
    if (!next) reasons.push(`${id} is already at maximum level`);
    const lock = upgrade.stat === "unlock" ? undefined : this.lockReason(player, upgrade.kind);
    if (lock) reasons.push(lock);
    const shortfall = next && this.shortfall(player, next.cost);
    if (shortfall) reasons.push(shortfall);
    return reasons;
  }

  /** Starts researching `id`'s next level, paid now and delivered when its time is up. */
  research(player: Player, id: string, emit: (e: GameEvent) => void): OrderResult {
    const upgrade = this.rules().upgrades[id];
    if (!upgrade || !Object.hasOwn(this.rules().upgrades, id)) return { ok: false, reason: `unknown upgrade ${id}` };
    const blockedBy = this.researchBlockers(player, id);
    if (blockedBy.length) return { ok: false, reason: blockedBy[0] };
    const level = (player.upgrades[id] ?? 0) + 1;
    const next = upgrade.levels[level - 1];
    player.mineral -= next.cost;
    player.research = { upgrade: id, level, completesAtTick: this.clock.tick + this.clock.ticks(next.researchMs) };
    emit({ tick: this.clock.tick, type: "research_started", owner: player.id, upgrade: id, level,
      completesAtMs: this.clock.ms(player.research.completesAtTick), mineral: { spent: next.cost, remaining: player.mineral } });
    return { ok: true };
  }

  /** Trains `ordered` at `buildingId`: queued and paid now if the kind takes time, otherwise placed beside the building at once. */
  train(player: Player, buildingId: string, ordered: string, emit: (e: GameEvent) => void): OrderResult {
    const building = this.world.entities.get(buildingId);
    const spec = this.rules().kinds[ordered];
    if (!building || building.owner !== player.id) return { ok: false, reason: `no building ${buildingId} of yours` };
    const kind = building.spec.trains?.find((k) => k === ordered);
    if (!kind || !spec) return { ok: false, reason: `${building.kind} cannot train ${ordered}` };
    const blockedBy = this.trainBlockers(player, building, kind);
    if (blockedBy.length) return { ok: false, reason: blockedBy[0] };
    if (spec.trainMs) {
      const queue = building.training ??= [];
      if (queue.length >= this.rules().trainingQueueLimit) return { ok: false, reason: "training queue full" };
      player.mineral -= spec.cost;
      queue.push({ kind, ...(queue.length === 0 ? { completesAtTick: this.clock.tick + this.clock.ticks(spec.trainMs) } : {}) });
      emit({ tick: this.clock.tick, type: "training_queued", owner: player.id, building: building.id, kind, position: queue.length });
      return { ok: true };
    }
    const tile = this.movement.freeNeighbor(building.x, building.y, player.id);
    if (!tile) return { ok: false, reason: `no free tile around ${buildingId}` };
    player.mineral -= spec.cost;
    const unit = this.spawn(kind, player.id, tile[0], tile[1]);
    emit({ tick: this.clock.tick, type: "spawn", id: unit.id, kind, owner: player.id, x: unit.x, y: unit.y });
    return { ok: true, id: unit.id };
  }

  /**
   * Delivers what is due this tick. Completed research raises the player's living units of its kind;
   * existing cooldowns are not reset. A trained unit steps out beside its building in `ordered` order,
   * or stays paid and queued until an exit opens, when the next job's timer starts.
   */
  deliver(ordered: readonly Entity[], emit: (e: GameEvent) => void) {
    const T = this.clock.tick;
    for (const p of this.world.players) {
      if (!p.alive || !p.research || T < p.research.completesAtTick) continue;
      const { upgrade, level } = p.research;
      p.upgrades[upgrade] = level;
      p.research = null;
      const kind = this.rules().upgrades[upgrade].kind;
      for (const e of this.world.entities.values()) if (e.owner === p.id && e.kind === kind) e.spec = this.specFor(p, kind);
      emit({ tick: T, type: "upgrade_completed", owner: p.id, upgrade, level });
    }
    for (const b of ordered) {
      if (this.world.ruined.has(b.owner)) continue;
      const job = b.training?.[0];
      if (!job || job.completesAtTick === undefined || T < job.completesAtTick) continue;
      const tile = this.movement.freeNeighbor(b.x, b.y, b.owner);
      if (!tile) continue;
      const unit = this.spawn(job.kind, b.owner, tile[0], tile[1]);
      b.training!.shift();
      const next = b.training![0];
      if (next) next.completesAtTick = T + this.clock.ticks(this.rules().kinds[next.kind].trainMs!);
      emit({ tick: T, type: "spawn", id: unit.id, kind: unit.kind, owner: b.owner, x: unit.x, y: unit.y });
    }
  }
}
