/**
 * The routine: economy, production, construction, research and unit scripts.
 * It turns the plan into orders every cycle and keeps running whatever the
 * strategic layer is still deciding.
 */
import type { EntityKind, EntityView, Order, OrderResult } from "@aoa/shared";
import { dist, ring, type DepositCluster, type Pt } from "./geometry";
import type { Memory, World } from "./perception";
import { STATIC_SCRIPT, SCRIPT_MAX_BYTES, kingScript, knightScript, archerScript, workerScript, type ArmyParams } from "./scripts";
import type { BuildTask, JournalEntry, Plan } from "./types";

type Role = "g" | "a" | "r" | "s";
const s = (n: number) => n * 10;

export interface ExecutorOptions { log: (e: Omit<JournalEntry, "t">) => void }

export class Executor {
  private installed = new Map<string, string>();
  private installedTick = new Map<string, number>();
  private assignments = new Map<string, string>();
  private lastAssignTick = -1000;
  private unsafeUntil = new Map<string, number>();
  private lastUnsafe = "";
  private evacUntil = -1;
  private lastPosture = "";
  private evacuating = false;
  private turtling = false;
  private trainBlockedUntil = 0;
  private pendingOrders: { order: Order; tick: number }[] = [];
  readonly rejected: Record<string, number> = {};
  rejectedTotal = 0;
  sent = 0;

  constructor(private plan: Plan, private roles: Map<string, Role>, private opts: ExecutorOptions) {}

  private lastThreatTick = -10_000;

  private lastWorld: World | null = null;

  orders(w: World, mem: Memory): Order[] {
    const out: Order[] = [];
    this.lastWorld = w;
    if (w.threats.some((t) => w.homeCastle && dist(t, w.homeCastle) <= 14)) this.lastThreatTick = w.tick;
    out.push(...this.scripts(w));
    out.push(...this.construction(w));
    const research = this.research(w);
    out.push(...research);
    out.push(...this.production(w, research.length ? (w.rules.upgrades[this.plan.research[0]]?.levels[w.me.upgrades?.[this.plan.research[0]] ?? 0]?.cost ?? 0) : 0));
    if (this.postureChanged()) for (const u of w.army) if (u.order && this.roles.get(u.id) !== "s") out.push({ type: "stop", unit: u.id });
    this.lastPosture = this.posture();
    this.pendingOrders = out.map((order) => ({ order, tick: w.tick }));
    this.sent += out.length;
    return out;
  }

  private posture(): string { return `${this.plan.posture}:${this.plan.postureSince}`; }
  /** A new posture since the last orders: the army is re-scripted at once and its current orders dropped. */
  private postureChanged(): boolean { return this.posture() !== this.lastPosture; }

  /** Learn from rejections: adjust tasks and back off where the engine said no. */
  onResults(orders: Order[], results: OrderResult[], tick: number): void {
    results.forEach((r, i) => {
      if (r.ok) return;
      const o = orders[i];
      const reason = r.reason.replace(/\d+/g, "N").slice(0, 60);
      this.rejected[reason] = (this.rejected[reason] ?? 0) + 1;
      this.rejectedTotal++;
      if (o?.type === "train" && /population cap/.test(r.reason)) this.trainBlockedUntil = tick + s(10);
      if (o?.type === "build") {
        const task = this.plan.builds.find((t) => t.x === o.x && t.y === o.y && t.kind === o.kind && t.status !== "done");
        if (!task) return;
        const mine = this.plan.builds.some((t) => t !== task && t.x === o.x && t.y === o.y) || (this.lastWorld?.workers.some((u) => u.construction && u.construction.x === o.x && u.construction.y === o.y) ?? false);
        if (/occupied/.test(r.reason) && mine) { task.status = "pending"; task.worker = undefined; }
        else if (/occupied|outside|cannot build|corner|junction/.test(r.reason)) { task.status = "failed"; task.reason = r.reason; this.opts.log({ tick, type: "build_failed", task: task.id, label: task.label, reason: r.reason, phase: "order" }); }
        else if (/(?:mineral|capital)/.test(r.reason)) { task.status = "pending"; task.worker = undefined; }
        else if (/visible/.test(r.reason)) { /* the worker is still walking there */ }
        else { task.attempts++; task.status = "pending"; task.worker = undefined; task.reason = r.reason; }
      }
      this.opts.log({ tick, type: "order_rejected", order: o, reason: r.reason });
    });
  }

