// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SpectatorView } from '@castellan/shared';
import { Landing, featuredBattles } from '../src/routes/Landing';
import { ReplayPlayer } from '../src/routes/Replay';
import { ShareMoment, momentUrl } from '../src/components/ShareMoment';
import { catalogBattles, newerFamily, rulesFamily } from '../src/replayCatalog';
import { showcaseStart } from '../src/showcase';

vi.mock('@tanstack/react-router', () => ({ Link: ({children}: any) => createElement('a', null, children), useParams: () => ({id:'test'}) }));
vi.mock('../src/components/GameCanvas', () => ({ GameCanvas: () => null }));
vi.mock('../src/components/Portrait', () => ({ Portrait: () => null }));
vi.mock('../src/render/sprites', () => ({ loadSprites: async () => null, HERO_SPRITE_BASE: "/game-assets/hero-sprites" }));
vi.mock('../src/components/Hud', () => ({ ViewerTop: () => null, SidePanel:()=>null, OutcomeBanner:()=>null, SoundToggle:()=>null, Tooltip:()=>null, UnitPanel:()=>null, DepositPanel:()=>null, notableEvents:(e:unknown[])=>e }));
vi.mock('../src/audio/sfx', () => ({sfx:{muted:true, holdMusic:()=>()=>{},holdAmbient:()=>()=>{}}}));
vi.mock('../src/useReplay', () => ({useReplayFrames:()=>({frames:{current:[]},loaded:0,error:null,check:null})}));
let root: Root, host: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
  host=document.createElement('div'); document.body.append(host); root=createRoot(host);
  client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
});
afterEach(async()=>{await act(async()=>root.unmount());client.clear();host.remove();sessionStorage.clear();vi.unstubAllGlobals();vi.restoreAllMocks();});
const render = (view: ReturnType<typeof createElement>) => act(async()=>root.render(createElement(QueryClientProvider,{client},view)));

