/**
 * The world model: everything the player knows, built only from its own view
 * (PlayerView) and the public rules, plus memory of what it saw before.
 */
import type { EntityView, GameEvent, PlayerId, PlayerStats, PlayerView, EntityKind, Ruleset } from "@castellan/shared";
import { ObservedClock } from "./clock";
import { Frame, dist, groupNearby, type DepositCluster, type Pt } from "./geometry";
import type { Sighting, ThreatGroup } from "./types";

/** Mineral-equivalent danger of a kind when it is on the move. */
const THREAT_VALUE: Record<string, number> = { knight: 100, archer: 100, worker: 10, king: 20 };
const ARMY_KINDS: EntityKind[] = ["knight", "archer"];
const MOBILE_THREAT_KINDS: EntityKind[] = ["knight", "archer", "king", "worker"];

interface KnownDeposit { id: string; x: number; y: number; amount: number; seenTick: number; visible: boolean }

export interface Memory {
  /** Tick length learned from the views. */
  clock: ObservedClock;
  /** Null until a castle or the king shows where my corner is. */
  frame: Frame | null;
  clusters: DepositCluster[];
  sightings: Map<string, Sighting>;
  enemyBuildings: Map<string, Sighting>;
  deposits: Map<string, KnownDeposit>;
  /** Players that damaged me, with the tick of the last hit. */
  aggressors: Map<PlayerId, number>;
  firstTick: number | null;
  lastViewTick: number;
  /** Mineral delivered per worker id, from unload events. */
  delivered: Map<string, number>;
  /** Tick when each of my units was last seen in a view (to notice losses even without events). */
  seenMine: Map<string, { kind: string; tick: number }>;
  /** Enemy value destroyed by me, per tick, for counterattack windows. */
  kills: { tick: number; value: number }[];
}

export function newMemory(): Memory {
  return { clock: new ObservedClock(), frame: null, clusters: [], sightings: new Map(), enemyBuildings: new Map(), deposits: new Map(), aggressors: new Map(),
    firstTick: null, lastViewTick: -1, delivered: new Map(), seenMine: new Map(), kills: [] };
}

export interface World {
  view: PlayerView;
  rules: Ruleset;
  /** Converts game seconds to ticks at this room's tick rate. */
  clock: ObservedClock;
  tick: number;
  timeMs: number;
  timeLeftMs: number;
  me: PlayerStats;
  mineral: number;
  pop: number;
  popCap: number;
  queuedPop: number;
  frame: Frame;
  seat: number;
  clusters: DepositCluster[];
  mine: EntityView[];
  byKind: Record<string, EntityView[]>;
  castles: EntityView[];
  workers: EntityView[];
  army: EntityView[];
  king?: EntityView;
  towers: EntityView[];
  allies: EntityView[];
  allyPlayers: PlayerStats[];
  enemyPlayers: PlayerStats[];
  teams: boolean;
  enemyVisible: EntityView[];
  enemyBuildings: Sighting[];
  sightings: Sighting[];
  threats: ThreatGroup[];
  myStrength: number;
  /** Strength of enemy fighters seen in the last 45 s, by owner. */
  enemyStrength: Record<PlayerId, number>;
  enemyKnownStrength: number;
  deposits: KnownDeposit[];
  events: GameEvent[];
  visible: (p: Pt) => boolean;
  explored: (p: Pt) => boolean;
  /** Static-free: a building could go there as far as the map shows (units may stand there). */
  placeable: (p: Pt) => boolean;
  homeCastle?: EntityView;
  /** Enemy bases: known castles, else the unexplored seat corners. */
  enemyBases: { pos: Pt; owner?: PlayerId; known: boolean }[];
  underAttackDamage: number;
  /** Mineral value of enemy units I destroyed in the last 60 s. */
  recentKills: number;
}

/** THREAT_VALUE scaled by health: half at 0 hp, full at max. */
export const entityValue = (e: { kind: string; hp: number; maxHp: number }) => (THREAT_VALUE[e.kind] ?? 0) * (0.5 + 0.5 * e.hp / Math.max(1, e.maxHp));

