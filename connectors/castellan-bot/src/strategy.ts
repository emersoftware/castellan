/**
 * The strategic layer: posture, expansion, defence, attack, research and scouting.
 * Every choice is made by rules and logged with the option taken and why.
 */
import type { EntityKind, PlayerId } from "@castellan/shared";
import { dist, ring, type DepositCluster, type Pt } from "./geometry";
import { entityValue, type Memory, type World } from "./perception";
import type { BuildTask, DecisionSource, Episode, Expansion, ExpansionDefense, HomeThreatChoice, JournalEntry, Plan, ThreatGroup } from "./types";

export interface StrategyOptions {
  log: (e: Omit<JournalEntry, "t">) => void;
}

/**
 * Local layout of the corner keep: the 5x5 pocket at the corner (castle included),
 * closed by the map edges, eight walls and two doors. The king waits inside; when a
 * real force arrives workers and the army hold inside while archers, towers and the
 * castle shoot over the walls; a tower inside cannot be reached by melee.
 */
const KEEP_CELL: Pt = { x: 1, y: 1 };
const KEEP_DOORS: Pt[] = [{ x: 5, y: 2 }, { x: 2, y: 5 }];
const KEEP_WALLS: Pt[] = [{ x: 5, y: 0 }, { x: 5, y: 1 }, { x: 5, y: 3 }, { x: 5, y: 4 }, { x: 0, y: 5 }, { x: 1, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }];
const KEEP_INTERIOR: Pt[] = [0, 1, 2, 3, 4].flatMap((y) => [0, 1, 2, 3, 4].map((x) => ({ x, y }))).filter((p) => !(p.x === KEEP_CELL.x && p.y === KEEP_CELL.y) && !(p.x === 4 && p.y === 4));
const RALLY: Pt = { x: 6, y: 6 };
const TOWER_1: Pt = { x: 2, y: 3 };
const TOWER_2: Pt = { x: 3, y: 1 };

const TICKS_PER_S = 10;
const s = (n: number) => n * TICKS_PER_S;

export function newPlan(): Plan {
  return {
    posture: "boom", postureSince: 0, postureReason: "start", workersTarget: 8, composition: { knight: 0.65, archer: 0.35 }, armyTarget: 10,
    rally: { x: 6, y: 6 }, safe: { x: 1, y: 1 }, lastRetreatTick: -10_000, expansionsTried: 0, builds: [], research: [],
    keep: { status: "none", cell: KEEP_CELL, doors: KEEP_DOORS, walls: KEEP_WALLS, interior: KEEP_INTERIOR }, truces: {},
  };
}

export class Strategy {
  readonly roles = new Map<string, "g" | "a" | "r" | "s">();
  private initialised = false;
  private nextId = 1;
  private lastHomeThreatTick = -10_000;
  private lastExpansionThreatTick = -10_000;
  private attackHoldUntil = -1;
  private endgameAsked = false;
  private towersPlanned = 0;
  /** Build task ids known to belong to the keep. */
  private keepTasks = new Set<string>();
  private lastReinforceTick = 0;

  constructor(readonly plan: Plan, readonly episodes: Episode[], private opts: StrategyOptions) {}

  update(w: World, mem: Memory): void {
    if (!this.initialised) this.init(w);
    this.trackEvents(w);
    this.updateTargets(w);
    this.updateTruces(w, mem);
    const home = this.homeThreat(w);
    const exp = this.expansionThreat(w);
    this.updatePosture(w, home, exp);
    this.planScout(w);
    this.planBuilds(w);
    this.planExpansion(w);
    this.planResearch(w);
    this.planAttack(w, home);
    this.assignRoles(w);
    this.planEndgame(w);
  }

  // ───────────────────────── setup and bookkeeping ─────────────────────────

  private init(w: World) {
    this.initialised = true;
    const f = w.frame;
    this.plan.rally = f.toMap(RALLY);
    this.plan.safe = f.toMap(KEEP_CELL);
    this.plan.keep = { status: "none", cell: f.toMap(KEEP_CELL), doors: KEEP_DOORS.map((p) => f.toMap(p)), walls: KEEP_WALLS.map((p) => f.toMap(p)), interior: KEEP_INTERIOR.map((p) => f.toMap(p)) };
    this.log(w, "init", { seat: w.seat, rally: this.plan.rally, safe: this.plan.safe, teams: w.teams, enemies: w.enemyPlayers.map((p) => p.id) });
  }

  private log(w: World, type: string, data: Record<string, unknown> = {}) {
    this.opts.log({ tick: w.tick, type, ...data });
  }

  private episode(w: World, kind: Episode["kind"], label: string, source: DecisionSource = "rules"): Episode {
    const e: Episode = { id: `ep${this.nextId++}`, kind, label, source, startedTick: w.tick, status: "active", notes: [] };
    this.episodes.push(e);
    this.log(w, "episode_start", { episode: e.id, kind, label, source });
    return e;
  }