  // ───────────────────────── scripts ─────────────────────────

  private scripts(w: World): Order[] {
    const postureChanged = this.postureChanged();
    const out: Order[] = [];
    const upload = (kind: EntityKind, code: string, urgent = false) => {
      if (!w.rules.kinds[kind]?.scriptable) return;
      if (code.length > SCRIPT_MAX_BYTES) { this.opts.log({ tick: w.tick, type: "script_too_long", kind, bytes: code.length }); return; }
      const last = this.installedTick.get(kind) ?? -1000;
      if (this.installed.get(kind) === code) return;
      if (!urgent && w.tick - last < s(2)) return;
      this.installed.set(kind, code);
      this.installedTick.set(kind, w.tick);
      out.push({ type: "script", kind, code });
    };
    const p = this.plan;
    const exp = p.expansion;
    const defendingExpansion = exp && p.expansionDefense?.choice === "army" && w.tick - p.expansionDefense.since < s(60);
    const evac = this.evacuation(w);
    const evacuating = Object.keys(evac).length > 0;
    const big = w.threats.find((t) => w.homeCastle && dist(t, w.homeCastle) <= 12 && t.strength >= w.myStrength * 0.9);
    const turtle = evacuating && !!big && p.keep.status === "built";
    if (turtle !== this.turtling) { this.turtling = turtle; this.opts.log({ tick: w.tick, type: "turtle", on: turtle, threat: big ? Math.round(big.strength) : 0, strength: Math.round(w.myStrength) }); }
    const guardPost = defendingExpansion ? exp!.site : p.rally;
    const recentSeen = w.sightings.filter((x) => w.tick - x.tick <= s(90));
    const archerHeavy = recentSeen.length >= 3 && recentSeen.filter((x) => x.kind === "archer").length > recentSeen.filter((x) => x.kind === "knight").length * 2;
    const roles: ArmyParams["roles"] = {};
    const posts: ArmyParams["posts"] = {};
    if (turtle) {
      // Everyone holds a tile inside: workers took theirs first, the army gets the rest (doors excluded).
      const taken = new Set(Object.values(evac).map((t) => `${t.x},${t.y}`));
      const free = p.keep.interior.filter((t) => w.placeable(t) && !taken.has(`${t.x},${t.y}`));
      w.army.slice().sort((a, b) => dist(a, p.keep.cell) - dist(b, p.keep.cell)).forEach((u, i) => { roles[u.id] = "h"; posts[u.id] = free[i % Math.max(1, free.length)] ?? p.keep.cell; });
    } else {
      for (const u of w.army) { const r = this.roles.get(u.id); if (r && r !== "g") roles[u.id] = r; }
      // Behind walls (a fortress or the keep), archers post up inside next to a force outside and shoot over them;
      // knights keep the rally point instead of filing out through a door one by one.
      const fortress = (w.byKind.wall ?? []).length >= 16;
      const near = w.threats.find((t) => w.homeCastle && dist(t, w.homeCastle) <= 14);
      if (near && (fortress || p.keep.status === "built") && p.posture !== "attack") {
        const inside = (t: Pt) => { if (p.keep.status === "built" && p.keep.interior.some((k) => k.x === t.x && k.y === t.y)) return true; if (!fortress) return false; const l = w.frame.toLocal(t); return l.x < 13 && l.y < 13; };
        const spots = ring(near, 6, w.rules.map).filter((t) => inside(t) && w.placeable(t)).sort((a, b) => dist(a, near) - dist(b, near));
        const archers = w.army.filter((u) => u.kind === "archer" && (this.roles.get(u.id) ?? "g") === "g");
        archers.forEach((u, i) => { if (spots[i]) { roles[u.id] = "h"; posts[u.id] = spots[i]; } });
      }
    }
    const params: ArmyParams = { role: "g", roles, rally: p.rally, target: p.attack?.staged ? p.attack.target : null, gp: guardPost === p.rally ? null : guardPost, posts,
      leash: defendingExpansion ? 8 : archerHeavy ? 3 : 6, engage: 8, wps: p.scout && !p.scout.done ? p.scout.waypoints : [], kite: true };
    upload("knight", knightScript(params), postureChanged);
    upload("archer", archerScript(params), postureChanged);
    this.assignWorkers(w);
    const assign: Record<string, string> = {};
    for (const [id, d] of this.assignments) if (w.workers.some((u) => u.id === id)) assign[id] = d;
    if (evacuating !== this.evacuating) { this.evacuating = evacuating; this.opts.log({ tick: w.tick, type: "evacuation", workers: Object.keys(evac).length, on: evacuating }); }
    upload("worker", workerScript({ safe: p.safe, assign, evac, fleeRadius: 5, fleeTicks: 15 }));
    const kingSafe = w.homeCastle || !exp?.castleId ? p.safe : this.safeNear(w, w.castles.find((c) => c.id === exp.castleId));
    upload("king", kingScript({ safe: kingSafe }), postureChanged);
    upload("tower", STATIC_SCRIPT);
    upload("castle", STATIC_SCRIPT);
    return out;
  }

