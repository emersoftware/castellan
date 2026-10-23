import type { CombatSummary, GameEvent, LastSeen, PlayerId, EntityKind, Ruleset } from "@castellan/shared";
import { eventOwner } from "@castellan/shared";
import type { Entity, Deposit } from "./entities";
import type { SimulationClock } from "./clock";
import { dist } from "@castellan/shared";

/** An enemy entity as last seen, and the tick it was. */
type Sighting = Extract<LastSeen, { owner: PlayerId }> & { tick: number };

/** Owns current sight and the information each player has learned; hidden movement never updates memory. */
export class PlayerVision {
  private visible = new Map<PlayerId, Set<number>>();
  /** One footprint per living entity; movement or a vision upgrade replaces it. */
  private visionFootprints = new WeakMap<Readonly<Entity>, { x: number; y: number; radius: number; tiles: number[] }>();
  private explored = new Map<PlayerId, Set<number>>();
  private knownDeposits = new Map<PlayerId, Map<string, Deposit>>();
  /** View-only fog memory (not hashed, never shown to scripts): enemy buildings as last seen, and when each deposit was seen. */
  private seenBuildings = new Map<PlayerId, Map<string, Sighting>>();
  private seenUnits = new Map<PlayerId, Map<string, Sighting>>();
  private combatLog = new Map<PlayerId, { tick: number; id: string; kind: EntityKind; owner: PlayerId; x: number; y: number; damage: number; death: boolean }[]>();
  private seenDeposits = new Map<PlayerId, Map<string, number>>();

  constructor(private rules: () => Ruleset, private clock: Readonly<SimulationClock>, private world: {
    players: readonly { id: PlayerId }[];
    entities: ReadonlyMap<string, Readonly<Entity>>;
    deposits: ReadonlyMap<string, Readonly<Deposit>>;
    ruined: ReadonlySet<PlayerId>;
  }, private hostile: (a: PlayerId, b: PlayerId) => boolean) {}

  deposits(player: PlayerId): ReadonlyMap<string, Deposit> | undefined { return this.knownDeposits.get(player); }

  /** Hash only simulation knowledge, in the historical replay serialization order. */
  hashKnowledge(mix: (value: number) => void) {
    for (const p of this.world.players) {
      for (const tile of [...(this.explored.get(p.id) ?? [])].sort((a, b) => a - b)) mix(tile);
      for (const d of this.knownDeposits.get(p.id)?.values() ?? []) { mix(d.x); mix(d.y); mix(d.amount); }
    }
  }

  trimCombat() {
    for (const [player, records] of this.combatLog) this.combatLog.set(player, records.filter(r => r.tick >= this.clock.tick - this.clock.ticks(120_000)));
  }

  /** Remembered enemy buildings and deposits that are outside `player`'s vision now, most recent first. */
  remembered(player: PlayerId): LastSeen[] {
    const out: (LastSeen & { tick: number })[] = [];
    for (const b of this.seenBuildings.get(player)?.values() ?? []) if (!this.canSee(player, b.x, b.y)) out.push({ ...b });
    for (const u of this.seenUnits.get(player)?.values() ?? []) {
      const current = this.world.entities.get(u.id);
      if (!current || !this.canSee(player, current.x, current.y)) out.push({ ...u });
    }
    const known = this.knownDeposits.get(player);
    for (const [id, tick] of this.seenDeposits.get(player) ?? []) {
      const d = known?.get(id);
      if (d && !this.canSee(player, d.x, d.y)) out.push({ id, kind: "deposit", x: d.x, y: d.y, amount: d.amount, seenMs: 0, tick });
    }
    return out.sort((a, b) => b.tick - a.tick).map(({ tick, ...rest }) => ({ ...rest, seenMs: this.clock.ms(tick) }));
  }

  recordCombat(event: GameEvent) {
    const target = event.type === "attack" && !event.projectile && event.to ? this.world.entities.get(event.to)
      : event.type === "projectile_end" && event.reason === "hit" && event.target ? this.world.entities.get(event.target) : undefined;
    const record = event.type === "death" ? { tick: event.tick, id: event.id, kind: event.kind, owner: event.owner,
      x: event.x, y: event.y, damage: 0, death: true }
      : target && "dmg" in event && event.dmg > 0 ? { tick: event.tick, id: target.id, kind: target.kind,
        owner: target.owner, x: target.x, y: target.y, damage: event.dmg, death: false } : null;
    if (!record) return;
    for (const p of this.world.players) {
      if (this.hostile(p.id, record.owner) && !this.canSee(p.id, record.x, record.y)) continue;
      if (record.death) this.seenUnits.get(p.id)?.delete(record.id);
      const records = this.combatLog.get(p.id) ?? [];
      records.push(record); this.combatLog.set(p.id, records);
    }
  }

