/**
 * What an entity looks like at a moment, from its published clips: a living unit's pose, a standing
 * building's damage and fire, and how a fallen entity goes. Times are presentation milliseconds.
 */
import worker from '../../../../assets/sprites/worker/manifest.json';
import knight from '../../../../assets/sprites/knight/manifest.json';
import king from '../../../../assets/sprites/king/manifest.json';
import archer from '../../../../assets/sprites/archer/manifest.json';
import wizard from '../../../../assets/sprites/wizard/manifest.json';
import castle from '../../../../assets/sprites/castle/manifest.json';
import tower from '../../../../assets/sprites/tower/manifest.json';
import wall from '../../../../assets/sprites/wall/manifest.json';
import wallpost from '../../../../assets/sprites/wallpost/manifest.json';
import door from '../../../../assets/sprites/door/manifest.json';
import openDoor from '../../../../assets/sprites/door-open/manifest.json';
import leftWall from '../../../../assets/sprites/wall-door-left/manifest.json';
import rightWall from '../../../../assets/sprites/wall-door-right/manifest.json';
import bothWall from '../../../../assets/sprites/wall-door-both/manifest.json';
import fireSites from '../../../../assets/sprites/castle/fire-pixels.json';
import { type Ability, type KindSpec, type EntityKind } from '@castellan/shared';
import { screenDir, viewFor, type AnimationFrame, type Turnaround } from './sprites';
import type { ClipArt } from './clips';
import { corpseFade } from './corpseFade';

type Action = AnimationFrame['action'];
interface Clip {
  fps: number; frameCount: number; available?: boolean; impactFrames?: number[]; releaseFrames?: number[];
  frameWidth?: number; frameHeight?: number; anchorX?: number; anchorY?: number; storedScale?: number; sizeFactor?: number; directions?: Turnaround;
  /** Casting clips: the staff crystal per row (S, SE, E, NE, N) and frame, in stored pixels of a cell, and per row the
   * reviewed frames where it flares. */
  castPoints?: { crystal: number[][][]; pulses: number[][] };
}
type Atlas = Partial<Record<Action, Clip>>;
const units = new Map<ClipArt, Atlas>([['archer', archer], ['knight', knight], ['king', king], ['wizard', wizard], ['worker', worker]]);
const buildings = new Map<ClipArt, Atlas>([
  ['castle', castle], ['tower', tower], ['wall', wall], ['wallpost', wallpost], ['door', door], ['door-open', openDoor],
  ['wall-door-left', leftWall], ['wall-door-right', rightWall], ['wall-door-both', bothWall],
]);

/** A published clip of `art`, from the unit or the building atlases. */
function clip(art: ClipArt, action: Action, atlases = units): Clip | undefined {
  const meta = atlases.get(art)?.[action];
  return meta?.available === false ? undefined : meta;
}
const loop = (action: Action, meta: Clip, timeMs: number): AnimationFrame =>
  ({ action, frame: Math.floor(Math.max(0, timeMs) * meta.fps / 1000) % meta.frameCount });
/** Plays once, then holds its last frame. */
const once = (action: Action, meta: Clip, timeMs: number): AnimationFrame =>
  ({ action, frame: Math.min(meta.frameCount - 1, Math.floor(Math.max(0, timeMs) * meta.fps / 1000)) });

/** The clip a caster plays for `action`: conversion falls back to the hack gesture until it has its own. */
function castGesture(kind: EntityKind, action: Ability): 'heal' | 'hack' | 'convert' {
  return action === 'heal' ? 'heal' : action === 'convert' && clip(kind, 'convert') ? 'convert' : 'hack';
}

/** A casting clip's staff crystal and flares, facing one direction. */
export interface CastClip {
  fps: number;
  frameCount: number;
  /** The crystal at a clip frame, in display pixels from the ground point. */
  crystal(frame: number): { x: number; y: number };
  /** Frames where the crystal flares: particles burst and the cast sounds. Empty for a clip without reviewed flares. */
  pulses: readonly number[];
}

/** The staff crystal of `kind` casting `action` facing `dir`; undefined for art without a measured crystal. */
export function castClip(kind: EntityKind, action: Ability, dir: number): CastClip | undefined {
  const meta = clip(kind, castGesture(kind, action));
  const view = viewFor(meta?.directions, dir);
  const track = meta?.castPoints?.crystal[view.row];
  if (!meta || !track || meta.storedScale === undefined) return undefined;
  const scale = (meta.sizeFactor ?? 1) / meta.storedScale, mirror = view.flip ? -1 : 1;
  const groundX = (meta.anchorX ?? 0.5) * (meta.frameWidth ?? 0), groundY = (meta.anchorY ?? 1) * (meta.frameHeight ?? 0);
  return {
    fps: meta.fps, frameCount: meta.frameCount, pulses: meta.castPoints!.pulses[view.row] ?? [],
    // A mirrored view mirrors the crystal about the ground point.
    crystal: (frame) => {
      const [x, y] = track[Math.max(0, Math.min(track.length - 1, Math.floor(frame)))];
      return { x: (x - groundX) * scale * mirror, y: (y - groundY) * scale };
    },
  };
}