  /** With the keep standing and a real force at the castle, workers hide inside it (with hysteresis). */
  private evacuation(w: World): Record<string, Pt> {
    const p = this.plan;
    if (p.keep.status !== "built" || !w.homeCastle) return {};
    const threat = w.threats.find((t) => (t.strength >= 250 || t.units.length >= 3) && dist(t, w.homeCastle!) <= 12);
    if (threat) this.evacUntil = w.tick + s(15);
    if (w.tick >= this.evacUntil) return {};
    const cell = p.keep.cell;
    const pocket = p.keep.interior.filter((t) => w.placeable(t));
    const out: Record<string, Pt> = {};
    const near = w.workers.filter((u) => dist(u, w.homeCastle!) <= 14).sort((a, b) => dist(a, cell) - dist(b, cell));
    near.forEach((u, i) => { out[u.id] = pocket[i % Math.max(1, pocket.length)] ?? cell; });
    return out;
  }

  private safeNear(w: World, castle?: EntityView): Pt {
    if (!castle) return this.plan.safe;
    const home = this.plan.safe;
    return ring(castle, 1, w.rules.map).filter((t) => w.placeable(t)).sort((a, b) => dist(a, home) - dist(b, home))[0] ?? this.plan.safe;
  }

  // ───────────────────────── economy ─────────────────────────

