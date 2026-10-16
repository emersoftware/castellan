/**
 * Recorded battles resume an exact replay prefix. Replaying the prefix preserves the VM,
 * unit memory, timers, vision, projectiles, production, and orders. Synthetic fixtures are
 * deliberately new matches. The old view-only recordings cannot reproduce those states.
 */
import { createMatch, type Match, type MatchConfig, type PlayerOrder } from "@aoa/engine";
import { rules as baseRules, currentKind, kindSpec, type GameEvent, type KindSpec, type Order, type ReplayFile, type Ruleset } from "@aoa/shared";
import { candidateForRecordedNames } from "./names";

export interface Snapshot {
  format?: "aoa-battle-v2";
  /** Only deliberately staged fixtures may omit a replay prefix. */
  synthetic?: true;
  id: string;
  version: string;
  map: { name: string; width: number; height: number; walls: { x: number; y: number }[]; seats: number };
  players: { id: string; team: number; upgrades: Record<string, number> }[];
  entities: { id: string; kind: string; owner: string; x: number; y: number; hp: number; maxHp: number; order?: string }[];
  scripts: Record<string, Record<string, string>>;
  continuation?: {
    config: MatchConfig;
    tick: number;
    hash: string;
    orders: (PlayerOrder & { tick: number })[];
    operationalFailures?: { tick: number; player: string; message: string }[];
  };
}

/** Wall-clock emergency decisions cannot be reconstructed by deterministic offline replay. */
export function assertBalanceReplay(replay: Pick<ReplayFile, "id" | "experiment">): void {
  if (replay.experiment?.operationalFailures?.length) {
    throw new Error(`Replay ${replay.id} has operational sandbox failures; wall-clock watchdog outcomes are not reproducible balance samples`);
  }
}

/** The single recorded-prefix factory enforces the same admission rule as extraction. */
export function replayContinuation(replay: Pick<ReplayFile, "id" | "experiment" | "ruleset" | "seed" | "tickRate" | "players" | "orders">,
  tick: number, hash: string): NonNullable<Snapshot["continuation"]> {
  assertBalanceReplay(replay);
  return { config: { ruleset: replay.ruleset, seed: replay.seed, tickRate: replay.tickRate, players: replay.players },
    tick, hash, orders: replay.orders.filter((o) => o.tick < tick) };
}

/** How a battle is staged: as recorded, without walls and doors, or with jittered positions. */
export interface Variant { open?: boolean; jitter?: number; seed?: number }

export interface BattleResult {
  /** Mineral-equivalent value each attacker kind destroyed (last hit), and each kind fielded. */
  destroyedBy: Record<string, number>;
  fielded: Record<string, number>;
  /** Value each player lost, and each kind lost. */
  lost: Record<string, number>;
  lostKind: Record<string, number>;
  /** Value of each kind that took part (attacked or was attacked). */
  engaged: Record<string, number>;
  /** Per team: the value of knights, archers, towers and castles it brought into the fight, and the value of
   *  damage each kind dealt to and took from fighting targets (knights, archers, towers, castles). */
  sides: Record<string, Side>;
  /** Script errors raised during the fight. */
  errors: number;
  /** Rejected setup orders; never silently treat rejected scripts/orders as an evaluated strategy. */
  rejectedOrders: number;
  ticks: number;
}

export interface Side { army: number; dealt: Record<string, number>; taken: Record<string, number> }

/** A king counts like an expensive building: losing it ends the game. */
export const KING_VALUE = 600;
/** Damage only counts against these. In army strength a castle counts as one tower: most of its cost is economy. */
const TARGETS = ["knight", "archer", "tower", "castle"];
const armyValue = (r: Ruleset, kind: string) => (kind === "castle" ? value(r, "tower") : TARGETS.includes(kind) ? value(r, kind) : 0);
const value = (r: Ruleset, kind: string) => (kind === "king" ? KING_VALUE : kindSpec(r, kind)?.cost ?? 0);

interface Internals {
  spawn(kind: string, owner: string, x: number, y: number): { id: string; hp: number; spec: { hp: number } };
  player(id: string): { upgrades: Record<string, number> };
  effectiveSpec(p: unknown, kind: string): { hp: number };
  refreshVision(): void;
}

const historyKinds = new WeakMap<Match, Map<string, string>>();

