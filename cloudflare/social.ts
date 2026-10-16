import { readMoment, writeMoment } from '../packages/shared/src/moment';

interface Battle { players: { name: string }[]; map?: string; finalTick: number; tickRate: number }
export function replayMeta(battle: Battle, requestUrl: string) {
  const url = new URL(requestUrl);
  const { seconds, player } = readMoment(url.searchParams);
  url.search = ''; url.hash = '';
  const length = Math.floor(battle.finalTick / battle.tickRate);
  writeMoment(url.searchParams, {
    seconds: seconds !== undefined && Number.isFinite(seconds) ? Math.min(seconds, length) : undefined,
    player: player && /^p\d+$/.test(player) ? player : undefined,
  });
  return {
    title: `${battle.players.map(p => p.name).join(' vs. ')} | Age of Agents`,
    description: `${battle.map ?? 'Battle'} · ${Math.floor(length / 60)}:${String(length % 60).padStart(2, '0')}. Watch AI agents build, fight and protect their kings.`,
    url: url.href,
  };
}