  private assignWorkers(w: World) {
    // Mines with fighters next to them are unsafe for a while; their workers mine elsewhere.
    for (const c of w.clusters) if (w.threats.some((t) => dist(t, c.center) <= 7)) this.unsafeUntil.set(c.id, w.tick + s(20));
    const unsafe = new Set([...this.unsafeUntil].filter(([, until]) => until > w.tick).map(([id]) => id));
    const unsafeKey = [...unsafe].sort().join(",");
    const changed = unsafeKey !== this.lastUnsafe || w.events.some((e) => (e.type === "spawn" && e.owner === w.view.you && e.kind === "worker") || e.type === "depleted" || (e.type === "death" && e.owner === w.view.you));
    if (!changed && w.tick - this.lastAssignTick < s(4)) return;
    if (unsafeKey !== this.lastUnsafe) this.opts.log({ tick: w.tick, type: "mines_unsafe", clusters: [...unsafe] });
    this.lastUnsafe = unsafeKey;
    this.lastAssignTick = w.tick;
    const live = new Map<string, { id: string; x: number; y: number; amount: number; cluster: DepositCluster }>();
    const allLive = new Map<string, { id: string; x: number; y: number; amount: number; cluster: DepositCluster }>();
    for (const d of w.deposits) {
      if (d.amount <= 0) continue;
      const c = w.clusters.find((cl) => cl.tiles.some((t) => t.x === d.x && t.y === d.y));
      if (!c) continue;
      allLive.set(d.id, { ...d, cluster: c });
      if (!unsafe.has(c.id)) live.set(d.id, { ...d, cluster: c });
    }
    // Everything unsafe: mine anyway, as far from the threats as possible.
    if (!live.size) for (const [id, d] of allLive) live.set(id, d);
    const p = this.plan;
    const expansionUnsafe = !!p.expansionDefense && p.expansionDefense.choice !== "army" && w.tick - p.expansionDefense.since < s(45);
    const expCluster = p.expansion && p.expansion.status === "built" && !expansionUnsafe ? p.expansion.clusterId : null;
    const homeIds = new Set(w.clusters.filter((c) => c.kind === "home").map((c) => c.id));
    const builders = new Set(p.builds.filter((t) => t.worker && (t.status === "assigned" || t.status === "started")).map((t) => t.worker!));
    const workers = w.workers.filter((u) => !builders.has(u.id));
    const tilesOf = (cid: string) => [...live.values()].filter((d) => d.cluster.id === cid);
    // Desired workers per cluster: the expansion first, then home by live tiles, then whatever is left elsewhere.
    const desired = new Map<string, number>();
    let left = workers.length;
    if (expCluster && tilesOf(expCluster).length) { const n = Math.min(left, p.expansion!.workers, tilesOf(expCluster).length * 2); desired.set(expCluster, n); left -= n; }
    const homeTiles = [...homeIds].reduce((n, id) => n + tilesOf(id).length, 0);
    for (const id of homeIds) {
      const t = tilesOf(id).length;
      if (!t) continue;
      const n = Math.min(left, Math.ceil(t * 1.5), Math.round(workers.length * t / Math.max(1, homeTiles)) + 1);
      desired.set(id, n); left -= n;
    }
    if (left > 0) {
      // Home is saturated or empty: the nearest clusters with mineral, flanks before the centre (not while fighters roam).
      const home = w.homeCastle ?? w.king ?? { x: 0, y: 0 };
      const others = unsafe.size ? [] : w.clusters.filter((c) => !homeIds.has(c.id) && c.id !== expCluster && tilesOf(c.id).length && (c.kind !== "foreign")).sort((a, b) => dist(a.center, home) - dist(b.center, home));
      for (const c of others) { if (left <= 0) break; const n = Math.min(left, tilesOf(c.id).length * 2); desired.set(c.id, (desired.get(c.id) ?? 0) + n); left -= n; }
      if (left > 0 && homeTiles) for (const id of homeIds) if (tilesOf(id).length) { desired.set(id, (desired.get(id) ?? 0) + left); break; }
    }
    const count = new Map<string, number>();
    const perDeposit = new Map<string, number>();
    const next = new Map<string, string>();
    const keep = (u: EntityView) => {
      const d = this.assignments.get(u.id);
      const info = d ? live.get(d) : undefined;
      if (!info) return false;
      const c = info.cluster.id;
      if ((count.get(c) ?? 0) >= (desired.get(c) ?? 0)) return false;
      count.set(c, (count.get(c) ?? 0) + 1); perDeposit.set(d!, (perDeposit.get(d!) ?? 0) + 1); next.set(u.id, d!);
      return true;
    };
    const rest = workers.filter((u) => !keep(u));
    for (const u of rest) {
      let bestC: string | null = null, bestDef = 0;
      for (const [c, n] of desired) { const def = n - (count.get(c) ?? 0); if (def > bestDef && tilesOf(c).length) { bestDef = def; bestC = c; } }
      const pool = bestC ? tilesOf(bestC) : [...live.values()];
      if (!pool.length) continue;
      pool.sort((a, b) => (perDeposit.get(a.id) ?? 0) - (perDeposit.get(b.id) ?? 0) || dist(a, u) - dist(b, u));
      const d = pool[0];
      next.set(u.id, d.id); perDeposit.set(d.id, (perDeposit.get(d.id) ?? 0) + 1); count.set(d.cluster.id, (count.get(d.cluster.id) ?? 0) + 1);
    }
    const before = JSON.stringify([...this.assignments].sort());
    this.assignments = next;
    if (JSON.stringify([...next].sort()) !== before) this.opts.log({ tick: w.tick, type: "workers_assigned", perCluster: Object.fromEntries([...count].map(([c, n]) => [w.clusters.find((x) => x.id === c)?.kind + ":" + c, n])) });
  }