/** Restore the entire state by executing its history, never by copying a spectator view. */
export async function resumeBattle(s: Snapshot, ruleset?: Ruleset, variant: Variant = {}): Promise<Match> {
  if (s.format !== "aoa-battle-v2" || !s.continuation) throw new Error(`Battle ${s.id} is a lossy legacy snapshot; re-extract it with extract-recent.mts`);
  const c = s.continuation;
  if (c.operationalFailures?.length) throw new Error(`Battle ${s.id} has operational sandbox failures; wall-clock watchdog outcomes are not reproducible balance samples`);
  const m = await createMatch(c.config);
  try {
    const kinds = new Map(m.spectate().entities.map((e) => [e.id, currentKind(e.kind)]));
    const byTick = new Map<number, PlayerOrder[]>();
    for (const o of c.orders) {
      if (o.tick >= c.tick || o.tick < 0) throw new Error(`Battle ${s.id}: order outside replay prefix`);
      const input = byTick.get(o.tick) ?? [];
      input.push(o); byTick.set(o.tick, input);
    }
    while (m.tick < c.tick && !m.outcome) {
      for (const e of m.step(byTick.get(m.tick) ?? []).events) if (e.type === "spawn") kinds.set(e.id, currentKind(e.kind));
    }
    if (m.tick !== c.tick || m.hash() !== c.hash) throw new Error(`Battle ${s.id}: replay prefix does not reproduce at tick ${c.tick}`);
    // The sim owns this adapter to engine internals. Candidate stats change only at the
    // boundary; historical economy, cooldown deadlines and in-flight shots stay historical.
    type E = { id: string; kind: string; owner: string; hp: number; spec: KindSpec; x: number; y: number; path: number[] | null; pathKey: string };
    const internal = m as unknown as { ruleset: Ruleset; ents: Map<string, E>; occ: (string | null)[]; doors: Map<number, string>;
      buildSites: Map<number, string>; staticVersion: number; refreshVision(): void; player(id: string): unknown; effectiveSpec(p: unknown, kind: string): KindSpec };
    if (ruleset) {
      internal.ruleset = { ...m.ruleset, version: ruleset.version, ...candidateForRecordedNames(ruleset, m.ruleset) };
      for (const e of internal.ents.values()) {
        const spec = internal.effectiveSpec(internal.player(e.owner), e.kind);
        e.hp = Math.max(1, Math.round(e.hp / e.spec.hp * spec.hp)); e.spec = spec;
      }
    }
    const width = m.ruleset.map.width, height = m.ruleset.map.height;
    if (variant.open) for (const e of internal.ents.values()) if (e.kind === "wall" || e.kind === "door") {
      const tile = e.y * width + e.x;
      if (internal.occ[tile] === e.id) internal.occ[tile] = null;
      internal.doors.delete(tile); internal.ents.delete(e.id);
    }
    let rnd = (variant.seed ?? 1) * 2654435761 >>> 0;
    const random = () => ((rnd = (Math.imul(rnd ^ (rnd >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296);
    if (variant.jitter) for (const e of internal.ents.values()) if (!e.spec.building) {
      for (let tries = 0; tries < 8; tries++) {
        const x = Math.max(0, Math.min(width - 1, e.x + Math.round((random() * 2 - 1) * variant.jitter)));
        const y = Math.max(0, Math.min(height - 1, e.y + Math.round((random() * 2 - 1) * variant.jitter)));
        const tile = y * width + x;
        if (internal.occ[tile] !== null || internal.doors.has(tile) || internal.buildSites.has(tile)) continue;
        const old = e.y * width + e.x;
        internal.occ[old] = internal.doors.get(old) ?? null;
        internal.occ[tile] = e.id; e.x = x; e.y = y; break;
      }
    }
    if (variant.open || variant.jitter) {
      internal.staticVersion++;
      for (const e of internal.ents.values()) { e.path = null; e.pathKey = ""; }
      internal.refreshVision();
    }
    historyKinds.set(m, kinds);
    return m;
  } catch (error) { m.dispose(); throw error; }
}

export async function runBattle(s: Snapshot, ruleset: Ruleset = baseRules, variant: Variant = {}, maxTicks = 600): Promise<BattleResult> {
  if (!s.synthetic && !s.continuation) throw new Error(`Battle ${s.id} is a lossy legacy snapshot; re-extract it with extract-recent.mts`);
  s = { ...s, map: { ...s.map, walls: s.map.walls ?? [] } };
  const r: Ruleset = { ...ruleset, matchMs: 3_600_000, fourSeatMatchMs: 3_600_000,
    map: { ...ruleset.map, name: s.map.name, description: "", width: s.map.width, height: s.map.height, walls: s.map.walls,
      seats: s.map.seats === 4 ? 4 : 2, start: [], deposits: [], sharedDeposits: [] } };
  const m: Match = s.continuation ? await resumeBattle(s, ruleset, variant) : await createMatch({ ruleset: r, seed: variant.seed ?? 1, tickRate: 10,
    players: s.players.map((p, i) => ({ id: p.id, name: p.id, side: i, team: p.team })) });
  try {
    const internal = m as unknown as Internals;
    for (const p of s.continuation ? [] : s.players) {
      const upgrades = internal.player(p.id).upgrades;
      for (const [id, level] of Object.entries(p.upgrades)) if (r.upgrades[id]) upgrades[id] = Math.min(level, r.upgrades[id].levels.length);
    }
    let rnd = (variant.seed ?? 1) * 2654435761 >>> 0;
    const random = () => ((rnd = (Math.imul(rnd ^ (rnd >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296);
    const taken = new Set(s.map.walls.map((w) => `${w.x},${w.y}`));
    const ids = new Map<string, string>();
    const kindOf = new Map<string, string>();
    const fielded: Record<string, number> = {}, ownerOf = new Map<string, string>(), hp = new Map<string, number>();
    const initialEntities = s.continuation ? m.spectate().entities : s.entities;
    const maxHp = new Map<string, number>();
    for (const e of initialEntities) {
      const kind = currentKind(e.kind);
      if (!kindSpec(r, kind)) continue;
      if (!s.continuation && variant.open && (e.kind === "wall" || e.kind === "door")) continue;
      let { x, y } = e;
      if (!s.continuation && variant.jitter && !kindSpec(r, kind)!.building) {
        for (let tries = 0; tries < 8; tries++) {
          const nx = Math.max(0, Math.min(s.map.width - 1, e.x + Math.round((random() * 2 - 1) * variant.jitter)));
          const ny = Math.max(0, Math.min(s.map.height - 1, e.y + Math.round((random() * 2 - 1) * variant.jitter)));
          if (!taken.has(`${nx},${ny}`)) { x = nx; y = ny; break; }
        }
      }
      if (!s.continuation && taken.has(`${x},${y}`)) continue;
      taken.add(`${x},${y}`);
      const spawned = s.continuation ? { id: e.id, hp: e.hp, spec: { hp: e.maxHp } } : internal.spawn(e.kind, e.owner, x, y);
      if (!s.continuation) spawned.hp = Math.max(1, Math.round((e.hp / Math.max(1, e.maxHp)) * spawned.spec.hp));
      ids.set(e.id, spawned.id);
      kindOf.set(spawned.id, kind);
      fielded[kind] = (fielded[kind] ?? 0) + value(r, kind);
      ownerOf.set(spawned.id, e.owner);
      hp.set(spawned.id, spawned.hp);
      maxHp.set(spawned.id, spawned.spec.hp);
    }
    // The scripts each player had loaded, then the orders that were running.
    const setup = Object.entries(s.scripts).flatMap(([player, kinds]) => Object.entries(kinds)
      .filter(([kind]) => r.kinds[kind]?.scriptable).map(([kind, code]) => ({ player, order: { type: "script" as const, kind, code } })));
    const orders = s.entities.flatMap((e): { player: string; order: Order }[] => {
      const id = ids.get(e.id);
      const attack = e.order?.match(/^attack (e\d+)/), move = e.order?.match(/^→ ?(\d+),(\d+)|^move (\d+),(\d+)/);
      if (id && attack && ids.has(attack[1])) return [{ player: e.owner, order: { type: "attack" as const, unit: id, target: ids.get(attack[1])! } }];
      if (id && move) return [{ player: e.owner, order: { type: "move" as const, unit: id, x: Number(move[1] ?? move[3]), y: Number(move[2] ?? move[4]) } }];
      return [];
    });
    if (!s.continuation) internal.refreshVision();
    const firstInput = s.continuation ? [] : [...setup, ...orders];
    const shotKind = new Map<string, string>(), shotOwner = new Map<string, string>(), lastHit = new Map<string, string>();
    // Shots already in flight at the boundary still belong to their original attacker.
    if (s.continuation) for (const p of (m as unknown as { projectiles: Map<string, { id: string; source: string; owner: string }> }).projectiles.values()) {
      const kind = kindOf.get(p.source) ?? historyKinds.get(m)?.get(p.source); if (kind) shotKind.set(p.id, kind);
      shotOwner.set(p.id, p.owner);
    }
    const teamOf = new Map(s.players.map((p) => [p.id, String(p.team)]));
    const sides: Record<string, Side> = {};
    const side = (owner: string) => (sides[teamOf.get(owner) ?? owner] ??= { army: 0, dealt: {}, taken: {} });
    // Credit by damage, worth the target's value per hit point, capped at the health it had left.
    const damage = (fromKind: string | undefined, fromOwner: string | undefined, target: string, dmg: number) => {
      const tk = kindOf.get(target), owner = ownerOf.get(target);
      if (!tk || !owner || !TARGETS.includes(tk) || !dmg) return;
      const left = hp.get(target) ?? kindSpec(r, tk)!.hp;
      hp.set(target, left - dmg);
      const v = (Math.max(0, Math.min(dmg, left)) * value(r, tk)) / (maxHp.get(target) ?? kindSpec(r, tk)!.hp);
      side(owner).taken[tk] = (side(owner).taken[tk] ?? 0) + v;
      if (fromKind && fromOwner && TARGETS.includes(fromKind)) side(fromOwner).dealt[fromKind] = (side(fromOwner).dealt[fromKind] ?? 0) + v;
    };
    const destroyedBy: Record<string, number> = {}, lost: Record<string, number> = {}, lostKind: Record<string, number> = {};
    const engagedIds = new Set<string>();
    let ticks = 0, quiet = 0, errors = 0, rejectedOrders = 0;
    // Stop at the time limit, at a king's death, or after 5 s without any attack.
    for (; ticks < maxTicks && !m.outcome && quiet < 5 * m.tickRate; ticks++) {
      quiet++;
      const step = m.step(ticks === 0 ? firstInput : []);
      rejectedOrders += step.results.filter((result) => !result.ok).length;
      for (const e of step.events as GameEvent[]) {
        if (e.type === "script_error") errors++;
        else if (e.type === "spawn") {
          kindOf.set(e.id, currentKind(e.kind)); ownerOf.set(e.id, e.owner);
          const spec = internal.effectiveSpec(internal.player(e.owner), e.kind);
          hp.set(e.id, spec.hp); maxHp.set(e.id, spec.hp);
        }
        else if (e.type === "attack") {
          quiet = 0;
          engagedIds.add(e.from); engagedIds.add(e.to);
          const k = kindOf.get(e.from);
          if (k && e.projectile) { shotKind.set(e.projectile, k); shotOwner.set(e.projectile, ownerOf.get(e.from)!); }
          else if (e.dmg) { if (k) lastHit.set(e.to, k); damage(k, ownerOf.get(e.from), e.to, e.dmg); }
        } else if (e.type === "projectile_end" && e.target && e.dmg) {
          const k = shotKind.get(e.id);
          if (k) lastHit.set(e.target, k);
          damage(k, shotOwner.get(e.id), e.target, e.dmg);
        } else if (e.type === "death" && e.by) {
          const kind = currentKind(e.kind), v = value(r, kind);
          const k = lastHit.get(e.id) ?? "?";
          destroyedBy[k] = (destroyedBy[k] ?? 0) + v;
          lost[e.owner] = (lost[e.owner] ?? 0) + v;
          lostKind[kind] = (lostKind[kind] ?? 0) + v;
        }
      }
    }
    const engaged: Record<string, number> = {};
    for (const id of engagedIds) {
      const k = kindOf.get(id), owner = ownerOf.get(id);
      if (k) engaged[k] = (engaged[k] ?? 0) + value(r, k);
      if (k && owner) side(owner).army += armyValue(r, k);
    }
    return { destroyedBy, fielded, lost, lostKind, engaged, sides, errors, rejectedOrders, ticks };
  } finally { m.dispose(); }
}