  private close(w: World, id: string | undefined, status: Episode["status"], result: string) {
    const e = this.episodes.find((x) => x.id === id);
    if (!e || e.status !== "active") return;
    e.status = status; e.endedTick = w.tick; e.result = result;
    this.log(w, "episode_end", { episode: e.id, kind: e.kind, label: e.label, status, result, durationS: (w.tick - e.startedTick) / TICKS_PER_S });
  }

  private note(id: string | undefined, text: string) {
    const e = this.episodes.find((x) => x.id === id);
    if (e) e.notes.push(text);
  }

  private task(w: World, kind: BuildTask["kind"], at: Pt, priority: number, label: string, episode?: string): BuildTask | null {
    if (this.plan.builds.some((t) => t.x === at.x && t.y === at.y && t.status !== "failed" && t.status !== "cancelled" && t.status !== "done")) return null;
    const cost = w.rules.kinds[kind]?.cost ?? 0;
    const t: BuildTask = { id: `b${this.nextId++}`, kind, x: at.x, y: at.y, priority, label, status: "pending", attempts: 0, createdTick: w.tick, updatedTick: w.tick, episode, reserve: cost };
    this.plan.builds.push(t);
    this.log(w, "build_planned", { task: t.id, kind, x: at.x, y: at.y, label, priority });
    return t;
  }

  private trackEvents(w: World) {
    for (const ev of w.events) {
      if (ev.type === "death" && ev.owner === w.view.you) {
        if (ev.kind === "castle" && this.plan.expansion?.castleId === ev.id) {
          this.plan.expansion.status = "lost";
          this.plan.expansion.since = w.tick;
          this.close(w, this.plan.expansion.episode, "failed_outcome", `expansion castle destroyed at (${ev.x},${ev.y})` + (ev.by ? ` by ${ev.by}` : ""));
          this.log(w, "expansion_lost", { x: ev.x, y: ev.y, by: ev.by });
        }
        if ((ev.kind === "wall" || ev.kind === "door") && w.homeCastle && dist(ev, w.homeCastle) <= 14) {
          // Rebuild lost fortifications when the area is quiet again.
          this.task(w, ev.kind, { x: ev.x, y: ev.y }, 1, `rebuild ${ev.kind}`);
          if (this.plan.keep.status === "built" && (this.plan.keep.walls.some((p) => p.x === ev.x && p.y === ev.y) || this.plan.keep.doors.some((p) => p.x === ev.x && p.y === ev.y))) this.plan.keep.status = "building";
        }
        if (ev.kind === "tower") this.towersPlanned = Math.max(0, this.towersPlanned - 1);
      }
      if (ev.type === "spawn" && ev.owner === w.view.you && ev.builder && ev.kind === "castle" && this.plan.expansion && ev.x === this.plan.expansion.site.x && ev.y === this.plan.expansion.site.y) {
        this.plan.expansion.status = "built";
        this.plan.expansion.castleId = ev.id;
        this.plan.expansion.since = w.tick;
        this.note(this.plan.expansion.episode, `castle ${ev.id} completed at tick ${ev.tick}`);
        this.log(w, "expansion_built", { castle: ev.id, x: ev.x, y: ev.y, atS: ev.tick / TICKS_PER_S });
        if (this.plan.expansion.fortify) {
          const site = this.pickTowerSite(w, { x: ev.x, y: ev.y });
          if (site) this.task(w, "tower", site, 4, "expansion tower", this.plan.expansion.episode);
        }
      }
      if (ev.type === "eliminated" && this.plan.attack?.owner === ev.owner) {
        this.close(w, this.plan.attack.episode, "completed", `${ev.owner} eliminated`);
        this.plan.attack = undefined;
        this.setPosture(w, "boom", `${ev.owner} eliminated`);
      }
      if (ev.type === "death" && ev.by === w.view.you && w.rules.kinds[ev.kind]?.building && this.plan.attack) this.plan.attack.lastProgressTick = w.tick;
    }
    // Keep status from the actual walls standing.
    if (this.plan.keep.status === "planned" || this.plan.keep.status === "building") {
      const walls = w.byKind.wall ?? [], doors = w.byKind.door ?? [];
      const done = this.plan.keep.walls.every((p) => walls.some((e) => e.x === p.x && e.y === p.y)) && this.plan.keep.doors.every((d) => doors.some((e) => e.x === d.x && e.y === d.y));
      if (done) {
        this.plan.keep.status = "built";
        const ep = this.episodes.find((e) => e.kind === "keep" && e.status === "active");
        this.close(w, ep?.id, "completed", "keep closed; king inside");
        this.log(w, "keep_built", {});
      }
    }
    if (this.plan.expansion?.status === "built" && this.plan.expansion.castleId && !w.mine.some((e) => e.id === this.plan.expansion!.castleId) && !w.events.some((e) => e.type === "death" && e.id === this.plan.expansion!.castleId)) {
      // Lost while we were not looking (no event in this window).
      this.plan.expansion.status = "lost";
      this.plan.expansion.since = w.tick;
      this.close(w, this.plan.expansion.episode, "failed_outcome", "expansion castle gone");
    }
  }

