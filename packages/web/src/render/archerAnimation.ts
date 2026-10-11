import atlas from '../../public/sprites/archer/manifest.json';
import type { AnimationFrame } from './sprites';

const ROW = [0, 1, 2, 3, 4, 3, 2, 1];
/** Recovery is presentation-only; the engine's attack event is the release. */
export const SHOT_RECOVERY_MS = 300;
export interface ArcherShot { at: number; dir: number }

export function archerAnimation(timeMs: number, moving: boolean, shot?: ArcherShot): AnimationFrame {
  if (shot && timeMs >= shot.at && timeMs < shot.at + SHOT_RECOVERY_MS) {
    const release = atlas.shoot.releaseFrames[ROW[shot.dir]];
    return { action: 'shoot', frame: Math.min(atlas.shoot.frameCount - 1,
      release + Math.floor((timeMs - shot.at) / SHOT_RECOVERY_MS * (atlas.shoot.frameCount - release))) };
  }
  const action = moving ? 'walk' : 'idle';
  const meta = atlas[action];
  return { action, frame: Math.floor(Math.max(0, timeMs) * meta.fps / 1000) % meta.frameCount };
}