export function perceive(view: PlayerView, rules: Ruleset, mem: Memory): World {
  const tick = view.tick;
  mem.clock.observe(view);
  const ticks = (seconds: number) => mem.clock.ticks(seconds);
  if (mem.firstTick === null) mem.firstTick = tick;
  const me = view.players.find((p) => p.id === view.you)!;
  const mine = view.mine;
  const byKind: Record<string, EntityView[]> = {};
  for (const e of mine) (byKind[e.kind] ??= []).push(e);
  const castles = byKind.castle ?? [];
  const homeCastle = castles.slice().sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))[0];
  if (mem.frame === null) {
    // The king starts next to the castle; use the castle when it stands, else the king's corner.
    const anchor = homeCastle ?? byKind.king?.[0];
    if (anchor) {
      mem.frame = new Frame(rules.map, anchor);
      mem.clusters = mem.frame.clusters();
    }
  }
  const frame = mem.frame ?? new Frame(rules.map);
  const seat = frame.seat;
  const myTeam = me.team;
  const teams = view.players.some((p) => p.id !== me.id && p.team === myTeam);
  const allyPlayers = view.players.filter((p) => p.id !== me.id && p.team === myTeam);
  const enemyPlayers = view.players.filter((p) => p.team !== myTeam && p.alive);

  // Sightings: visible enemies now; keep old ones until they are seen gone or expire.
  for (const e of view.enemy) {
    const s: Sighting = { id: e.id, kind: e.kind, owner: e.owner, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, tick, building: !!rules.kinds[e.kind]?.building };
    if (e.ruin) continue;
    if (s.building) mem.enemyBuildings.set(e.id, s); else mem.sightings.set(e.id, s);
  }
  for (const l of view.lastSeen) {
    if (l.kind === "deposit" || l.ruin) continue;
    mem.enemyBuildings.set(l.id, { id: l.id, kind: l.kind, owner: l.owner, x: l.x, y: l.y, hp: l.hp, maxHp: l.maxHp, tick: mem.clock.tickAt(l.seenMs), building: true });
  }
  const vis = (p: Pt) => view.visibility[p.y]?.[p.x] === "2";
  for (const [id, s] of mem.sightings) {
    // A unit remembered at a visible tile and not there now has moved on; drop it. Old sightings fade.
    if (!view.enemy.some((e) => e.id === id) && (vis(s) || tick - s.tick > ticks(60))) mem.sightings.delete(id);
  }
  for (const [id, b] of mem.enemyBuildings) {
    if (!view.enemy.some((e) => e.id === id) && !view.lastSeen.some((l) => l.id === id) && vis(b)) mem.enemyBuildings.delete(id);
  }
  for (const ev of view.events) {
    if (ev.type === "death") { mem.sightings.delete(ev.id); mem.enemyBuildings.delete(ev.id); }
    if (ev.type === "eliminated") {
      for (const [id, s] of mem.sightings) if (s.owner === ev.owner) mem.sightings.delete(id);
      for (const [id, s] of mem.enemyBuildings) if (s.owner === ev.owner) mem.enemyBuildings.delete(id);
    }
    if (ev.type === "unload" && ev.owner === view.you) mem.delivered.set(ev.id, (mem.delivered.get(ev.id) ?? 0) + ev.amount);
  }
  // Aggression means their units hit mine; walking into a castle's or tower's range is my own doing.
  for (const a of view.underAttack ?? []) for (const at of a.attackers) if (at.owner !== view.you && !rules.kinds[at.kind]?.building) mem.aggressors.set(at.owner, tick);
  for (const ev of view.events) if (ev.type === "death" && ev.by === view.you && ev.owner !== view.you && !rules.kinds[ev.kind]?.building) mem.kills.push({ tick: ev.tick, value: rules.kinds[ev.kind]?.cost || 50 });
  mem.kills = mem.kills.filter((k) => tick - k.tick <= ticks(60));

  // Deposits: visible amounts now, remembered amounts otherwise, initial amounts when never seen.
  for (const d of view.deposits) mem.deposits.set(d.id, { id: d.id, x: d.x, y: d.y, amount: d.amount, seenTick: tick, visible: true });
  for (const l of view.lastSeen) if (l.kind === "deposit") {
    const known = mem.deposits.get(l.id);
    mem.deposits.set(l.id, { id: l.id, x: l.x, y: l.y, amount: l.amount, seenTick: known?.seenTick ?? 0, visible: false });
  }
  for (const d of mem.deposits.values()) d.visible = view.deposits.some((v) => v.id === d.id);
  for (const ev of view.events) if (ev.type === "depleted") mem.deposits.delete(ev.id);
  for (const [id, d] of mem.deposits) if (vis(d) && !view.deposits.some((v) => v.id === id)) mem.deposits.delete(id);

  const army = mine.filter((e) => ARMY_KINDS.includes(e.kind));
  const myStrength = army.reduce((n, e) => n + entityValue(e), 0);
  const recent = [...mem.sightings.values()].filter((s) => tick - s.tick <= ticks(45) && s.kind !== "worker" && s.kind !== "king");
  const enemyStrength: Record<PlayerId, number> = {};
  for (const s of recent) enemyStrength[s.owner] = (enemyStrength[s.owner] ?? 0) + entityValue(s);
  const enemyKnownStrength = Object.values(enemyStrength).reduce((a, b) => a + b, 0);

  const assets = [...castles, ...(byKind.king ?? []), ...(byKind.worker ?? []), ...(byKind.tower ?? [])];
  const threats = clusterThreats([...mem.sightings.values()].filter((s) => tick - s.tick <= ticks(15) && MOBILE_THREAT_KINDS.includes(s.kind)), assets, tick, mem);

  const grid = view.grid;
  const BLOCK = new Set(["$", "#", "%", "T", "t", "C", "c", "D", "d", "=", "^"]);
  const placeable = (p: Pt) => {
    const ch = grid[p.y]?.[p.x];
    return ch !== undefined && !BLOCK.has(ch) && !mine.some((e) => rules.kinds[e.kind]?.building && e.x === p.x && e.y === p.y)
      && !mine.some((e) => e.construction && e.construction.x === p.x && e.construction.y === p.y);
  };
  const explored = (p: Pt) => (view.visibility[p.y]?.[p.x] ?? "0") !== "0";
  const bases = frame.bases();
  const enemyBases: World["enemyBases"] = [];
  for (const b of mem.enemyBuildings.values()) if (b.kind === "castle" && enemyPlayers.some((p) => p.id === b.owner)) enemyBases.push({ pos: { x: b.x, y: b.y }, owner: b.owner, known: true });
  for (let s = 0; s < bases.length; s++) {
    if (s === seat) continue;
    const corner = bases[s];
    if (enemyBases.some((b) => dist(b.pos, corner) <= 6)) continue;
    // An ally's corner, or a corner we have seen empty, is not an enemy base.
    if (view.allies.some((a) => a.kind === "castle" && dist(a, corner) <= 6)) continue;
    if (explored(corner) && !mem.enemyBuildings.size && enemyPlayers.length < bases.length - 1 && vis(corner)) continue;
    enemyBases.push({ pos: corner, known: false });
  }
  for (const e of mine) mem.seenMine.set(e.id, { kind: e.kind, tick });
  mem.lastViewTick = tick;
  return {
    view, rules, clock: mem.clock, tick, timeMs: view.timeMs, timeLeftMs: Math.max(0, view.matchMs - view.timeMs), me,
    mineral: me.mineral ?? 0, pop: me.pop ?? 0, popCap: me.popCap, queuedPop: me.queuedPop ?? 0,
    frame, seat, clusters: mem.clusters, mine, byKind, castles, workers: byKind.worker ?? [], army, king: byKind.king?.[0], towers: byKind.tower ?? [],
    allies: view.allies, allyPlayers, enemyPlayers, teams, enemyVisible: view.enemy.filter((e) => !e.ruin),
    enemyBuildings: [...mem.enemyBuildings.values()], sightings: [...mem.sightings.values()], threats, myStrength, enemyStrength, enemyKnownStrength,
    deposits: [...mem.deposits.values()], events: view.events, visible: vis, explored, placeable, homeCastle, enemyBases,
    underAttackDamage: (view.underAttack ?? []).reduce((n, a) => n + a.damage, 0),
    recentKills: mem.kills.reduce((n, k) => n + k.value, 0),
  };
}