  private updateTargets(w: World) {
    const live = (c: DepositCluster) => c.tiles.filter((t) => (w.deposits.find((d) => d.x === t.x && d.y === t.y)?.amount ?? initialAmount(c)) > 0).length;
    const home = w.clusters.filter((c) => c.kind === "home");
    const homeTiles = home.reduce((n, c) => n + live(c), 0);
    let target = Math.min(9, Math.max(5, homeTiles + 1));
    if (this.plan.expansion?.status === "built") {
      const c = w.clusters.find((x) => x.id === this.plan.expansion!.clusterId);
      target += c ? Math.min(4, live(c) * 2) : 0;
    }
    if (homeTiles === 0 && this.plan.expansion?.status !== "built") target = Math.max(4, Math.min(target, w.workers.length));
    this.plan.workersTarget = Math.min(target, 14);
    // Composition follows what the enemy fields: more archers against knights, more knights against archers.
    const recent = w.sightings.filter((x) => w.tick - x.tick <= s(90));
    const kn = recent.filter((x) => x.kind === "knight").length, rg = recent.filter((x) => x.kind === "archer").length;
    let archerShare = 0.35;
    if (kn + rg >= 3) archerShare = Math.min(0.6, Math.max(0.2, 0.4 - 0.2 * (kn - rg) / (kn + rg)));
    this.plan.composition = { knight: 1 - archerShare, archer: archerShare };
    this.plan.armyTarget = Math.max(6, Math.min(16, w.popCap - this.plan.workersTarget - 1));
  }

  private updateTruces(w: World, mem: Memory) {
    for (const [p, tick] of mem.aggressors) {
      const t = this.plan.truces[p];
      if (t && !t.broken && tick > t.since) {
        t.broken = tick;
        this.log(w, "truce_broken", { by: p });
      }
    }
    if (!this.plan.primaryEnemy || !w.enemyPlayers.some((p) => p.id === this.plan.primaryEnemy)) {
      const recentAggressor = [...mem.aggressors.entries()].filter(([p]) => w.enemyPlayers.some((e) => e.id === p)).sort((a, b) => b[1] - a[1])[0];
      this.plan.primaryEnemy = recentAggressor?.[0] ?? w.enemyPlayers[0]?.id;
    } else {
      const recentAggressor = [...mem.aggressors.entries()].filter(([p, t]) => w.tick - t < s(60) && w.enemyPlayers.some((e) => e.id === p)).sort((a, b) => b[1] - a[1])[0];
      if (recentAggressor) this.plan.primaryEnemy = recentAggressor[0];
    }
  }

  /** Players I should not attack now: active truces before their expiry. */
  inTruce(p: PlayerId, w: World): boolean {
    const t = this.plan.truces[p];
    return !!t && !t.broken && w.timeMs < TRUCE_UNTIL_MS;
  }

  // ───────────────────────── threats and posture ─────────────────────────

  private homeThreat(w: World): ThreatGroup | null {
    const anchors: Pt[] = [...w.castles.filter((c) => c.id !== this.plan.expansion?.castleId), ...(w.king ? [w.king] : [])];
    if (!anchors.length) return null;
    let best: ThreatGroup | null = null;
    for (const t of w.threats) {
      const d = Math.min(...anchors.map((a) => dist(a, t)));
      if (d <= 11 && (!best || t.strength > best.strength)) best = t;
    }
    if (best) this.lastHomeThreatTick = w.tick;
    return best;
  }

  private expansionThreat(w: World): ThreatGroup | null {
    const exp = this.plan.expansion;
    if (!exp || (exp.status !== "built" && exp.status !== "building" && exp.status !== "scouting")) return null;
    let best: ThreatGroup | null = null;
    for (const t of w.threats) if (dist(exp.site, t) <= 9 && (!best || t.strength > best.strength)) best = t;
    if (best) this.lastExpansionThreatTick = w.tick;
    return best;
  }

  private setPosture(w: World, posture: Plan["posture"], reason: string) {
    if (this.plan.posture === posture) return;
    this.log(w, "posture", { from: this.plan.posture, to: posture, reason, strength: Math.round(w.myStrength), enemyKnown: Math.round(w.enemyKnownStrength) });
    this.plan.posture = posture;
    this.plan.postureSince = w.tick;
    this.plan.postureReason = reason;
  }