it('shows the hero copy and controls while its battle and catalogue are still pending',async()=>{
  vi.stubGlobal('fetch',vi.fn(()=>new Promise(()=>{})));
  await render(createElement(Landing));
  expect(host.querySelector('.landing.pending')).toBeNull();
  expect(host.textContent).toContain('Watch the battles');
  expect(host.textContent).toContain('Loading battles');
  expect(host.querySelector('.hero-field img')).toBeNull();
});
it('lists agent battles of every known rules family, newest first, without rewriting metadata',()=>{
  const entry = (id: string, rulesVersion?: string, createdAt = '2026-10-01') => ({id, rulesVersion, players: [], createdAt});
  const entries = [
    entry('old','v25-castle-knight','2026-09-01'), entry('unknown'),
    entry('new','0.29.0','2026-10-19'),
    entry('renamed','v26-coordinated-movement','2026-09-20'),
    entry('experiment','0.27.0+stats:test'), entry('bot','0.29.0'),
  ];
  entries[5].players = [{ name: 'bot:rush' }] as never;
  const before = structuredClone(entries);
  expect(catalogBattles(entries).map(r=>r.id)).toEqual(['new','experiment','renamed','old']);
  expect(entries).toEqual(before);
  expect(['0.29.0','0.27.1','0.27.0+stats:test','v26-coordinated-movement','v21b-knight-16','v20-unlocks+stats:v18','custom',undefined].map(rulesFamily))
    .toEqual(['0.29','0.27','0.27','v26','v21b','v20',null,null]);
  expect(['v20','0.27','v21b','v26','0.29','v21d','v21'].sort(newerFamily)).toEqual(['0.29','0.27','v26','v21d','v21b','v21','v20']);
});
it('starts eight seconds before the first casualty using the recorded tick rate',()=>{
  const frames=[{tick:0,events:[]},{tick:100,events:[{type:'attack'}]},{tick:205,events:[{type:'death'}]}] as SpectatorView[];
  expect(showcaseStart(frames,20)).toBe(45);
  expect(showcaseStart(frames.slice(0,2),20)).toBeNull();
});
it('copies the currently shown moment and perspective without spectator credentials',async()=>{
  const copy=vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}});
  Object.defineProperty(navigator,'share',{configurable:true,value:undefined});
  await render(createElement(ShareMoment,{id:'test',seconds:123.7,pov:'p3'}));
  await act(async()=>host.querySelector('button')!.click());
  expect(new URL(copy.mock.calls[0][0]).search).toBe('?t=123&pov=p3');
  expect(host.textContent).toContain('Link copied');
  expect(momentUrl('https://example.com/watch/test?token=secret#spectator=secret','test',10,null)).toBe('https://example.com/replay/test?t=10');
});
it('offers a selectable link when clipboard access is denied',async()=>{
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('denied'))}});
  Object.defineProperty(navigator,'share',{configurable:true,value:undefined});
  await render(createElement(ShareMoment,{id:'test',seconds:1,pov:null}));
  await act(async()=>host.querySelector('button')!.click());
  expect(host.querySelector('input')?.value).toContain('/replay/test?t=1');
});
it('explains a failed replay download and retries it from the page',async()=>{
  vi.stubEnv('VITE_PUBLIC_REPLAYS','true');
  const fetcher=vi.fn().mockResolvedValue(new Response('unavailable',{status:503}));vi.stubGlobal('fetch',fetcher);
  await render(createElement(ReplayPlayer,{id:'missing'}));
  await vi.waitFor(()=>expect(host.textContent).toContain('Couldn’t load this battle'));
  const before=fetcher.mock.calls.length;
  await act(async()=>host.querySelector('button')!.click());
  expect(fetcher.mock.calls.length).toBeGreaterThan(before);
  vi.unstubAllEnvs();
});
it('keeps the chosen replay speed for the next game in this tab',async()=>{
  vi.stubGlobal('fetch',vi.fn(()=>new Promise(()=>{})));
  await render(createElement(ReplayPlayer,{id:'g1'}));
  const speed=(label: string)=>[...host.querySelectorAll('.speeds button')].find(b=>b.textContent===label)!;
  expect(speed('2×').className).toBe('on');
  await act(async()=>(speed('8×') as HTMLButtonElement).click());
  await render(createElement(ReplayPlayer,{id:'g2',key:'g2'}));
  expect(speed('8×').className).toBe('on');
});
describe("featured battles", () => {
  const battle = (id: string, names: string[], teams: (number | undefined)[], savedAt: string) =>
    ({ id, createdAt: savedAt, savedAt, players: names.map((name, i) => ({ id: `p${i + 1}`, name, team: teams[i] })) });
  it("keeps the three selected Claude/Codex recordings despite newer games or display names", () => {
    const featured = featuredBattles([
      battle("b470c159", ["Opus 5.5", "Fable 5.1", "Sol 6.1", "Astra 6"], [0, 0, 1, 1], "2026-10-24"),
      battle("new-duel", ["Sol 6.1", "Opus 5.5"], [0, 1], "2026-10-15"),
      battle("242b57f9", ["Argon", "Argon", "Astra 6", "Fable 5.1"], [0, 1, 0, 1], "2026-10-15"),
      battle("451548b0", ["Opus 5.5", "Sol 6.1", "Fable 5.1", "Astra 6"], [0, 1, 2, 3], "2026-10-24"),
      battle("new-ffa", ["Argon", "Astra 6", "Fable 5.1"], [0, 1, 2], "2026-10-15"),
      battle("77e5b88e", ["Claude Opus 5.5 Low", "GPT Sol 6.1 Low"], [0, 1], "2026-10-24"),
    ]);
    expect(featured.map(r => r.id)).toEqual(["451548b0", "77e5b88e", "b470c159"]);
  });
  it("leaves unavailable selections absent and never substitutes another battle", () => {
    const duel = battle("77e5b88e", ["Opus 5.5", "Sol 6.1"], [0, 1], "2026-10-24");
    const other = battle("11cfcefc", ["Fable 5.1", "Astra 6"], [0, 1], "2026-10-14");
    expect(featuredBattles([duel, other, duel])).toEqual([duel]);
    expect(featuredBattles([other])).toEqual([]);
  });
});
