import atlas from '../../public/sprites/castle/manifest.json';
import mapping from '../../public/sprites/castle/fire-pixels.json';
import type { AnimationFrame } from './sprites';
import { displayKind } from './names';

export type CastleDamageStage = 25 | 50;
interface Meta { fps: number; frameCount: number }
const clips = atlas as Partial<Record<AnimationFrame['action'], Meta>>;
export interface FireEmitter { x: number; y: number; radius: number }
const isCastle = (kind: string) => displayKind(kind) === 'castle';

/** The two art stages describe destruction, while ignition uses remaining HP. */
export function castleDamageStage(kind: string, hp: number, maxHp: number): CastleDamageStage | undefined {
  if (!isCastle(kind) || maxHp <= 0) return undefined;
  const health = Math.max(0, hp) / maxHp;
  return health <= .25 ? 50 : health <= .75 ? 25 : undefined;
}
export function castleMaterial(kind: string, hp: number, maxHp: number): AnimationFrame | undefined {
  const stage = castleDamageStage(kind, hp, maxHp);
  const action = stage === 25 ? 'damaged25' : 'damaged50';
  return stage && clips[action] ? { action, frame: 0 } : undefined;
}
export function castleFire(kind: string, hp: number, maxHp: number, timeMs: number): AnimationFrame | undefined {
  const stage = castleDamageStage(kind, hp, maxHp);
  if (!stage || hp / maxHp > .5) return undefined;
  const action = stage === 25 ? 'fire25' : 'fire50';
  const meta = clips[action];
  return meta ? { action, frame: Math.floor(Math.max(0, timeMs) * meta.fps / 1000) % meta.frameCount } : undefined;
}
export function castleEmitters(stage: CastleDamageStage): readonly FireEmitter[] {
  return mapping.stages[String(stage) as '25' | '50'];
}
export function castleCollapseFire(stage: CastleDamageStage, frame: number): { animation: AnimationFrame; emitters: readonly FireEmitter[] } | undefined {
  const action = stage === 25 ? 'deathFire25' : 'deathFire50';
  if (!clips[action]) return undefined;
  const tracks = (mapping as { collapses?: Record<string, FireEmitter[][]> }).collapses?.[String(stage)];
  return { animation: { action, frame }, emitters: tracks?.[frame] ?? [] };
}

export interface FireParticle { x: number; y: number; heat: number; size: number }
/** Absolute simulation phase: no frame-count dependence, random drift or paused spawning. */
export function fireParticles(emitters: readonly FireEmitter[], timeMs: number): FireParticle[] {
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