  private updatePosture(w: World, home: ThreatGroup | null, exp: ThreatGroup | null) {
    const p = this.plan;
    const kingDanger = !!w.king && (w.enemyVisible.some((e) => !w.rules.kinds[e.kind]?.building && e.kind !== "worker" && dist(e, w.king!) <= 6) || (w.view.underAttack ?? []).some((a) => a.id === w.king!.id));
    if (home || kingDanger) {
      if (p.posture === "attack" && p.attack) {
        const guards = w.army.filter((u) => this.roles.get(u.id) === "g").reduce((n, u) => n + entityValue(u), 0);
        const threat = home?.strength ?? 150;
        if (!p.homeThreatChoice || w.tick - p.homeThreatChoice.since > s(40)) this.applyHomeThreatChoice(w, threat >= guards * 1.2 || kingDanger ? "recall" : "continue", "rules");
      } else {
        this.setPosture(w, "defend", home ? `${home.units.length} enemy units (~${Math.round(home.strength)}) of ${home.owner} at (${home.x},${home.y}) near home` : "enemy next to the king");
      }
    } else if (p.posture === "defend") {
      if (w.tick - this.lastHomeThreatTick > s(8) && w.tick - this.lastExpansionThreatTick > s(8)) this.setPosture(w, "boom", "no threat for 8 s");
    } else if (p.posture === "attack") {
      this.checkRetreat(w);
    } else if (p.posture === "retreat") {
      const back = w.army.filter((u) => this.roles.get(u.id) === "r");
      const home = back.filter((u) => dist(u, p.rally) <= 4).length;
      if (!back.length || home >= back.length * 0.7 || w.tick - p.postureSince > s(40)) {
        this.setPosture(w, "boom", "army regrouped");
      }
    }
    if (exp && this.plan.expansion) this.defendExpansion(w, exp);
    else if (this.plan.expansionDefense && w.tick - this.lastExpansionThreatTick > s(10)) {
      this.log(w, "expansion_threat_over", { choice: this.plan.expansionDefense.choice, lostCastle: this.plan.expansion?.status === "lost" });
      this.plan.expansionDefense = undefined;
    }
  }

  private defendExpansion(w: World, threat: ThreatGroup) {
    const p = this.plan;
    const exp = p.expansion!;
    if (p.expansionDefense && w.tick - p.expansionDefense.since < s(45) && p.expansionDefense.threatOwner === threat.owner) return;
    const ratio = w.myStrength / Math.max(1, threat.strength);
    const canCounter = !!this.pickTarget(w, threat.owner);
    const fallback: ExpansionDefense = ratio >= 1.2 && p.posture !== "attack" ? "army" : "evacuate";
    p.expansionDefense = { choice: fallback, since: w.tick, threatOwner: threat.owner };
    this.log(w, "expansion_threat", { units: threat.units.length, strength: Math.round(threat.strength), owner: threat.owner, site: exp.site, status: exp.status, ratio: +ratio.toFixed(2), canCounter });
    this.applyExpansionDefense(w, fallback, "rules");
  }

  private applyExpansionDefense(w: World, choice: ExpansionDefense, source: DecisionSource) {
    const p = this.plan;
    if (!p.expansion) return;
    p.expansionDefense = { choice, since: w.tick, threatOwner: p.expansionDefense?.threatOwner ?? "?" };
    const ep = this.episode(w, "defense", `defend expansion: ${choice}`, source);
    this.log(w, "expansion_defense", { choice, source, episode: ep.id });
    if (choice === "army" && p.posture !== "attack") this.setPosture(w, "defend", "defending the expansion with the army");
    if (choice === "fortify") {
      const site = this.pickTowerSite(w, p.expansion.site);
      if (site) this.task(w, "tower", site, 2, "expansion tower (defence)", ep.id);
    }
    if (choice === "counter") {
      const target = this.pickTarget(w, p.expansionDefense.threatOwner);
      if (target) this.startAttack(w, target, "counter-attack while their army is at my expansion", source);
    }
  }

  private applyHomeThreatChoice(w: World, choice: HomeThreatChoice, source: DecisionSource) {
    const p = this.plan;
    p.homeThreatChoice = { choice, since: w.tick };
    this.log(w, "home_threat_choice", { choice, source });
    if (choice === "recall" && p.attack) {
      this.close(w, p.attack.episode, "abandoned", "recalled to defend home");
      p.attack = undefined;
      this.setPosture(w, "defend", "army recalled: threat at home");
    } else if (choice === "split" && p.attack) {
      const attackers = w.army.filter((u) => p.attack!.units.includes(u.id)).sort((a, b) => dist(a, p.rally) - dist(b, p.rally));
      const half = attackers.slice(0, Math.ceil(attackers.length / 2)).map((u) => u.id);
      p.attack.units = p.attack.units.filter((id) => !half.includes(id));
      this.note(p.attack.episode, `split: ${half.length} units sent home`);
    }
  }

  // ───────────────────────── scouting ─────────────────────────

