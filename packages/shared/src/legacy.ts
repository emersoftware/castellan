import type { EntityView, GameEvent, PlayerStats, SpectatorView } from "./protocol.ts";
import type { EntityKind, KindSpec, RecordedKind, Ruleset } from "./ruleset.ts";

/** Former names of today's kinds, kept by old recordings. */
export type LegacyKind = "agent" | "nexus" | "ranger" | "turret";

/** Read old recordings without rewriting their orders, scripts or unit kinds. */
export function withMineralNames(ruleset: Ruleset): Ruleset {
  if (ruleset.startMineral !== undefined && ruleset.score.mineral !== undefined) return ruleset;
  const { startCapital, ...rest } = ruleset as Ruleset & { startCapital?: number };
  const { capital, ...score } = ruleset.score as Ruleset["score"] & { capital?: number };
  const startMineral = ruleset.startMineral ?? startCapital;
  const mineral = ruleset.score.mineral ?? capital;
  if (startMineral === undefined || mineral === undefined) throw new Error("Ruleset is missing mineral values");
  return { ...rest, startMineral, score: { ...score, mineral } };
}

/**
 * What a ruleset recorded before a field existed meant by leaving it out: the kind named wall formed
 * wall lines, `lastAttacker()` looked back 5 s and player VMs had a 256 KiB stack.
 */
export function withRecordedDefaults(ruleset: Ruleset): Ruleset {
  const kinds = ruleset.kinds as Record<string, KindSpec>;
  const walls = Object.values(kinds).some((spec) => spec.barrier) || !kinds.wall ? ruleset.kinds : { ...ruleset.kinds, wall: { ...kinds.wall, barrier: true } };
  return { ...ruleset, kinds: walls, lastAttackerMs: ruleset.lastAttackerMs ?? 5000,
    script: { ...ruleset.script, stackBytes: ruleset.script.stackBytes ?? 256 * 1024 } };
}

/** Whether shots skip entities inside the shooter's minimum range; 0.29.0 recordings predate the field. */
export function blindSpotOnPath(ruleset: Ruleset): boolean {
  if (ruleset.projectiles.blindSpot !== undefined) return ruleset.projectiles.blindSpot;
  const [major, minor] = /^(\d+)\.(\d+)\.\d+(?:\+|$)/.exec(ruleset.version ?? "")?.slice(1).map(Number) ?? [];
  return major !== undefined && (major > 0 || minor >= 29);
}

/** Static showcase frames published before the resource rename. */
function mineralBalance(player: PlayerStats): number | undefined {
  return player.mineral ?? (player as PlayerStats & { capital?: number }).capital;
}

const RENAMED = new Map<string, EntityKind>([["agent", "king"], ["nexus", "castle"], ["ranger", "archer"], ["turret", "tower"]]);

/** A recorded kind under its current name. */
export function currentKind(kind: RecordedKind): EntityKind;
export function currentKind(kind: string): string;
export function currentKind(kind: string): string {
  return RENAMED.get(kind) ?? kind;
}

/** The name a current kind had before its rename, if it was renamed. */
export const formerKind = (kind: EntityKind): string | undefined => [...RENAMED].find(([, current]) => current === kind)?.[0];

/** A ruleset's spec for a current kind, also when the ruleset still uses an old name. */
export function kindSpec(ruleset: Ruleset, kind: EntityKind): KindSpec | undefined {
  return ruleset.kinds[kind] ?? Object.entries(ruleset.kinds).find(([id]) => currentKind(id) === kind)?.[1];
}

/** Labels from recorded orders/research; never rewrite a player's chat or code. */
function displayGameText(text: string): string {
  return text.replace(/\b(ranger|turret|capital)(?=\b|_)/g, word => word === "capital" ? "mineral" : currentKind(word));
}

/**
 * The rules as a viewer shows them: today's kind, research and resource names.
 * Display only: the engine must keep simulating the recorded ruleset.
 */
