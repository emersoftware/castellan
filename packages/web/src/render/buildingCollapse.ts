import castle from '../../public/sprites/castle/manifest.json';
import tower from '../../public/sprites/tower/manifest.json';
import wall from '../../public/sprites/wall/manifest.json';
import wallpost from '../../public/sprites/wallpost/manifest.json';
import door from '../../public/sprites/door/manifest.json';
import openDoor from '../../public/sprites/door-open/manifest.json';
import leftWall from '../../public/sprites/wall-door-left/manifest.json';
import rightWall from '../../public/sprites/wall-door-right/manifest.json';
import bothWall from '../../public/sprites/wall-door-both/manifest.json';
import type { AnimationFrame } from './sprites';
import { corpseFade } from './corpseFade';
import { displayKind } from './names';

interface CollapseAtlas { death?: { fps: number; frameCount: number; available?: boolean }; death25?: { fps: number; frameCount: number }; death50?: { fps: number; frameCount: number } }
const atlases: Record<string, CollapseAtlas> = {
  castle, nexus: castle, tower, wall, wallpost, door, 'door-open': openDoor,
  'wall-door-left': leftWall, 'wall-door-right': rightWall, 'wall-door-both': bothWall,
};

/** Play the full collapse, hold its final frame, then fade the remains in place. */
export function buildingCollapse(kind: string, elapsedMs: number, damageStage?: 25 | 50): { animation: AnimationFrame; alpha: number } | undefined {
  kind = displayKind(kind);
  const action = (kind === 'castle' || kind === 'nexus') && damageStage ? damageStage === 25 ? 'death25' : 'death50' : 'death';
  const meta = atlases[kind]?.[action] ?? atlases[kind]?.death;
  if (!meta || ('available' in meta && meta.available === false)) return undefined;
  const elapsed = Math.max(0, elapsedMs);
  const duration = meta.frameCount / meta.fps * 1000;
  const fade = corpseFade(elapsed, duration + 1500, 3000);
  return {
    animation: { action: atlases[kind]?.[action] ? action : 'death', frame: Math.min(meta.frameCount - 1, Math.floor(elapsed * meta.fps / 1000)) },
    ...fade,
  };
}
