import worker from '../../public/sprites/worker/manifest.json';
import knight from '../../public/sprites/knight/manifest.json';
import king from '../../public/sprites/king/manifest.json';
import ranger from '../../public/sprites/ranger/manifest.json';
import { rangerAnimation, SHOT_RECOVERY_MS, type RangerShot } from './rangerAnimation';
import type { AnimationFrame } from './sprites';

function unitAtlas(kind: string): Partial<Record<AnimationFrame['action'], { image: string; available?: boolean; impactFrames?: number[]; fps: number; frameCount: number }>> {
  return kind === 'ranger' ? ranger : kind === 'knight' ? knight : kind === 'king' || kind === 'agent' ? king : kind === 'worker' ? worker : {};
}
export function hasUnitAnimation(kind: string, action: AnimationFrame['action']): boolean {
  const atlas = unitAtlas(kind);
  return !!atlas[action] && atlas[action]?.available !== false;
}

/** A death plays once, then holds its final pose for the corpse fade. */
export function unitDeathAnimation(kind: string, elapsedMs: number): AnimationFrame | undefined {
  const meta = unitAtlas(kind).death;
  if (!meta || meta.available === false) return undefined;
  return { action: 'death', frame: Math.min(meta.frameCount - 1, Math.floor(Math.max(0, elapsedMs) * meta.fps / 1000)) };
}

const ROW = [0, 1, 2, 3, 4, 3, 2, 1];
export const MELEE_RECOVERY_MS = 400;
export const animatedUnit = (kind: string) => ['ranger', 'knight', 'king', 'agent', 'worker'].includes(kind);
export const recoveryMs = (kind: string) => kind === 'ranger' ? SHOT_RECOVERY_MS : MELEE_RECOVERY_MS;

// The source clips contain different numbers of steps: the Ranger loop covers
// roughly one tile of foot travel; Knight/King/Worker cover two. Drive phase by world
// distance so faster units and diagonal moves take proportionally more steps.
export function walkAnimation(kind: string, distance: number): AnimationFrame {
  const meta = unitAtlas(kind).walk!;
  const tilesPerLoop = kind === 'ranger' ? 1 : 2;
  return { action: 'walk', frame: Math.floor(Math.max(0, distance) / tilesPerLoop * meta.frameCount) % meta.frameCount };
}

/** Attack events already applied damage: play from impact, never delay melee. */
export function unitAnimation(kind: string, timeMs: number, moving: boolean, strike?: RangerShot, distance = 0): AnimationFrame | undefined {
  if (kind === 'ranger') {
    const frame = rangerAnimation(timeMs, moving, strike);
    return frame.action === 'walk' ? walkAnimation(kind, distance) : frame;
  }
  if (!animatedUnit(kind)) return undefined;
  const atlas = unitAtlas(kind);
  const attack = atlas.attack;
  if (attack && attack.available !== false && strike && timeMs >= strike.at && timeMs < strike.at + MELEE_RECOVERY_MS) {
    const impact = attack.impactFrames?.[ROW[strike.dir]] ?? 0;
    return { action: 'attack', frame: Math.min(attack.frameCount - 1,
      impact + Math.floor((timeMs - strike.at) / MELEE_RECOVERY_MS * (attack.frameCount - impact))) };
  }
  if (moving) return hasUnitAnimation(kind, 'walk') ? walkAnimation(kind, distance) : undefined;
  const meta = atlas.idle;
  return meta && meta.available !== false ? { action: 'idle', frame: Math.floor(Math.max(0, timeMs) * meta.fps / 1000) % meta.frameCount } : undefined;
}

export function unitMiningAnimation(kind: string, timeMs: number): AnimationFrame | undefined {
  const meta = unitAtlas(kind).mine;
  return meta && meta.available !== false ? { action: 'mine', frame: Math.floor(Math.max(0, timeMs) * meta.fps / 1000) % meta.frameCount } : undefined;
}
