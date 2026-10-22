/**
 * Recorded battles resume an exact replay prefix. Replaying the prefix preserves the VM,
 * unit memory, timers, vision, projectiles, production, and orders. Synthetic fixtures are
 * deliberately new matches. The old view-only recordings cannot reproduce those states.
 */
import { createMatch, resimulate, type Match, type MatchConfig, type PlayerOrder } from "@castellan/engine";
import { rules as baseRules, currentKind, kindSpec, type EntityKind, type GameEvent, type Order, type RecordedKind, type ReplayFile, type Ruleset } from "@castellan/shared";
import { candidateForRecordedNames } from "./names";

export interface Snapshot {
  format?: "castellan-battle-v2";
  /** Only deliberately staged fixtures may omit a replay prefix. */
  synthetic?: true;
  id: string;
  version: string;
  map: { name: string; width: number; height: number; walls: { x: number; y: number }[]; seats: number };
  players: { id: string; team: number; upgrades: Record<string, number> }[];
  entities: { id: string; kind: RecordedKind; owner: string; x: number; y: number; hp: number; maxHp: number; order?: string }[];
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

/** Value of the fighters a side lost: damage taken, castles aside (`taken` is keyed by TARGETS kinds). */
export function fighterLoss(side: Side | undefined): number {
  let loss = 0;
  for (const [kind, value] of Object.entries(side?.taken ?? {}) as [EntityKind, number][]) if (kind !== "castle") loss += value;
  return loss;
}

/** A king counts like an expensive building: losing it ends the game. */
const KING_VALUE = 600;
/** Damage only counts against these. In army strength a castle counts as one tower: most of its cost is economy. */
const TARGETS: EntityKind[] = ["knight", "archer", "tower", "castle"];
const armyValue = (r: Ruleset, kind: EntityKind) => (kind === "castle" ? mineralValue(r, "tower") : TARGETS.includes(kind) ? mineralValue(r, kind) : 0);
const mineralValue = (r: Ruleset, kind: EntityKind) => (kind === "king" ? KING_VALUE : kindSpec(r, kind)?.cost ?? 0);

/** What the replayed prefix of a battle left behind: entity kinds and owners, and shots still in flight with their shooter. */
interface BattleHistory { kinds: Map<string, EntityKind>; owners: Map<string, string>; shots: Map<string, string> }
const histories = new WeakMap<Match, BattleHistory>();

/** The variant's deterministic random sequence. */
function seeded(seed: number) {
  let rnd = seed * 2654435761 >>> 0;
  return () => ((rnd = (Math.imul(rnd ^ (rnd >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296);
}

/** The first free one of up to eight random tiles within `jitter` of (x, y), clamped to the map. */
function jittered(x: number, y: number, jitter: number, map: { width: number; height: number }, random: () => number, free: (x: number, y: number) => boolean) {
  for (let tries = 0; tries < 8; tries++) {
    const nx = Math.max(0, Math.min(map.width - 1, x + Math.round((random() * 2 - 1) * jitter)));
    const ny = Math.max(0, Math.min(map.height - 1, y + Math.round((random() * 2 - 1) * jitter)));
    if (free(nx, ny)) return { x: nx, y: ny };
  }
}

/** Restore the entire state by executing its history, never by copying a spectator view. */
export async function resumeBattle(s: Snapshot, ruleset?: Ruleset, variant: Variant = {}): Promise<Match> {
  if (s.format !== "castellan-battle-v2" || !s.continuation) throw new Error(`Battle ${s.id} is a lossy legacy snapshot; re-extract it with extract-recent.mts`);
  const c = s.continuation;
  if (c.operationalFailures?.length) throw new Error(`Battle ${s.id} has operational sandbox failures; wall-clock watchdog outcomes are not reproducible balance samples`);
  if (c.orders.some((o) => o.tick >= c.tick || o.tick < 0)) throw new Error(`Battle ${s.id}: order outside replay prefix`);
  const history: BattleHistory = { kinds: new Map(), owners: new Map(), shots: new Map() };
  const met = (id: string, kind: RecordedKind, owner: string) => { history.kinds.set(id, currentKind(kind)); history.owners.set(id, owner); };
  const { match: m, check } = await resimulate({ config: c.config, orders: c.orders, hashes: { [c.tick]: c.hash }, until: c.tick }, {
    start: (match) => { for (const e of match.spectate().entities) met(e.id, e.kind, e.owner); },
    after: (_match, { events }) => {
      for (const e of events) {
        if (e.type === "spawn") met(e.id, e.kind, e.owner);
        else if (e.type === "attack" && e.projectile) history.shots.set(e.projectile, e.from);
        else if (e.type === "projectile_end") history.shots.delete(e.id);
      }
    },
  });
  try {
    if (!check.verified) throw new Error(`Battle ${s.id}: replay prefix does not reproduce at tick ${c.tick}`);
    // Candidate stats change only at the boundary; historical economy, cooldown deadlines
    // and in-flight shots stay historical.
    const { map } = m.ruleset;
    const random = seeded(variant.seed ?? 1);
    m.stage((stage) => {
      if (ruleset) stage.useRuleset({ ...m.ruleset, version: ruleset.version, ...candidateForRecordedNames(ruleset, m.ruleset) });
      const entities = m.spectate(undefined, { includePerspectives: false }).entities;
      if (variant.open) for (const e of entities) if (e.kind === "wall" || e.kind === "door") stage.remove(e.id);
      if (variant.jitter) for (const e of entities) {
        if (kindSpec(m.ruleset, currentKind(e.kind))?.building || !m.inspect(e.id)) continue;
        const to = jittered(e.x, e.y, variant.jitter, map, random, stage.isFree);
        if (to) stage.relocate(e.id, to.x, to.y);
      }
    });
    histories.set(m, history);
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
    const random = seeded(variant.seed ?? 1);
    const taken = new Set(s.map.walls.map((w) => `${w.x},${w.y}`));
    const ids = new Map<string, string>();
    const kindOf = new Map<string, EntityKind>();
    const fielded: Record<string, number> = {}, ownerOf = new Map<string, string>(), hp = new Map<string, number>();
    const maxHp = new Map<string, number>();
    // A designed battle is staged on an empty map; a recorded one already stands where its replay left it.
    const field = (id: string, e: { id: string; kind: RecordedKind; owner: string }, kind: EntityKind) => {
      const view = m.inspect(id)!;
      ids.set(e.id, id);
      kindOf.set(id, kind);
      fielded[kind] = (fielded[kind] ?? 0) + mineralValue(r, kind);
      ownerOf.set(id, e.owner);
      hp.set(id, view.hp);
      maxHp.set(id, view.maxHp);
    };
    if (s.continuation) {
      for (const e of m.spectate(undefined, { includePerspectives: false }).entities) {
        const kind = currentKind(e.kind);
        if (kindSpec(r, kind)) field(e.id, e, kind);
      }
    } else m.stage((stage) => {
      for (const p of s.players) for (const [id, level] of Object.entries(p.upgrades)) if (r.upgrades[id]) stage.setResearch(p.id, id, Math.min(level, r.upgrades[id].levels.length));
      for (const e of s.entities) {
        const kind = currentKind(e.kind);
        if (!kindSpec(r, kind)) continue;
        if (variant.open && (e.kind === "wall" || e.kind === "door")) continue;
        const { x, y } = variant.jitter && !kindSpec(r, kind)!.building
          ? jittered(e.x, e.y, variant.jitter, s.map, random, (x, y) => !taken.has(`${x},${y}`)) ?? e : e;
        if (taken.has(`${x},${y}`)) continue;
        taken.add(`${x},${y}`);
        field(stage.spawn(e.kind, e.owner, x, y, e.hp / Math.max(1, e.maxHp)), e, kind);
      }
    });
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
    const firstInput = s.continuation ? [] : [...setup, ...orders];
    const shotKind = new Map<string, EntityKind>(), shotOwner = new Map<string, string>(), lastHit = new Map<string, EntityKind>();
    // Shots already in flight at the boundary still belong to their original attacker.
    const history = histories.get(m);
    if (history) for (const [shot, source] of history.shots) {
      const kind = kindOf.get(source) ?? history.kinds.get(source); if (kind) shotKind.set(shot, kind);
      const owner = history.owners.get(source); if (owner) shotOwner.set(shot, owner);
    }
    const teamOf = new Map(s.players.map((p) => [p.id, String(p.team)]));
    const sides: Record<string, Side> = {};
    const side = (owner: string) => (sides[teamOf.get(owner) ?? owner] ??= { army: 0, dealt: {}, taken: {} });
    // Credit by damage, worth the target's value per hit point, capped at the health it had left.
    const damage = (fromKind: EntityKind | undefined, fromOwner: string | undefined, target: string, dmg: number) => {
      const tk = kindOf.get(target), owner = ownerOf.get(target);
      if (!tk || !owner || !TARGETS.includes(tk) || !dmg) return;
      const left = hp.get(target) ?? kindSpec(r, tk)!.hp;
      hp.set(target, left - dmg);
      const v = (Math.max(0, Math.min(dmg, left)) * mineralValue(r, tk)) / (maxHp.get(target) ?? kindSpec(r, tk)!.hp);
      side(owner).taken[tk] = (side(owner).taken[tk] ?? 0) + v;
      if (fromKind && fromOwner && TARGETS.includes(fromKind)) side(fromOwner).dealt[fromKind] = (side(fromOwner).dealt[fromKind] ?? 0) + v;
    };
    const destroyedBy: Record<string, number> = {}, lost: Record<string, number> = {}, lostKind: Record<string, number> = {};
    const engagedIds = new Set<string>();
    let ticks = 0, quiet = 0, errors = 0, rejectedOrders = 0;
    // What one event adds: new units, shots in flight, damage credit and losses.
    const account = (e: GameEvent) => {
      if (e.type === "script_error") errors++;
      else if (e.type === "spawn") {
        kindOf.set(e.id, currentKind(e.kind)); ownerOf.set(e.id, e.owner);
        // Full health, even if the unit already fell in the tick it appeared.
        const full = m.inspect(e.id)?.maxHp ?? kindSpec(r, currentKind(e.kind))!.hp;
        hp.set(e.id, full); maxHp.set(e.id, full);
      }
      else if (e.type === "attack") {
        quiet = 0;
        engagedIds.add(e.from); if (e.to) engagedIds.add(e.to);
        const k = kindOf.get(e.from);
        if (k && e.projectile) { shotKind.set(e.projectile, k); shotOwner.set(e.projectile, ownerOf.get(e.from)!); }
        else if (e.dmg && e.to) { if (k) lastHit.set(e.to, k); damage(k, ownerOf.get(e.from), e.to, e.dmg); }
      } else if (e.type === "projectile_end" && e.target && e.dmg) {
        engagedIds.add(e.target);
        const k = shotKind.get(e.id);
        if (k) lastHit.set(e.target, k);
        damage(k, shotOwner.get(e.id), e.target, e.dmg);
      } else if (e.type === "death" && e.by) {
        const kind = currentKind(e.kind), v = mineralValue(r, kind);
        const k = lastHit.get(e.id) ?? "?";
        destroyedBy[k] = (destroyedBy[k] ?? 0) + v;
        lost[e.owner] = (lost[e.owner] ?? 0) + v;
        lostKind[kind] = (lostKind[kind] ?? 0) + v;
      }
    };
    // Stop at the time limit, at a king's death, or after 5 s without any attack.
    for (; ticks < maxTicks && !m.outcome && quiet < 5 * m.tickRate; ticks++) {
      quiet++;
      const step = m.step(ticks === 0 ? firstInput : []);
      rejectedOrders += step.results.filter((result) => !result.ok).length;
      step.events.forEach(account);
    }
    const engaged: Record<string, number> = {};
    for (const id of engagedIds) {
      const k = kindOf.get(id), owner = ownerOf.get(id);
      if (k) engaged[k] = (engaged[k] ?? 0) + mineralValue(r, k);
      if (k && owner) side(owner).army += armyValue(r, k);
    }
    return { destroyedBy, fielded, lost, lostKind, engaged, sides, errors, rejectedOrders, ticks };
  } finally { m.dispose(); }
}
