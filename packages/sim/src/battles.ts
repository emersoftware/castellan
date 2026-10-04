/**
 * Real battles, replayed without the models. A snapshot is a recorded LLM game one second
 * before its first fight: every entity (with health), upgrades, the scripts each player had
 * loaded and the orders in progress. It is placed on an empty copy of its map and fought
 * out by scripts and those orders alone, under any candidate rules.
 */
import { createMatch, type Match } from "@aoa/engine";
import { rules as baseRules, type GameEvent, type Order, type Ruleset } from "@aoa/shared";

export interface Snapshot {
  id: string;
  version: string;
  map: { name: string; width: number; height: number; walls: { x: number; y: number }[]; seats: number };
  players: { id: string; team: number; upgrades: Record<string, number> }[];
  entities: { id: string; kind: string; owner: string; x: number; y: number; hp: number; maxHp: number; order?: string }[];
  scripts: Record<string, Record<string, string>>;
}

/** How a battle is staged: as recorded, without walls and doors, or with jittered positions. */
export interface Variant { open?: boolean; jitter?: number; seed?: number }

export interface BattleResult {
  /** Capital-equivalent value each attacker kind destroyed (last hit), and each kind fielded. */
  destroyedBy: Record<string, number>;
  fielded: Record<string, number>;
  /** Value each player lost, and each kind lost. */
  lost: Record<string, number>;
  lostKind: Record<string, number>;
  /** Value of each kind that took part (attacked or was attacked). */
  engaged: Record<string, number>;
  /** Per team: the value of knights, rangers, turrets and castles it brought into the fight, and the value of
   *  damage each kind dealt to and took from fighting targets (knights, rangers, turrets, castles). */
  sides: Record<string, Side>;
  /** Script errors raised during the fight. */
  errors: number;
  ticks: number;
}

export interface Side { army: number; dealt: Record<string, number>; taken: Record<string, number> }

/** A king counts like an expensive building: losing it ends the game. */
export const KING_VALUE = 600;
/** Damage only counts against these. In army strength a castle counts as one turret: most of its cost is economy. */
const TARGETS = ["knight", "ranger", "turret", "castle"];
const armyValue = (r: Ruleset, kind: string) => (kind === "castle" ? value(r, "turret") : TARGETS.includes(kind) ? value(r, kind) : 0);
const value = (r: Ruleset, kind: string) => (kind === "king" ? KING_VALUE : r.kinds[kind]?.cost ?? 0);

interface Internals {
  spawn(kind: string, owner: string, x: number, y: number): { id: string; hp: number; spec: { hp: number } };
  player(id: string): { upgrades: Record<string, number> };
  effectiveSpec(p: unknown, kind: string): { hp: number };
}