  /** Mineral available after what active constructions must keep. */
  budget(w: World): number {
    // Keep what active constructions will charge, plus the next planned one so it can start.
    const open = this.plan.builds.filter((t) => !t.surplus && (t.status === "pending" || t.status === "assigned" || t.status === "started")).sort((a, b) => a.priority - b.priority || a.createdTick - b.createdTick);
    const active = open.filter((t) => t.status !== "pending");
    // A planned investment only holds mineral back while it is quiet; under threat the army comes first.
    const quiet = this.plan.posture === "boom" && !w.threats.some((t) => w.homeCastle && dist(t, w.homeCastle) <= 14);
    const next = open[0];
    const reserve = (active.length ? active : next && (quiet || next.priority <= 1) ? [next] : []).reduce((n, t) => n + t.reserve, 0);
    return w.mineral - reserve;
  }

  private production(w: World, spentOnResearch = 0): Order[] {
    const out: Order[] = [];
    if (!w.castles.length || w.tick < this.trainBlockedUntil) return out;
    const p = this.plan;
    let budget = this.budget(w) - spentOnResearch;
    if (w.army.length >= 6 && p.builds.some((t) => t.surplus && t.status === "pending")) budget -= 150;
    // Research is worth a couple of units once the army exists: let mineral build up for it.
    const research = p.research[0] ? w.rules.upgrades[p.research[0]]?.levels[w.me.upgrades?.[p.research[0]] ?? 0] : undefined;
    if (research && !w.me.research && w.army.length >= 8 && w.mineral < research.cost) budget -= 150;
    let pop = w.pop + w.queuedPop;
    const queued = (kind: EntityKind) => w.castles.reduce((n, c) => n + (c.training?.filter((j) => j.kind === kind).length ?? 0), 0);
    const queues = new Map(w.castles.map((c) => [c.id, c.training?.length ?? 0]));
    const castleFor = (kind: EntityKind): EntityView | null => {
      let list = w.castles.filter((c) => (queues.get(c.id) ?? 0) < (w.mineral > 600 ? 3 : 2));
      if (!list.length) return null;
      if (kind === "worker" && p.expansion?.status === "built" && p.expansion.castleId) {
        const exp = list.find((c) => c.id === p.expansion!.castleId);
        const expWorkers = [...this.assignments.values()].filter((d) => w.clusters.find((c) => c.id === p.expansion!.clusterId)?.tiles.some((t) => w.deposits.find((x) => x.id === d && x.x === t.x && x.y === t.y))).length;
        if (exp && expWorkers < p.expansion.workers) return exp;
      }
      list = list.sort((a, b) => (queues.get(a.id) ?? 0) - (queues.get(b.id) ?? 0));
      return list[0];
    };
    const train = (kind: EntityKind) => {
      const cost = w.rules.kinds[kind]?.cost ?? 0;
      if (budget < cost || pop >= w.popCap) return false;
      const c = castleFor(kind);
      if (!c) return false;
      out.push({ type: "train", building: c.id, kind });
      queues.set(c.id, (queues.get(c.id) ?? 0) + 1);
      budget -= cost; pop++;
      return true;
    };
    const workers = w.workers.length + queued("worker");
    const army = w.army.length + queued("knight") + queued("archer");
    const knights = w.army.filter((u) => u.kind === "knight").length + queued("knight");
    const archers = w.army.filter((u) => u.kind === "archer").length + queued("archer");
    // An early archer scouts and kites; after that workers come first until the target, two at a time.
    if (workers >= 5 && army === 0) train("archer");
    // Early on, a few fighters come before the last workers: a rush arrives around the second minute.
    const workerCap = army >= 3 ? p.workersTarget : Math.min(p.workersTarget, 7);
    for (let i = 0; i < 2 && workers + i < workerCap; i++) if (!train("worker")) break;
    if (workers >= Math.min(p.workersTarget, 6) || w.timeMs > 120_000) {
      for (let i = 0; i < 3; i++) {
        const total = knights + archers + i;
        const wantArchers = Math.round((total + 1) * p.composition.archer);
        const kind: EntityKind = archers + (i > 0 ? 0 : 0) < wantArchers ? "archer" : "knight";
        if (army + i >= p.armyTarget + 4) break;
        if (!train(kind)) { if (!train(kind === "archer" ? "knight" : "archer")) break; }
      }
    }
    return out;
  }

