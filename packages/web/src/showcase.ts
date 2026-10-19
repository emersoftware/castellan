import type { SpectatorView } from '@castellan/shared';

/** Begin eight seconds before the first casualty, using the recording's own tick rate. */
export function showcaseStart(frames: readonly SpectatorView[], tickRate: number): number | null {
  const death = frames.find(frame => frame.events.some(event => event.type === 'death'));
  return death ? Math.max(0, death.tick - Math.round(8 * tickRate)) : null;
}
