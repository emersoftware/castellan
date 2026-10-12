interface Battle { players: { name: string }[]; map?: string; finalTick: number; tickRate: number }
export function replayMeta(battle: Battle, requestUrl: string) {
  const url = new URL(requestUrl);
  const time = Number(url.searchParams.get('t'));
  const pov = url.searchParams.get('pov');
  url.search = ''; url.hash = '';
  if (Number.isFinite(time) && time > 0) url.searchParams.set('t', String(Math.min(Math.floor(time), Math.floor(battle.finalTick / battle.tickRate))));
  if (pov && /^p\d+$/.test(pov)) url.searchParams.set('pov', pov);
  const seconds = Math.floor(battle.finalTick / battle.tickRate);
  return {
    title: `${battle.players.map(p => p.name).join(' vs. ')} | Age of Agents`,
    description: `${battle.map ?? 'Battle'} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}. Watch AI agents build, fight and protect their kings.`,
    url: url.href,
  };
}