/** Units drawn from clips step from tile to tile; the rest hop. */
export const animatedUnit = (kind: EntityKind) => units.has(kind);

/** Turnaround rows: S, SE, E, NE, N; the west half mirrors them. */
const ROW = [0, 1, 2, 3, 4, 3, 2, 1];
/** An attack event's moment and screen direction. */
export interface Strike { at: number; dir: number }
/** A Wizard's ability in use and, when drawn, the tile of its target. Convert plays the hack gesture until it has its own clip. */
interface Cast { action: Ability; toward?: { x: number; y: number } }

/**
 * Archers loose an arrow, the rest strike in melee. The engine's attack event is the release or the impact,
 * so the clip starts at the frame marking it; the recovery after it is presentation only.
 */
function strikeOf(kind: EntityKind): { action: Action; ms: number; marks: 'releaseFrames' | 'impactFrames' } {
  return kind === 'archer'
    ? { action: 'shoot', ms: 300, marks: 'releaseFrames' }
    : { action: 'attack', ms: 400, marks: 'impactFrames' };
}

/** How long a strike's clip plays; undefined when the kind has none and lunges instead. */
export function strikeMs(kind: EntityKind): number | undefined {
  const strike = strikeOf(kind);
  return clip(kind, strike.action) ? strike.ms : undefined;
}

// The source clips contain different numbers of steps: the Archer loop covers
// roughly one tile of foot travel; Knight/King/Worker/Wizard cover two. Drive phase by world
// distance so faster units and diagonal moves take proportionally more steps.
function pose(kind: EntityKind, timeMs: number, walked: number | undefined, strike: Strike | undefined): AnimationFrame | undefined {
  const { action, ms, marks } = strikeOf(kind);
  const blow = clip(kind, action);
  if (blow && strike && timeMs >= strike.at && timeMs < strike.at + ms) {
    const mark = blow[marks]?.[ROW[strike.dir]] ?? 0;
    return { action, frame: Math.min(blow.frameCount - 1, mark + Math.floor((timeMs - strike.at) / ms * (blow.frameCount - mark))) };
  }
  if (walked !== undefined) {
    const walk = clip(kind, 'walk');
    const tiles = kind === 'archer' ? 1 : 2;
    return walk && { action: 'walk', frame: Math.floor(Math.max(0, walked) / tiles * walk.frameCount) % walk.frameCount };
  }
  const idle = clip(kind, 'idle');
  return idle && loop('idle', idle, timeMs);
}

export interface UnitLook {
  /** Undefined when the kind has no clips. */
  animation?: AnimationFrame;
  /** Screen direction it faces: its deposit while it mines. */
  heading: number;
  /** Half tiles walked, and whether the pick is in the rock: the cues of its sounds. */
  footfalls?: number;
  pickDown?: boolean;
}

/** The screen direction from one tile toward another; `heading` when they coincide. */
function toward(from: { x: number; y: number }, to: { x: number; y: number }, heading: number) {
  const dx = to.x - from.x, dy = to.y - from.y;
  return dx || dy ? screenDir(dx - dy, (dx + dy) / 2) : heading;
}

/**
 * A living unit at `timeMs`, heading `heading`: striking, else casting or mining while it stands (facing its target or
 * deposit), walking or idle. `walked`: tiles covered in the current walk, absent while it stands.
 */
export function unitLook(unit: { kind: EntityKind; x: number; y: number; gathering?: { x: number; y: number } }, heading: number, timeMs: number,
  motion: { walked?: number; strike?: Strike; cast?: Cast }): UnitLook {
  const { walked, strike } = motion;
  const standing = !strike && walked === undefined;
  const cast = standing ? motion.cast : undefined;
  const mining = standing && !cast ? unit.gathering : undefined;
  const aim = cast?.toward ?? mining;
  if (aim) heading = toward(unit, aim, heading);
  const gesture = cast && castGesture(unit.kind, cast.action);
  const spell = gesture && clip(unit.kind, gesture);
  const mine = mining && clip(unit.kind, 'mine');
  const animation = gesture && spell ? loop(gesture, spell, timeMs) : mine ? loop('mine', mine, timeMs) : pose(unit.kind, timeMs, walked, strike);
  // Frames where the pick hits the rock, per row.
  const pickDown = animation?.action === 'mine' ? animation.frame >= [11, 11, 7, 7, 7][ROW[heading]] && animation.frame < 21 : undefined;
  return { animation, heading, footfalls: walked === undefined ? undefined : Math.floor(walked * 2), pickDown };
}

interface FireParticle { x: number; y: number; heat: number; size: number }
export interface FireLook { animation: AnimationFrame; particles: FireParticle[]; intensity: number }
interface FireEmitter { x: number; y: number; radius: number }