  private planScout(w: World) {
    const p = this.plan;
    if (p.scout && !p.scout.done) {
      const alive = w.army.some((u) => u.id === p.scout!.unit);
      const known = w.enemyBases.filter((b) => b.known).length;
      if (!alive || w.tick - p.scout.since > s(100) || (known >= Math.min(1, w.enemyPlayers.length) && w.tick - p.scout.since > s(30))) {
        p.scout.done = true;
        this.roles.delete(p.scout.unit);
        const ep = this.episodes.find((e) => e.kind === "scout" && e.status === "active");
        this.close(w, ep?.id, alive ? "completed" : "failed_outcome", alive ? `${known} enemy base(s) known` : "scout lost");
      }
      return;
    }
    if (p.scout || w.timeMs < 55_000 || p.posture !== "boom") return;
    if (w.enemyBases.every((b) => b.known) || (w.rules.map.seats ?? 2) < 4) return;
    const unit = w.army.filter((u) => u.kind === "archer").sort((a, b) => dist(a, p.rally) - dist(b, p.rally))[0] ?? w.army[0];
    if (!unit) return;
    const centre = { x: Math.floor(w.rules.map.width / 2), y: Math.floor(w.rules.map.height / 2) };
    const unknown = w.enemyBases.filter((b) => !b.known).sort((a, b) => dist(a.pos, unit) - dist(b.pos, unit)).slice(0, 2);
    const approach = (c: Pt) => ({ x: Math.round(c.x + (centre.x - c.x) * 0.4), y: Math.round(c.y + (centre.y - c.y) * 0.4) });
    p.scout = { unit: unit.id, waypoints: [centre, ...unknown.map((b) => approach(b.pos))], since: w.tick };
    this.roles.set(unit.id, "s");
    this.episode(w, "scout", `scout with ${unit.kind} ${unit.id}`);
    this.log(w, "scout", { unit: unit.id, waypoints: p.scout.waypoints });
  }

  // ───────────────────────── construction plans ─────────────────────────

  private pickTowerSite(w: World, near: Pt): Pt | null {
    const centre = { x: w.rules.map.width / 2, y: w.rules.map.height / 2 };
    const candidates = ring(near, 2, w.rules.map).filter((t) => dist(t, near) === 2 && w.placeable(t) && !w.deposits.some((d) => d.x === t.x && d.y === t.y));
    // Toward the map centre: the side attacks come from.
    candidates.sort((a, b) => dist(a, centre) - dist(b, centre));
    return candidates[0] ?? null;
  }

  private planBuilds(w: World) {
    const p = this.plan;
    if (!w.homeCastle) return;
    const f = w.frame;
    const fortress = (w.byKind.wall ?? []).length >= 10;
    // First tower: covers the castle front and the north-east mines.
    // The keep: in a lull once the economy and a first army exist. Walls first, doors last.
    // After the first assault has been repelled (or by minute 3 if none came), while it is quiet.
    const lull = p.posture === "boom" && w.tick - this.lastHomeThreatTick > s(12);
    const afterFirstFight = this.lastHomeThreatTick > 0 || w.timeMs >= 180_000;
    if (p.keep.status === "none" && w.timeMs >= 95_000 && lull && afterFirstFight && w.workers.length >= 6 && w.army.length >= 3) {
      const ep = this.episode(w, "keep", "corner keep: 8 walls and 2 doors around king and castle");
      let any = false;
      for (const wall of p.keep.walls) if (w.placeable(wall) && !(w.byKind.wall ?? []).some((e) => e.x === wall.x && e.y === wall.y)) { const t = this.task(w, "wall", wall, 2, "keep wall", ep.id); if (t) { this.keepTasks.add(t.id); any = true; } }
      for (const door of p.keep.doors) if (w.placeable(door) && !(w.byKind.door ?? []).some((e) => e.x === door.x && e.y === door.y)) { const t = this.task(w, "door", door, 2, "keep door", ep.id); if (t) { this.keepTasks.add(t.id); any = true; } }
      p.keep.status = any ? "planned" : "built";
      if (!any) this.close(w, ep.id, "completed", "already closed");
    }
    // A tower inside the keep: melee cannot reach it, and it covers the castle and the doors.
    // A tower at the keep's heart: it outranges archers (urgent when they show up) and covers the doors later.
    const archersSeen = w.sightings.filter((x) => x.kind === "archer").length;
    if (this.towersPlanned === 0 && w.workers.length >= 6 && (p.keep.status === "built" || w.timeMs > 150_000 || archersSeen >= 2)) {
      const inside = f.toMap(TOWER_1);
      const site = w.placeable(inside) ? inside : this.pickTowerSite(w, w.homeCastle);
      if (site && this.task(w, "tower", site, archersSeen >= 2 ? 1 : 3, "keep tower 1")) this.towersPlanned = 1;
    }
    // A second one later, from spare mineral.
    if (this.towersPlanned === 1 && p.keep.status === "built" && w.timeMs >= 200_000 && !fortress) {
      const inside = f.toMap(TOWER_2);
      const site = w.placeable(inside) ? inside : this.pickTowerSite(w, w.homeCastle);
      const tower = site && this.task(w, "tower", site, 6, "keep tower 2");
      if (tower) { tower.surplus = true; this.towersPlanned = 2; }
    }
  }

  // ───────────────────────── expansion ─────────────────────────