  private research(w: World): Order[] {
    const id = this.plan.research[0];
    // Research pays off once there is an army to apply it to, never while a fight is on.
    const quiet = this.plan.posture === "boom" && !w.threats.some((t) => w.homeCastle && dist(t, w.homeCastle) <= 14) && w.tick - this.lastThreatTick > s(30);
    if (!id || w.me.research || w.army.length < 8 || !quiet) return [];
    const spec = w.rules.upgrades[id];
    const level = (w.me.upgrades?.[id] ?? 0);
    const next = spec?.levels[level];
    if (!next) return [];
    if (w.mineral < next.cost || this.budget(w) < next.cost - 150) return [];
    this.opts.log({ tick: w.tick, type: "research", upgrade: id, level: level + 1, cost: next.cost });
    return [{ type: "upgrade", upgrade: id }];
  }

  // ───────────────────────── construction ─────────────────────────

  private construction(w: World): Order[] {
    const out: Order[] = [];
    const p = this.plan;
    const open = p.builds.filter((t) => t.status === "pending" || t.status === "assigned" || t.status === "started").sort((a, b) => a.priority - b.priority || a.createdTick - b.createdTick);
    if (!open.length) return out;
    // A worker already working on a site owns that task, whatever the bookkeeping says.
    for (const u of w.workers) {
      const c = u.construction;
      if (!c) continue;
      const t = p.builds.find((x) => x.x === c.x && x.y === c.y && x.kind === c.kind && x.status !== "done");
      if (t && (t.worker !== u.id || t.status !== "started")) { t.worker = u.id; t.status = "started"; t.updatedTick = w.tick; }
    }
    // Events first: starts, completions and ends reported since the last view.
    for (const ev of w.events) {
      if (ev.type === "construction_started" && ev.owner === w.view.you) {
        const t = p.builds.find((x) => x.x === ev.x && x.y === ev.y && x.kind === ev.kind && x.status !== "done");
        if (t && t.status !== "started") { t.status = "started"; t.worker = ev.builder; t.updatedTick = w.tick; this.opts.log({ tick: w.tick, type: "build_started", task: t.id, label: t.label, worker: ev.builder, completesAtS: ev.completesAtMs / 1000 }); }
      }
      if (ev.type === "spawn" && ev.owner === w.view.you && ev.builder) {
        const t = p.builds.find((x) => x.x === ev.x && x.y === ev.y && x.kind === ev.kind && x.status !== "done");
        if (t) { t.status = "done"; t.updatedTick = w.tick; this.opts.log({ tick: w.tick, type: "build_done", task: t.id, label: t.label, kind: t.kind, x: t.x, y: t.y, atS: ev.tick / 10, charged: ev.mineral?.spent }); }
      }
      if (ev.type === "order_end" && ev.owner === w.view.you) {
        const t = p.builds.find((x) => x.worker === ev.id && (x.status === "assigned" || x.status === "started"));
        if (!t || ev.reason === "arrived") continue;
        if (/unreachable|tile blocked|site reserved|corner|junction|too close/.test(ev.reason)) { t.status = "failed"; t.reason = ev.reason; this.opts.log({ tick: w.tick, type: "build_failed", task: t.id, label: t.label, reason: ev.reason, phase: "work" }); }
        else { t.status = "pending"; t.worker = undefined; if (!/(?:mineral|capital)/.test(ev.reason)) t.attempts++; t.reason = ev.reason; this.opts.log({ tick: w.tick, type: "build_interrupted", task: t.id, label: t.label, reason: ev.reason, attempts: t.attempts }); }
      }
    }
    const busy = new Set<string>();
    let slots = 0;
    // Every active construction is charged on completion: start one only when mineral covers all of them.
    let committed = p.builds.filter((t) => t.status === "assigned" || t.status === "started").reduce((n, t) => n + (w.rules.kinds[t.kind]?.cost ?? 0), 0);
    for (const t of open) {
      if (t.status === "done" || t.status === "failed") continue;
      const concurrent = t.kind === "wall" || t.kind === "door" ? 3 : 1;
      if (slots >= concurrent) break;
      if (t.attempts > 3) { t.status = "failed"; t.reason = `gave up after ${t.attempts} attempts`; this.opts.log({ tick: w.tick, type: "build_failed", task: t.id, label: t.label, reason: t.reason, phase: "retries" }); continue; }
      let worker = t.worker ? w.workers.find((u) => u.id === t.worker) : undefined;
      if (t.worker && !worker) { t.worker = undefined; t.status = "pending"; t.attempts++; this.opts.log({ tick: w.tick, type: "build_interrupted", task: t.id, label: t.label, reason: "builder lost", attempts: t.attempts }); }
      // Threat next to the site or the builder: pause, the worker's script runs away.
      const danger = w.enemyVisible.some((e) => !w.rules.kinds[e.kind]?.building && e.kind !== "worker" && (dist(e, t) <= 5 || (worker && dist(e, worker) <= 4)));
      if (danger) {
        if (worker && t.status !== "pending") { out.push({ type: "stop", unit: worker.id }); this.opts.log({ tick: w.tick, type: "build_interrupted", task: t.id, label: t.label, reason: "threat near the site", attempts: t.attempts }); }
        t.status = "pending"; t.worker = undefined;
        continue;
      }
      if (!worker) {
        const cost = w.rules.kinds[t.kind]?.cost ?? 0;
        if (t.surplus && w.mineral < cost + 100) continue;
        if (w.mineral < committed + cost) { slots++; continue; }
        committed += cost;
        const candidates = w.workers.filter((u) => !busy.has(u.id) && !p.builds.some((o) => o !== t && o.worker === u.id && (o.status === "assigned" || o.status === "started")) && !(u.construction && (u.construction.x !== t.x || u.construction.y !== t.y)));
        worker = candidates.sort((a, b) => (a.carrying ?? 0) - (b.carrying ?? 0) || dist(a, t) - dist(b, t))[0];
        if (!worker) continue;
        t.worker = worker.id; t.status = "assigned"; t.updatedTick = w.tick;
      }
      busy.add(worker.id);
      slots++;
      const wantOrder = `build ${t.kind} ${t.x},${t.y}`;
      if (worker.order === wantOrder) {
        if (t.status === "assigned" && w.tick - t.updatedTick > s(45)) { t.attempts++; t.updatedTick = w.tick; t.worker = undefined; t.status = "pending"; this.opts.log({ tick: w.tick, type: "build_interrupted", task: t.id, label: t.label, reason: "no progress in 45 s", attempts: t.attempts }); }
        continue;
      }
      if (!w.visible(t)) {
        const moveOrder = `move ${t.x},${t.y}`;
        if (worker.order !== moveOrder) out.push({ type: "move", unit: worker.id, x: t.x, y: t.y });
        continue;
      }
      const cost = w.rules.kinds[t.kind]?.cost ?? 0;
      if (w.mineral < cost) continue;
      if (t.orderedTick !== undefined && w.tick - t.orderedTick < s(2)) continue;
      t.orderedTick = w.tick;
      out.push({ type: "build", unit: worker.id, kind: t.kind, x: t.x, y: t.y });
    }
    return out;
  }
}