export async function runBattle(s: Snapshot, ruleset: Ruleset = baseRules, variant: Variant = {}, maxTicks = 600): Promise<BattleResult> {
  s = { ...s, map: { ...s.map, walls: s.map.walls ?? [] } };
  const r: Ruleset = { ...ruleset, matchMs: 3_600_000, fourSeatMatchMs: 3_600_000,
    map: { ...ruleset.map, name: s.map.name, description: "", width: s.map.width, height: s.map.height, walls: s.map.walls,
      seats: s.map.seats === 4 ? 4 : 2, start: [], deposits: [], sharedDeposits: [] } };
  const m: Match = await createMatch({ ruleset: r, seed: variant.seed ?? 1, tickRate: 10,
    players: s.players.map((p, i) => ({ id: p.id, name: p.id, side: i, team: p.team })) });
  try {
    const internal = m as unknown as Internals;
    for (const p of s.players) {
      const upgrades = internal.player(p.id).upgrades;
      for (const [id, level] of Object.entries(p.upgrades)) if (r.upgrades[id]) upgrades[id] = Math.min(level, r.upgrades[id].levels.length);
    }
    let rnd = (variant.seed ?? 1) * 2654435761 >>> 0;
    const random = () => ((rnd = (Math.imul(rnd ^ (rnd >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296);
    const taken = new Set(s.map.walls.map((w) => `${w.x},${w.y}`));
    const ids = new Map<string, string>();
    const kindOf = new Map<string, string>();
    const fielded: Record<string, number> = {}, ownerOf = new Map<string, string>(), hp = new Map<string, number>();
    for (const e of s.entities) {
      if (!r.kinds[e.kind]) continue;
      if (variant.open && (e.kind === "wall" || e.kind === "door")) continue;
      let { x, y } = e;
      if (variant.jitter && !r.kinds[e.kind].building) {
        for (let tries = 0; tries < 8; tries++) {
          const nx = Math.max(0, Math.min(s.map.width - 1, e.x + Math.round((random() * 2 - 1) * variant.jitter)));
          const ny = Math.max(0, Math.min(s.map.height - 1, e.y + Math.round((random() * 2 - 1) * variant.jitter)));
          if (!taken.has(`${nx},${ny}`)) { x = nx; y = ny; break; }
        }
      }
      if (taken.has(`${x},${y}`)) continue;
      taken.add(`${x},${y}`);
      const spawned = internal.spawn(e.kind, e.owner, x, y);
      spawned.hp = Math.max(1, Math.round((e.hp / Math.max(1, e.maxHp)) * spawned.spec.hp));
      ids.set(e.id, spawned.id);
      kindOf.set(spawned.id, e.kind);
      fielded[e.kind] = (fielded[e.kind] ?? 0) + value(r, e.kind);
      ownerOf.set(spawned.id, e.owner);
      hp.set(spawned.id, spawned.hp);
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
    m.step([...setup, ...orders]);
    const shotKind = new Map<string, string>(), shotOwner = new Map<string, string>(), lastHit = new Map<string, string>();
    const teamOf = new Map(s.players.map((p) => [p.id, String(p.team)]));
    const sides: Record<string, Side> = {};
    const side = (owner: string) => (sides[teamOf.get(owner) ?? owner] ??= { army: 0, dealt: {}, taken: {} });
    // Credit by damage, worth the target's value per hit point, capped at the health it had left.
    const damage = (fromKind: string | undefined, fromOwner: string | undefined, target: string, dmg: number) => {
      const tk = kindOf.get(target), owner = ownerOf.get(target);
      if (!tk || !owner || !TARGETS.includes(tk) || !dmg) return;
      const left = hp.get(target) ?? r.kinds[tk].hp;
      hp.set(target, left - dmg);
      const v = (Math.max(0, Math.min(dmg, left)) * value(r, tk)) / r.kinds[tk].hp;
      side(owner).taken[tk] = (side(owner).taken[tk] ?? 0) + v;
      if (fromKind && fromOwner && TARGETS.includes(fromKind)) side(fromOwner).dealt[fromKind] = (side(fromOwner).dealt[fromKind] ?? 0) + v;
    };
    const destroyedBy: Record<string, number> = {}, lost: Record<string, number> = {}, lostKind: Record<string, number> = {};
    const engagedIds = new Set<string>();
    let ticks = 0, quiet = 0, errors = 0;
    // Stop at the time limit, at a king's death, or after 5 s without any attack.
    for (; ticks < maxTicks && !m.outcome && quiet < 50; ticks++) {
      quiet++;
      for (const e of m.step([]).events as GameEvent[]) {
        if (e.type === "script_error") errors++;
        else if (e.type === "spawn") { kindOf.set(e.id, e.kind); ownerOf.set(e.id, e.owner); }
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
          const v = value(r, e.kind);
          const k = lastHit.get(e.id) ?? "?";
          destroyedBy[k] = (destroyedBy[k] ?? 0) + v;
          lost[e.owner] = (lost[e.owner] ?? 0) + v;
          lostKind[e.kind] = (lostKind[e.kind] ?? 0) + v;
        }
      }
    }
    const engaged: Record<string, number> = {};
    for (const id of engagedIds) {
      const k = kindOf.get(id), owner = ownerOf.get(id);
      if (k) engaged[k] = (engaged[k] ?? 0) + value(r, k);
      if (k && owner) side(owner).army += armyValue(r, k);
    }
    return { destroyedBy, fielded, lost, lostKind, engaged, sides, errors, ticks };
  } finally { m.dispose(); }
}