  private planExpansion(w: World) {
    const p = this.plan;
    if (p.expansion && !(ended(p.expansion) && w.tick - p.expansion.since > s(60))) return;
    // A castle is 600 mineral and 30 s: only in a stable lull, with an army that can cover it.
    if (p.expansionsTried >= 3 || p.posture !== "boom" || w.tick - this.lastHomeThreatTick < s(45)) return;
    if (w.timeMs < 150_000 || w.timeLeftMs < 150_000 || w.workers.length < 7 || w.army.length < 8) return;
    const homeLeft = w.clusters.filter((c) => c.kind === "home").reduce((n, c) => n + c.tiles.reduce((m, t) => m + (w.deposits.find((d) => d.x === t.x && d.y === t.y)?.amount ?? initialAmount(c)), 0), 0);
    const homeTotal = w.clusters.filter((c) => c.kind === "home").reduce((n, c) => n + c.mineral, 0);
    // Home mines run dry around minute 5 with nine workers: a second base has to be ready before that.
    const need = w.mineral >= 650 || homeLeft < homeTotal * 0.65 || w.timeMs >= 240_000;
    if (!need) return;
    const candidates = this.expansionCandidates(w);
    if (!candidates.length) { p.expansionsTried = 3; return; }
    const best = candidates[0];
    this.log(w, "expansion_candidates", { homeLeft, homeTotal, mineral: w.mineral, candidates: candidates.map((c) => ({ cluster: c.cluster.id, site: c.site, label: c.label, mineralLeft: c.mineralLeft, danger: c.danger })) });
    this.startExpansion(w, best.cluster, "rules");
  }

  private expansionCandidates(w: World) {
    const bases = w.enemyBases.map((b) => b.pos);
    const out = w.clusters.filter((c) => c.kind === "flank").map((c) => {
      const mineralLeft = c.tiles.reduce((n, t) => n + (w.deposits.find((d) => d.x === t.x && d.y === t.y)?.amount ?? initialAmount(c)), 0);
      const danger = w.sightings.filter((x) => w.tick - x.tick <= s(90) && dist(x, c.center) <= 10).length;
      const enemyDist = bases.length ? Math.min(...bases.map((b) => dist(b, c.center))) : 30;
      const site = this.pickCastleSite(w, c);
      const local = w.frame.toLocal(c.center);
      const label = local.x > local.y ? "east" : local.y > local.x ? "south" : "far";
      return { cluster: c, mineralLeft, danger, enemyDist, site, label, score: mineralLeft - danger * 300 + enemyDist * 10 };
    }).filter((c) => c.mineralLeft > 200 && c.site !== null) as { cluster: DepositCluster; mineralLeft: number; danger: number; enemyDist: number; site: Pt; label: string; score: number }[];
    return out.sort((a, b) => b.score - a.score);
  }

  private pickCastleSite(w: World, c: DepositCluster): Pt | null {
    const home = w.homeCastle ?? w.king;
    const tiles = new Set(c.tiles.map(key));
    const cands: Pt[] = [];
    for (const t of c.tiles) for (const r of ring(t, 2, w.rules.map)) if (!tiles.has(key(r)) && !cands.some((q) => q.x === r.x && q.y === r.y)) cands.push(r);
    const ok = cands.filter((q) => (!w.explored(q) || w.placeable(q)) && c.tiles.every((t) => dist(t, q) <= 2) && !w.rules.map.walls.some((wl) => wl.x === q.x && wl.y === q.y));
    ok.sort((a, b) => (c.tiles.reduce((n, t) => n + dist(t, a), 0) + (home ? dist(a, home) * 0.1 : 0)) - (c.tiles.reduce((n, t) => n + dist(t, b), 0) + (home ? dist(b, home) * 0.1 : 0)));
    return ok[0] ?? null;
  }

  /** A castle by flank cluster `c`; its workers follow once it stands. */
  private startExpansion(w: World, c: DepositCluster, source: DecisionSource) {
    const p = this.plan;
    if (p.expansion && !ended(p.expansion)) return;
    const choice = `castle_${c.id}`;
    const site = this.pickCastleSite(w, c);
    if (!site) { this.log(w, "expansion_invalid", { choice, source }); return; }
    p.expansionsTried++;
    const ep = this.episode(w, "expansion", `castle at (${site.x},${site.y})`, source);
    const task = this.task(w, "castle", site, 3, "expansion castle", ep.id);
    p.expansion = { clusterId: c.id, site, status: "scouting", since: w.tick, fortify: true, taskId: task?.id, episode: ep.id, workers: 4 };
    this.log(w, "expansion_start", { choice, source, site, cluster: c.id });
  }


  // ───────────────────────── research ─────────────────────────