/** Absolute simulation phase: no frame-count dependence, random drift or paused spawning. */
function fireParticles(emitters: readonly FireEmitter[], timeMs: number): FireParticle[] {
  const particles: FireParticle[] = [];
  emitters.forEach((e, site) => {
    for (let index = 0; index < 8; index++) {
      const lifetime = 650 + ((index * 137 + site * 97) % 420);
      const age = ((Math.max(0, timeMs) + index * 113 + site * 71) % lifetime) / lifetime;
      const side = Math.sin(index * 2.4 + site * .7);
      particles.push({ x: e.x + side * e.radius + Math.sin(age * 5 + index) * age * 1.2,
        y: e.y - age * (7 + (index % 4) * 2), heat: .25 + .75 * (1 - age), size: index % 3 === 0 ? 1.2 : .65 });
    }
  });
  return particles;
}

interface Health { kind: EntityKind; hp: number; maxHp: number }
/** The castle's two reviewed art stages describe destruction; ignition uses remaining HP. */
function damageStage({ kind, hp, maxHp }: Health): 25 | 50 | undefined {
  if (kind !== 'castle' || maxHp <= 0) return undefined;
  const health = Math.max(0, hp) / maxHp;
  return health <= .25 ? 50 : health <= .75 ? 25 : undefined;
}
const burning = ({ hp, maxHp }: Health) => maxHp > 0 && hp / maxHp <= .5;

/** A standing building with clips (castles, towers): its damage stage or idle loop, and the fire burning on it. */
export function buildingLook(building: Health, timeMs: number): { animation: AnimationFrame; fire?: FireLook } | undefined {
  const { kind } = building;
  const idle = clip(kind, 'idle', buildings);
  if (!idle) return undefined;
  const stage = damageStage(building);
  if (!stage) return { animation: loop('idle', idle, timeMs) };
  const damaged = `damaged${stage}` as const, ignited = `fire${stage}` as const;
  const flames = burning(building) && clip(kind, ignited, buildings);
  return {
    animation: clip(kind, damaged, buildings) ? { action: damaged, frame: 0 } : loop('idle', idle, timeMs),
    fire: flames ? { animation: loop(ignited, flames, timeMs), particles: fireParticles(fireSites.stages[stage], timeMs), intensity: 1 } : undefined,
  };
}

export interface Fall {
  /** A building collapses through its clip or crumbles to dust; a unit plays its death or topples. */
  way: 'collapse' | 'rubble' | 'death' | 'corpse';
  /** The art to draw: a barrier keeps the piece it showed. */
  art: ClipArt;
  /** Its look `elapsedMs` after the fall: the frame, the fire dying down on a burning castle, and the fades. */
  at(elapsedMs: number): { animation?: AnimationFrame; fire?: FireLook; alpha: number; shadow: number };
}

/** How an entity of `spec` goes when it dies; `barrierArt` is the wall piece it showed. */
export function fall(entity: Health, spec: KindSpec | undefined, barrierArt?: ClipArt): Fall {
  const building = !!spec?.building;
  const { kind } = entity;
  const art = building ? barrierArt ?? kind : kind;
  const fadeMs = building ? 1500 : 6000;
  const stage = damageStage(entity);
  const fade = (elapsedMs: number) => ({ alpha: corpseFade(elapsedMs, 0, fadeMs).alpha, shadow: Math.max(0, 1 - elapsedMs / fadeMs * 2) });
  if (!building) {
    const death = clip(kind, 'death');
    if (!death) return { way: 'corpse', art, at: fade };
    return { way: 'death', art, at: (elapsedMs) => ({ animation: once('death', death, elapsedMs), ...fade(elapsedMs) }) };
  }
  const staged = art === 'castle' && stage ? `death${stage}` as const : undefined;
  const action: Action = staged && clip(art, staged, buildings) ? staged : 'death';
  const collapse = clip(art, action, buildings);
  if (!collapse) return { way: 'rubble', art, at: fade };
  const embers = stage && burning(entity) ? `deathFire${stage}` as const : undefined;
  const flames = embers && clip(kind, embers, buildings);
  const tracks = stage && (fireSites as { collapses?: Record<string, FireEmitter[][]> }).collapses?.[String(stage)];
  // Play the full collapse, hold its final frame, then fade the remains in place.
  const heldMs = collapse.frameCount / collapse.fps * 1000 + 1500;
  return { way: 'collapse', art, at: (elapsedMs) => {
    const animation = once(action, collapse, elapsedMs);
    const intensity = Math.max(0, 1 - Math.max(0, elapsedMs - 2300) / 1000);
    const fire = embers && flames && intensity > 0
      ? { animation: { action: embers, frame: animation.frame }, particles: fireParticles(tracks?.[animation.frame] ?? [], elapsedMs), intensity } : undefined;
    return { animation, fire, alpha: corpseFade(elapsedMs, heldMs, 3000).alpha, shadow: fade(elapsedMs).shadow };
  } };
}
