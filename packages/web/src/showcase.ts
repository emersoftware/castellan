import type { SpectatorView } from '@castellan/shared';

/** The landing hero's recording: the current rules' fortress free-for-all of Opus, Sol, Fable and Astra. */
export const SHOWCASE_REPLAY = '451548b0';

/** Begin eight seconds before the first casualty, using the recording's own tick rate. */
export function showcaseStart(frames: readonly SpectatorView[], tickRate: number): number | null {
  const death = frames.find(frame => frame.events.some(event => event.type === 'death'));
  return death ? Math.max(0, death.tick - Math.round(8 * tickRate)) : null;
}