  combatSummary(player: PlayerId, since: number): CombatSummary {
    const retained = Math.max(0, this.clock.tick - this.clock.ticks(120_000));
    const from = Math.max(retained, since, 0);
    const encounters: CombatSummary["encounters"] = [];
    for (const r of this.combatLog.get(player) ?? []) {
      if (r.tick < from) continue;
      // Six-tile areas and five seconds of separation define reporting groups,
      // not tactical entities or a source of hidden attacker information.
      const x = Math.floor(r.x / 6) * 6, y = Math.floor(r.y / 6) * 6;
      let group = [...encounters].reverse().find(g => g.x === x && g.y === y && r.tick - g.toTick <= this.clock.ticks(5000));
      if (!group) { group = { x, y, fromTick: r.tick, toTick: r.tick, damage: {}, losses: [] }; encounters.push(group); }
      group.toTick = r.tick;
      if (r.damage) group.damage[r.owner] = (group.damage[r.owner] ?? 0) + r.damage;
      if (r.death) group.losses.push({ id: r.id, kind: r.kind, owner: r.owner, x: r.x, y: r.y });
    }
    return { sinceTick: from, throughTick: this.clock.tick, truncated: since < retained, encounters };
  }

  canSee(player: PlayerId, x: number, y: number): boolean {
    return !!this.visible.get(player)?.has(y * this.rules().map.width + x);
  }

  /** Tiles within `e`'s vision, cached until it moves or its vision changes. */
  private visionTiles(e: Readonly<Entity>): number[] {
    const cached = this.visionFootprints.get(e);
    if (cached && cached.x === e.x && cached.y === e.y && cached.radius === e.spec.vision) return cached.tiles;
    const { width, height } = this.rules().map;
    const tiles: number[] = [];
    for (let y = Math.max(0, e.y - e.spec.vision); y <= Math.min(height - 1, e.y + e.spec.vision); y++)
      for (let x = Math.max(0, e.x - e.spec.vision); x <= Math.min(width - 1, e.x + e.spec.vision); x++)
        if (dist(e.x, e.y, x, y) <= e.spec.vision) tiles.push(y * width + x);
    this.visionFootprints.set(e, { x: e.x, y: e.y, radius: e.spec.vision, tiles });
    return tiles;
  }

  refresh() {
    const { width } = this.rules().map;
    for (const p of this.world.players) {
      const visible = new Set<number>();
      const reveal = this.rules().revealAttackerMs ? this.clock.ticks(this.rules().revealAttackerMs) : -1;
      for (const e of this.world.entities.values()) {
        if (this.hostile(p.id, e.owner) || this.world.ruined.has(e.owner)) continue;
        for (const tile of this.visionTiles(e)) visible.add(tile);
        // Whoever recently damaged it is revealed, wherever it stands.
        const by = e.lastAttacked && this.clock.tick - e.lastAttacked.tick <= reveal ? this.world.entities.get(e.lastAttacked.id) : undefined;
        if (by && this.hostile(p.id, by.owner)) visible.add(by.y * width + by.x);
      }
      this.visible.set(p.id, visible);
      const explored = this.explored.get(p.id) ?? new Set<number>();
      for (const tile of visible) explored.add(tile);
      this.explored.set(p.id, explored);
      const known = this.knownDeposits.get(p.id) ?? new Map<string, Deposit>();
      for (const [id, d] of known) if (visible.has(d.y * width + d.x) && !this.world.deposits.has(id)) known.delete(id);
      for (const d of this.world.deposits.values()) if (visible.has(d.y * width + d.x)) known.set(d.id, { ...d });
      this.knownDeposits.set(p.id, known);
      const depositSeen = this.seenDeposits.get(p.id) ?? new Map<string, number>();
      for (const id of depositSeen.keys()) if (!known.has(id)) depositSeen.delete(id);
      for (const d of known.values()) if (visible.has(d.y * width + d.x)) depositSeen.set(d.id, this.clock.tick);
      this.seenDeposits.set(p.id, depositSeen);
      const buildings = this.seenBuildings.get(p.id) ?? new Map<string, Sighting>();
      for (const [id, b] of buildings) if (visible.has(b.y * width + b.x) && !this.world.entities.has(id)) buildings.delete(id);
      for (const e of this.world.entities.values()) if (e.spec.building && this.hostile(p.id, e.owner) && visible.has(e.y * width + e.x)) {
        buildings.set(e.id, { id: e.id, kind: e.kind, owner: e.owner, x: e.x, y: e.y, hp: e.hp, maxHp: e.spec.hp,
          ...(this.world.ruined.has(e.owner) ? { ruin: true } : {}), seenMs: 0, tick: this.clock.tick });
      }
      this.seenBuildings.set(p.id, buildings);
      const units = this.seenUnits.get(p.id) ?? new Map<string, Sighting>();
      // Unit sightings are history, not occupied tiles. Seeing an empty former
      // position marks it cleared without revealing the unit's hidden new one.
      for (const u of units.values()) if (visible.has(u.y * width + u.x)) u.positionCleared = true;
      for (const e of this.world.entities.values()) if (!e.spec.building && this.hostile(p.id, e.owner) && visible.has(e.y * width + e.x)) {
        units.set(e.id, { id: e.id, kind: e.kind, owner: e.owner, x: e.x, y: e.y, hp: e.hp, maxHp: e.spec.hp, entityType: "unit", seenMs: 0, tick: this.clock.tick });
      }
      this.seenUnits.set(p.id, units);
    }
  }

