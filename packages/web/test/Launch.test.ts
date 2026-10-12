// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { rules, type SpectatorView } from '@aoa/shared';
import { Landing } from '../src/routes/Landing';
import { ReplayPlayer } from '../src/routes/Replay';
import { ShareMoment, momentUrl } from '../src/components/ShareMoment';
import { currentBattles } from '../src/replayCatalog';
import { showcaseStart } from '../src/showcase';

vi.mock('@tanstack/react-router', () => ({ Link: ({children}: any) => createElement('a', null, children), useParams: () => ({id:'test'}) }));
vi.mock('../src/components/GameCanvas', () => ({ GameCanvas: () => null }));
vi.mock('../src/components/Portrait', () => ({ Portrait: () => null }));
vi.mock('../src/render/sprites', () => ({ loadSprites: async () => null }));
vi.mock('../src/components/Hud', () => ({ SidePanel:()=>null, OutcomeBanner:()=>null, SoundToggle:()=>null, Tooltip:()=>null, UnitPanel:()=>null, DepositPanel:()=>null, notableEvents:(e:unknown[])=>e }));
vi.mock('../src/audio/sfx', () => ({sfx:{muted:true, holdMusic:()=>()=>{},holdAmbient:()=>()=>{}}}));
vi.mock('../src/useReplay', () => ({useReplayFrames:()=>({frames:{current:[]},loaded:0,error:null,check:null})}));
let root: Root, host: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({matches:true}));
  host=document.createElement('div'); document.body.append(host); root=createRoot(host);
  client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
});
afterEach(async()=>{await act(async()=>root.unmount());client.clear();host.remove();vi.unstubAllGlobals();vi.restoreAllMocks();});
const render = (view: ReturnType<typeof createElement>) => act(async()=>root.render(createElement(QueryClientProvider,{client},view)));

it('shows the hero copy and controls while its battle and catalogue are still pending',async()=>{
  vi.stubGlobal('fetch',vi.fn(()=>new Promise(()=>{})));
  await render(createElement(Landing));
  expect(host.querySelector('.landing.pending')).toBeNull();
  expect(host.textContent).toContain('Watch the battles');
  expect(host.textContent).toContain('Loading battles');
  expect(host.querySelector('.hero-field img')).toBeNull();
});
it('lists only the exact current version, excluding unknown and experimental variants',()=>{
  expect(currentBattles([{id:'old',rulesVersion:'v25'},{id:'unknown'},{id:'new',rulesVersion:rules.version},{id:'experiment',rulesVersion:rules.version+'+stats:test'}],rules.version).map(r=>r.id)).toEqual(['new']);
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