/** Groups recent enemy fighters by proximity; each group knows the closest own asset. */
function clusterThreats(units: Sighting[], assets: EntityView[], tick: number, mem: Memory): ThreatGroup[] {
  const out: ThreatGroup[] = [];
  for (const members of groupNearby(units, 4, (a, b) => a.owner === b.owner)) {
    // Workers only count as a threat if their owner has been hitting us.
    const strength = members.reduce((n, u) => n + (u.kind === "worker" && !(mem.aggressors.has(u.owner) && tick - (mem.aggressors.get(u.owner) ?? 0) < mem.clock.ticks(30)) ? 0 : entityValue(u)), 0);
    if (strength <= 0) continue;
    const x = Math.round(members.reduce((n, u) => n + u.x, 0) / members.length);
    const y = Math.round(members.reduce((n, u) => n + u.y, 0) / members.length);
    let near: ThreatGroup["near"] = null;
    for (const a of assets) {
      const d = dist(a, { x, y });
      if (!near || d < near.d) near = { id: a.id, kind: a.kind, d };
    }
    out.push({ units: members, strength, x, y, owner: members[0].owner, near, tick: Math.max(...members.map((u) => u.tick)) });
  }
  return out.sort((a, b) => (a.near?.d ?? 99) - (b.near?.d ?? 99));
}