  rows(player: PlayerId): string[] {
    const { width, height } = this.rules().map;
    return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => this.canSee(player, x, y) ? "2" : this.explored.get(player)?.has(y * width + x) ? "1" : "0").join(""));
  }

  canSeeEvent(player: PlayerId, event: GameEvent): boolean {
    if (event.type === "match_end" || event.type === "eliminated" || event.type === "chat") return true;
    const owner = eventOwner(event);
    if (owner !== undefined && !this.hostile(player, owner)) return true;
    if (event.type === "research_started" || event.type === "upgrade_completed" || event.type === "training_queued" || event.type === "unload" || event.type === "log" || event.type === "script_error" || event.type === "order_end") return false;
    if ("x" in event) return this.canSee(player, Math.round(event.x), Math.round(event.y));
    if (event.type === "depleted") { const d = this.knownDeposits.get(player)?.get(event.id); return !!d && this.canSee(player, d.x, d.y); }
    if (event.type === "attack") {
      const attacker = this.world.entities.get(event.from);
      const aim = event.to ? this.world.entities.get(event.to) : event.at && { x: Math.round(event.at.x), y: Math.round(event.at.y) };
      return !!aim && !!attacker && this.canSee(player, aim.x, aim.y) && this.canSee(player, attacker.x, attacker.y);
    }
    return false;
  }

  ascii(player: PlayerId): string[] {
    const { width, height } = this.rules().map;
    const rows = Array.from({ length: height }, () => new Array<string>(width).fill("·"));
    for (const w of this.rules().map.walls ?? []) rows[w.y][w.x] = "^";
    for (const d of this.knownDeposits.get(player)?.values() ?? []) rows[d.y][d.x] = "$";
    const entities = [...this.world.entities.values()];
    if ([...this.world.entities.values()].some(e => e.spec.alliedPassage)) entities.sort((a, b) => Number(!!b.spec.alliedPassage) - Number(!!a.spec.alliedPassage));
    for (const e of entities) {
      if (!this.canSee(player, e.x, e.y)) continue;
      rows[e.y][e.x] = e.owner === player ? e.spec.symbol : this.hostile(e.owner, player) ? e.spec.enemySymbol : e.spec.building ? "=" : "+";
    }
    for (const b of this.seenBuildings.get(player)?.values() ?? []) {
      if (!this.canSee(player, b.x, b.y)) rows[b.y][b.x] = this.rules().kinds[b.kind]?.enemySymbol ?? "?";
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (this.canSee(player, x, y)) continue;
      if (!this.explored.get(player)?.has(y * width + x)) rows[y][x] = "?";
      else if (rows[y][x] === "·") rows[y][x] = ":";
    }
    return rows.map((r) => r.join(""));
  }
}