  private planResearch(w: World) {
    const p = this.plan;
    if (w.army.length < 4) return;
    const main: EntityKind = p.composition.archer >= 0.5 ? "archer" : "knight";
    const other: EntityKind = main === "archer" ? "knight" : "archer";
    const recent = w.sightings.filter((x) => w.tick - x.tick <= s(90));
    const archerHeavy = recent.filter((x) => x.kind === "archer").length > recent.filter((x) => x.kind === "knight").length * 2 && recent.length >= 3;
    const want = archerHeavy ? ["tower_range", "archer_damage", "archer_cadence", "knight_mobility", "archer_damage", "tower_range"]
      : [`${main}_damage`, `${main}_cadence`, `${other}_damage`, `${main}_mobility`, `${main}_damage`, `${main}_cadence`];
    if (w.towers.length >= 2) want.splice(2, 0, "tower_range");
    const levelOf = (id: string) => w.me.upgrades?.[id] ?? 0;
    const queue: string[] = [];
    const counted: Record<string, number> = {};
    for (const id of want) {
      const spec = w.rules.upgrades[id];
      if (!spec) continue;
      counted[id] = (counted[id] ?? 0) + 1;
      if (levelOf(id) + (w.me.research?.upgrade === id ? 1 : 0) < counted[id] && counted[id] <= spec.levels.length && !queue.includes(id)) queue.push(id);
    }
    p.research = queue;
  }

  // ───────────────────────── attack ─────────────────────────

  pickTarget(w: World, owner?: PlayerId): { pos: Pt; id?: string; owner?: PlayerId } | null {
    const allowed = (o?: PlayerId) => !o || (!this.inTruce(o, w) && w.enemyPlayers.some((p) => p.id === o));
    const from = this.plan.rally;
    const castles = w.enemyBuildings.filter((b) => b.kind === "castle" && allowed(b.owner) && (!owner || b.owner === owner)).sort((a, b) => dist(a, from) - dist(b, from));
    const primary = castles.find((c) => c.owner === this.plan.primaryEnemy);
    const c = primary ?? castles[0];
    if (c) return { pos: { x: c.x, y: c.y }, id: c.id, owner: c.owner };
    const other = w.enemyBuildings.filter((b) => allowed(b.owner) && (!owner || b.owner === owner) && b.kind !== "wall" && b.kind !== "door").sort((a, b) => dist(a, from) - dist(b, from))[0];
    if (other) return { pos: { x: other.x, y: other.y }, id: other.id, owner: other.owner };
    if (owner) return null;
    const corner = w.enemyBases.filter((b) => !b.known).sort((a, b) => dist(a.pos, from) - dist(b.pos, from))[0];
    return corner ? { pos: corner.pos } : null;
  }

  private planAttack(w: World, home: ThreatGroup | null) {
    const p = this.plan;
    if (p.posture !== "boom" || home || w.tick < this.attackHoldUntil) return;
    if (w.tick - p.lastRetreatTick < s(30) || w.timeLeftMs < 45_000) return;
    const late = w.timeLeftMs < 240_000;
    const size = late ? 6 : Math.min(8, p.armyTarget);
    const enemy = Math.max(w.enemyKnownStrength, late ? 200 : 400);
    // A wave just died at my walls and nothing threatens home: their army is thin right now.
    const counter = w.recentKills >= 600 && w.threats.length === 0 && w.army.length >= 8 && w.myStrength >= 700 && w.myStrength >= w.enemyKnownStrength * 1.2;
    if (!counter && (w.army.length < size || w.myStrength < enemy * 1.3)) return;
    // Marching early into an army only partly seen is how attacks die: before minute 3 only a big army goes.
    if (!counter && w.timeMs < 180_000 && w.army.length < 12) return;
    if (!counter && w.enemyKnownStrength === 0 && w.timeMs < 240_000 && w.army.length < 12) return;
    const target = this.pickTarget(w);
    if (!target) return;
    if (counter) {
      this.startAttack(w, target, `counterattack after repelling a wave (~${Math.round(w.recentKills)} destroyed)`, "rules", 1);
      return;
    }
    this.startAttack(w, target, "army ready", "rules");
  }

  private guardCount(w: World): number {
    return Math.max(2, Math.ceil(w.army.length * 0.25));
  }

  private startAttack(w: World, target: { pos: Pt; id?: string; owner?: PlayerId }, reason: string, source: DecisionSource, guardsOverride?: number) {
    const p = this.plan;
    if (p.attack) return;
    const guards = guardsOverride ?? this.guardCount(w);
    const sorted = w.army.filter((u) => this.roles.get(u.id) !== "s").sort((a, b) => dist(b, p.rally) - dist(a, p.rally));
    const attackers = sorted.slice(0, Math.max(0, sorted.length - guards));
    if (!attackers.length) return;
    const ep = this.episode(w, "attack", `attack ${target.owner ?? "enemy corner"} at (${target.pos.x},${target.pos.y}) with ${attackers.length} units`, source);
    p.attack = { target: target.pos, targetId: target.id, owner: target.owner, since: w.tick, startStrength: attackers.reduce((n, u) => n + entityValue(u), 0), units: attackers.map((u) => u.id), episode: ep.id, lastProgressTick: w.tick, staged: false };
    p.homeThreatChoice = undefined;
    this.setPosture(w, "attack", reason);
    this.log(w, "attack_start", { target: target.pos, owner: target.owner, units: attackers.length, strength: Math.round(p.attack.startStrength), source });
  }

