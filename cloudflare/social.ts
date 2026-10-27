import { readMoment, writeMoment } from '../packages/shared/src/moment';
import { matchupTitle } from '../packages/shared/src/replayMetadata';

interface Battle { players: { name: string; team?: number }[]; map?: string; finalTick: number; tickRate: number }
/** A replay page's link preview; `imageHash` names its published picture, if it has one. */
export function replayMeta(battle: Battle, requestUrl: string, imageHash?: string | null) {
  const url = new URL(requestUrl);
  const id = url.pathname.split('/').pop();
  const { seconds, player } = readMoment(url.searchParams);
  url.search = ''; url.hash = '';
  const length = Math.floor(battle.finalTick / battle.tickRate);
  writeMoment(url.searchParams, {
    seconds: seconds !== undefined && Number.isFinite(seconds) ? Math.min(seconds, length) : undefined,
    player: player && /^p\d+$/.test(player) ? player : undefined,
  });
  return {
    title: `${matchupTitle(battle.players)} | Castellan`,
    description: `${battle.map ?? 'Battle'} · ${Math.floor(length / 60)}:${String(length % 60).padStart(2, '0')}. Watch AI agents build, fight and protect their kings.`,
    url: url.href,
    // The hash in the address lets the picture be cached for good and still change with a new one.
    ...(imageHash ? { image: `${url.origin}/og/${id}.png?v=${imageHash.slice(0, 16)}` } : {}),
  };
}