export function currentRuleset(ruleset: Ruleset): Ruleset {
  const r = withMineralNames(ruleset);
  return { ...r,
    projectiles: { ...r.projectiles, flyOver: r.projectiles.flyOver.map((k) => currentKind(k)) },
    kinds: Object.fromEntries(Object.entries(r.kinds).map(([id, spec]) => [currentKind(id), { ...spec,
      ...(spec.builds ? { builds: spec.builds.map((k) => currentKind(k)) } : {}), ...(spec.trains ? { trains: spec.trains.map((k) => currentKind(k)) } : {}),
      ...(spec.requires ? { requires: displayGameText(spec.requires) } : {}) }])),
    upgrades: Object.fromEntries(Object.entries(r.upgrades).map(([id, u]) => [displayGameText(id), { ...u, kind: currentKind(u.kind) }])),
    defaultScripts: Object.fromEntries(Object.entries(r.defaultScripts).map(([kind, code]) => [currentKind(kind), code])),
    map: { ...r.map, start: r.map.start.map((s) => ({ ...s, kind: currentKind(s.kind) })) },
  };
}

/** Copies only the items that hold a former name. */
const each = <T>(items: T[], rename: (item: T) => T) => {
  let out: T[] | undefined;
  items.forEach((item, i) => { const next = rename(item); if (next !== item) (out ??= [...items])[i] = next; });
  return out ?? items;
};

function currentEntity(e: EntityView): EntityView {
  const order = e.order && displayGameText(e.order);
  if (!RENAMED.has(e.kind) && order === e.order && !(e.construction && RENAMED.has(e.construction.kind)) && !e.training?.some((t) => RENAMED.has(t.kind))) return e;
  return { ...e, kind: currentKind(e.kind), ...(order !== undefined ? { order } : {}),
    ...(e.construction ? { construction: { ...e.construction, kind: currentKind(e.construction.kind) } } : {}),
    ...(e.training ? { training: e.training.map((t) => ({ ...t, kind: currentKind(t.kind) })) } : {}) };
}

function currentPlayer(p: PlayerStats): PlayerStats {
  const mineral = mineralBalance(p), oldUpgrades = p.upgrades && Object.keys(p.upgrades).some((id) => displayGameText(id) !== id);
  if (mineral === p.mineral && !oldUpgrades && (!p.research || displayGameText(p.research.upgrade) === p.research.upgrade)) return p;
  const { capital: _, ...rest } = p as PlayerStats & { capital?: number };
  return { ...rest, ...(mineral !== undefined ? { mineral } : {}),
    ...(oldUpgrades ? { upgrades: Object.fromEntries(Object.entries(p.upgrades!).map(([id, level]) => [displayGameText(id), level])) } : {}),
    ...(p.research ? { research: { ...p.research, upgrade: displayGameText(p.research.upgrade) } } : {}) };
}

function currentEvent(e: GameEvent): GameEvent {
  if ("kind" in e && RENAMED.has(e.kind)) return { ...e, kind: currentKind(e.kind) };
  if ((e.type === "research_started" || e.type === "upgrade_completed") && displayGameText(e.upgrade) !== e.upgrade) return { ...e, upgrade: displayGameText(e.upgrade) };
  return e;
}

/**
 * A frame under today's names, for display only (see `currentRuleset`); also the parts of one, such as a
 * highlight's player stats or event feed. Chat and logs stay as written.
 */
export function currentFrame<V extends Pick<SpectatorView, "players" | "entities" | "events" | "perspectives">>(view: V): V {
  const perspectives = view.perspectives && Object.fromEntries(Object.entries(view.perspectives).map(([id, p]) =>
    [id, { ...p, entities: each(p.entities, currentEntity), players: each(p.players, currentPlayer), events: each(p.events, currentEvent) }]));
  return Object.assign({}, view, { players: each(view.players, currentPlayer), entities: each(view.entities, currentEntity), events: each(view.events, currentEvent) },
    perspectives ? { perspectives } : {});
}