  private checkRetreat(w: World) {
    const p = this.plan;
    const a = p.attack;
    if (!a) { this.setPosture(w, "boom", "no attack plan"); return; }
    const attackers = w.army.filter((u) => a.units.includes(u.id));
    const strength = attackers.reduce((n, u) => n + entityValue(u), 0);
    if (!a.staged) {
      const near = attackers.filter((u) => dist(u, p.rally) <= 4).length;
      if (near >= attackers.length * 0.8 || w.tick - a.since > s(25)) { a.staged = true; a.since = w.tick; a.startStrength = strength; this.log(w, "attack_march", { units: attackers.length, strength: Math.round(strength) }); }
      return;
    }
    // Reinforce every 20 s with units that have gathered at home beyond the guard count.
    if (w.tick - this.lastReinforceTick > s(20)) {
      this.lastReinforceTick = w.tick;
      const home = w.army.filter((u) => !a.units.includes(u.id) && this.roles.get(u.id) !== "s");
      const spare = home.length - this.guardCount(w);
      if (spare >= 3) {
        const extra = home.sort((x, y) => dist(y, p.rally) - dist(x, p.rally)).slice(0, spare).map((u) => u.id);
        a.units.push(...extra);
        this.note(a.episode, `reinforced with ${extra.length} units at tick ${w.tick}`);
        this.log(w, "attack_reinforce", { units: extra.length });
      }
    }
    if (!attackers.length) {
      this.close(w, a.episode, "failed_outcome", "attacking force destroyed");
      p.attack = undefined;
      p.lastRetreatTick = w.tick;
      this.setPosture(w, "boom", "attack force lost");
      return;
    }
    const cx = attackers.reduce((n, u) => n + u.x, 0) / attackers.length, cy = attackers.reduce((n, u) => n + u.y, 0) / attackers.length;
    const local = w.threats.filter((t) => dist(t, { x: Math.round(cx), y: Math.round(cy) }) <= 8).reduce((n, t) => n + t.strength, 0);
    const losses = 1 - strength / Math.max(1, a.startStrength);
    let reason: string | null = null;
    if (strength < a.startStrength * 0.5) reason = `lost ${Math.round(losses * 100)}% of the attacking strength`;
    else if (local >= strength * 1.3 && losses > 0.1) reason = `outnumbered at the target (~${Math.round(local)} vs ~${Math.round(strength)})`;
    else if (w.tick - a.since > s(150) && w.tick - a.lastProgressTick > s(90)) reason = "no progress for 90 s";
    if (!reason) return;
    this.close(w, a.episode, losses >= 0.4 ? "failed_outcome" : "abandoned", `retreat: ${reason}`);
    this.log(w, "retreat", { reason, losses: Math.round(losses * 100), units: attackers.length });
    for (const u of attackers) this.roles.set(u.id, "r");
    p.attack = undefined;
    p.lastRetreatTick = w.tick;
    this.setPosture(w, "retreat", reason);
  }

  private planEndgame(w: World) {
    if (this.endgameAsked || w.timeLeftMs > 150_000 || w.timeLeftMs < 60_000 || this.plan.posture === "attack") return;
    this.endgameAsked = true;
    const ratio = w.myStrength / Math.max(1, w.enemyKnownStrength);
    this.applyEndgame(w, ratio >= 1.6 && w.army.length >= 6 ? "all_in" : "hold", "rules");
  }

  private applyEndgame(w: World, choice: "all_in" | "hold", source: DecisionSource) {
    this.log(w, "endgame", { choice, source });
    if (choice === "all_in") {
      const target = this.pickTarget(w);
      if (target) { this.attackHoldUntil = -1; this.startAttack(w, target, "endgame all-in", source); }
    } else this.attackHoldUntil = w.tick + s(600);
  }

  // ───────────────────────── roles ─────────────────────────

  private assignRoles(w: World) {
    const p = this.plan;
    const alive = new Set(w.army.map((u) => u.id));
    for (const id of [...this.roles.keys()]) if (!alive.has(id)) this.roles.delete(id);
    for (const u of w.army) {
      const r = this.roles.get(u.id);
      if (r === "s") continue;
      if (p.posture === "attack" && p.attack?.units.includes(u.id)) this.roles.set(u.id, "a");
      else if (p.posture === "retreat" && r === "r") continue;
      else this.roles.set(u.id, "g");
    }
  }
}

export const TRUCE_UNTIL_MS = 300_000;

const key = (p: Pt): string => `${p.x},${p.y}`;
/** A lost or abandoned expansion can be replaced. */
const ended = (e: Expansion) => e.status === "lost" || e.status === "abandoned";

function initialAmount(c: DepositCluster): number {
  return Math.round(c.mineral / Math.max(1, c.tiles.length));
}
