import type { GameEvent, PlayerId, ProjectileView, Ruleset } from "@castellan/shared";
import { blindSpotOnPath } from "@castellan/shared";
import type { ScriptActionResult } from "@castellan/sandbox";
import type { Entity, Intent } from "./entities";
import type { SimulationClock } from "./clock";
import { dist } from "@castellan/shared";
import { hypot } from "./grid";
import { segmentCircleHit } from "./projectiles";

interface Projectile extends ProjectileView { attack: number; launchedAt: number; source: string; aimedAt: string; fromX: number; fromY: number; minRange: number }

/** Within attack range, and not inside the attacker's blind spot (`minRange`). */
export function inAttackRange(e: Entity, t: { x: number; y: number }): boolean {
  const d = dist(e.x, e.y, t.x, t.y);
  return d <= (e.spec.range ?? 1) && d >= (e.spec.minRange ?? 0);
}
/** Resolves attacks and in-flight shots; Match applies the accumulated damage simultaneously. */
export class Combat {
  private nextProjectileId = 1;
  private projectiles = new Map<string, Projectile>();

  constructor(private rules: () => Ruleset, private clock: Readonly<SimulationClock>, private entities: ReadonlyMap<string, Entity>,
    private hostile: (a: PlayerId, b: PlayerId) => boolean,
    private canSee: (player: PlayerId, x: number, y: number) => boolean,
    private feedback: {
      result(entity: Entity, status: ScriptActionResult["status"], effect?: ScriptActionResult["effect"], reason?: string): void;
      attacked(entity: Entity, attacker: string, damage: number): void;
    }) {}

  /** Preserve projectile field and insertion order for historical replay hashes. */
  hashProjectiles(mix: (value: number) => void) {
    mix(this.nextProjectileId);
    for (const { fromX, fromY, minRange, ...p } of this.projectiles.values()) for (const c of JSON.stringify(p)) mix(c.charCodeAt(0));
  }

  resolve(ordered: readonly Entity[], intents: ReadonlyMap<string, Intent>, emit: (event: GameEvent) => void) {
    const T = this.clock.tick;
    const damage = new Map<string, number>();
    const lastHit = new Map<string, PlayerId>();
    for (const e of ordered) {
      const it = intents.get(e.id);
      if (it?.t !== "attack" && it?.t !== "shoot") continue;
      const ranged = (e.spec.range ?? 1) > 1;
      if (!e.spec.atk || (it.t === "shoot" && !ranged)) { this.feedback.result(e, "invalid", undefined, it.t === "shoot" ? "unit cannot shoot" : "unit cannot attack"); continue; }
      if (T < e.nextAttack) { this.feedback.result(e, "cooldown", undefined, "attack cooldown"); continue; }
      // Aim: after a step, the attacker must stand still before it strikes.
      if (e.spec.aimMs && e.lastStep && T - e.lastStep.tick < this.clock.ticks(e.spec.aimMs)) { this.feedback.result(e, "aiming"); continue; }
      if (it.t === "shoot") {
        // Like an attack, but toward a visible point in range; the shot hits the first hostile on its path.
        if (!this.canSee(e.owner, Math.round(it.x), Math.round(it.y)) || !inAttackRange(e, it)) { this.feedback.result(e, "blocked", undefined, "point not visible or not in range"); continue; }
        e.nextAttack = T + this.clock.ticks(e.spec.attackMs ?? 1000);
        this.feedback.result(e, "acted", "attack");
        const dx = it.x - e.x, dy = it.y - e.y, distance = hypot(dx, dy) || 1;
        const id = `p${this.nextProjectileId++}`;
        this.projectiles.set(id, { id, owner: e.owner, x: e.x, y: e.y,
          vx: dx / distance * this.rules().projectiles.speed, vy: dy / distance * this.rules().projectiles.speed,
          endX: it.x, endY: it.y, attack: e.spec.atk, launchedAt: T, source: e.id, aimedAt: "", fromX: e.x, fromY: e.y, minRange: e.spec.minRange ?? 0 });
        emit({ tick: T, type: "attack", from: e.id, at: { x: it.x, y: it.y }, dmg: 0, projectile: id });
        continue;
      }
      const target = this.entities.get(it.id);
      if (!target || !this.canSee(e.owner, target.x, target.y) || !this.hostile(target.owner, e.owner) || !inAttackRange(e, target)) { this.feedback.result(e, "blocked", undefined, "target no longer visible or in range"); continue; }
      e.nextAttack = T + this.clock.ticks(e.spec.attackMs ?? 1000);
      this.feedback.result(e, "acted", "attack");
      if ((e.spec.range ?? 1) > 1) {
        const dx = target.x - e.x, dy = target.y - e.y;
        const distance = hypot(dx, dy);
        const id = `p${this.nextProjectileId++}`;
        this.projectiles.set(id, { id, owner: e.owner, x: e.x, y: e.y,
          vx: dx / distance * this.rules().projectiles.speed, vy: dy / distance * this.rules().projectiles.speed,
          endX: target.x, endY: target.y, attack: e.spec.atk, launchedAt: T, source: e.id, aimedAt: target.id, fromX: e.x, fromY: e.y, minRange: e.spec.minRange ?? 0 });
        emit({ tick: T, type: "attack", from: e.id, to: target.id, dmg: 0, projectile: id });
      } else {
        const dmg = Math.max(1, e.spec.atk - target.spec.def);
        damage.set(target.id, (damage.get(target.id) ?? 0) + dmg);
        lastHit.set(target.id, e.owner);
        target.lastAttacked = { id: e.id, tick: T };
        this.feedback.attacked(target, e.id, dmg);
        emit({ tick: T, type: "attack", from: e.id, to: target.id, dmg });
      }
    }

    this.advanceProjectiles(damage, lastHit, emit);
    return { damage, lastHit };
  }

  /** Sweep each segment, so fast shots cannot tunnel through an occupied tile. */
  private advanceProjectiles(damage: Map<string, number>, lastHit: Map<string, PlayerId>, emit: (e: GameEvent) => void) {
    const config = this.rules().projectiles;
    const blindSpot = blindSpotOnPath(this.rules());
    for (const p of this.projectiles.values()) {
      if (p.launchedAt === this.clock.tick) continue;
      const remaining = hypot(p.endX - p.x, p.endY - p.y);
      const step = Math.min(remaining, config.speed / this.clock.rate);
      const nx = p.x + p.vx / config.speed * step, ny = p.y + p.vy / config.speed * step;
      let fraction = Infinity;
      let target: Entity | undefined;
      for (const e of this.entities.values()) {
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
          target.lastAttacked = { id: p.source, tick: this.clock.tick };
          this.feedback.attacked(target, p.source, dmg);
        }
        emit({ tick: this.clock.tick, type: "projectile_end", id: p.id, x: p.x, y: p.y,
          ...(target ? { target: target.id } : {}), dmg, reason: target ? "hit" : "blocked" });
        this.projectiles.delete(p.id);
      } else if (remaining <= step + 1e-9) {
        emit({ tick: this.clock.tick, type: "projectile_end", id: p.id, x: p.endX, y: p.endY, dmg: 0, reason: "miss" });
        this.projectiles.delete(p.id);
      } else { p.x = nx; p.y = ny; }
    }
  }

  views(player?: PlayerId): ProjectileView[] {
    return [...this.projectiles.values()]
      .filter((p) => !player || this.canSee(player, Math.round(p.x), Math.round(p.y)))
      .map(({ attack, launchedAt, source, aimedAt, fromX, fromY, minRange, ...view }) => ({ ...view }));
  }
}
