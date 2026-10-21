/**
 * The game's own Pixi renderer for the talk: plays recorded board clips (assets/clips/*.json). No match server, no model calls, no player code runs here:
 * the frames were produced by re-simulating the original replays.
 *
 * window.AOA.mountClip(host, url, options) → controller { play, pause, setPaused, seek, destroy }.
 * The canvas renders at `pixel` CSS px per canvas pixel and is scaled up by an integer number of
 * device pixels, so the renderer's dither is never resampled. A paused or hidden clip stops the
 * Pixi ticker: nothing is drawn while a clip is not on screen.
 */
import { decodeShowcaseChunk } from '../../packages/web/src/showcaseRecording';
import { GameRenderer } from '../../packages/web/src/render/renderer';
import type { SpectatorView, Ruleset } from '../../packages/shared/src/index';

type ClipFile = {
  format: 1; id: string; tickRate: number; ruleset: Ruleset;
  players: { id: string; name: string }[]; startTick: number; finalTick: number;
  chunk: unknown; verification?: unknown;
};
type Options = {
  focus?: string; loop?: boolean; pixel?: number; reduced?: boolean;
  onTick?: (frame: SpectatorView, controller: Controller) => void;
  /** The renderer's own sound cues (sword, arrow, pick…), as the game plays them. */
  onSound?: (name: string, pan: number, volume: number) => void;
};
export type Controller = {
  id: string; frames: SpectatorView[]; readonly tick: number; readonly playing: boolean;
  play(): void; pause(): void; setPaused(paused: boolean): void; seek(index: number): void; destroy(): void;
};

const cache = new Map<string, Promise<{ meta: ClipFile; frames: SpectatorView[] }>>();
function load(url: string) {
  if (!cache.has(url)) cache.set(url, fetch(url).then(async r => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    const meta = await r.json() as ClipFile;
    // The slides tell the chat themselves: no speech bubbles from recorded chat events on the board.
    const frames = decodeShowcaseChunk(meta.chunk).map(f => ({ ...f, events: (f.events ?? []).filter(e => e.type !== 'chat') }));
    return { meta, frames };
  }));
  return cache.get(url)!;
}

function parseFocus(focus: string | undefined) {
  if (!focus || focus === 'map') return null;
  const [x0, y0, x1, y1] = focus.split(',').map(Number);
  return { x0, y0, x1, y1 };
}

async function mountClip(host: HTMLElement, url: string, options: Options = {}): Promise<Controller> {
  const { meta, frames } = await load(url);
  const pixel = Math.max(1, options.pixel ?? 1);
  // An inner box at 1/pixel of the host, scaled back up: the renderer draws fewer, larger pixels.
  const inner = document.createElement('div');
  inner.className = 'clip-inner';
  Object.assign(inner.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', transform: `scale(${pixel})` });
  const size = () => {
    inner.style.width = `${Math.ceil(host.clientWidth / pixel)}px`;
    inner.style.height = `${Math.ceil(host.clientHeight / pixel)}px`;
  };
  size();
  host.append(inner);
  const colors = Object.fromEntries(meta.players.map((p, i) => [p.id, i]));
  let renderer: GameRenderer;
  try {
    renderer = await GameRenderer.create(inner, meta.ruleset, colors, { fitOnResize: true, interactive: false, spriteBase: './assets/sprites' });
  } catch (error) {
    inner.remove();
    throw error;
  }
  const app = (renderer as unknown as { app: { ticker: { start(): void; stop(): void } } }).app;
  if (options.onSound) renderer.onSound((name, pan, volume) => options.onSound!(name, pan, volume));
  const resize = new ResizeObserver(size);
  resize.observe(host);
  const focus = parseFocus(options.focus);
  renderer.focus(focus);
  let index = 0, playing = false, destroyed = false, raf = 0, last = 0;
  const tickMs = 1000 / meta.tickRate;
  const reduced = !!options.reduced;
  if (!reduced) renderer.prepareReveal();
  renderer.setFrame(frames[0], tickMs, true);
  if (!reduced) renderer.reveal();

  const controller: Controller = {
    id: meta.id, frames,
    get tick() { return frames[index].tick; },
    get playing() { return playing; },
    play() {
      if (destroyed || playing) return;
      playing = true;
      renderer.setPaused(false);
      app.ticker.start();
      last = performance.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    },
    pause() {
      playing = false;
      renderer.setPaused(true);
      cancelAnimationFrame(raf);
      // Let the last frame settle, then stop drawing.
      setTimeout(() => { if (!playing && !destroyed) app.ticker.stop(); }, 250);
    },
    setPaused(paused) { paused ? controller.pause() : controller.play(); },
    seek(i) {
      index = Math.max(0, Math.min(frames.length - 1, i));
      renderer.setFrame(frames[index], tickMs, true);
      options.onTick?.(frames[index], controller);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      playing = false;
      cancelAnimationFrame(raf);
      resize.disconnect();
      try { renderer.destroy(); } catch (e) { console.warn(e); }
      inner.remove();
    },
  };
  function loop(now: number) {
    if (!playing || destroyed) return;
    if (document.hidden) { last = now; raf = requestAnimationFrame(loop); return; }
    // Catch up at most a few ticks after a stall; never skip the whole clip.
    let steps = 0;
    while (now - last >= tickMs && steps < 3) {
      last += tickMs; steps++;
      if (index >= frames.length - 1) {
        if (options.loop === false) { controller.pause(); return; }
        index = 0;
        renderer.setFrame(frames[0], tickMs, true);
      } else {
        index++;
        renderer.setFrame(frames[index], tickMs, false);
      }
      options.onTick?.(frames[index], controller);
    }
    if (now - last > tickMs * 4) last = now;
    raf = requestAnimationFrame(loop);
  }
  options.onTick?.(frames[0], controller);
  if (reduced) {
    // Reduced motion: the clip waits on its first frame until asked to play.
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'clip-play';
    button.textContent = '▶ Reproducir replay';
    button.onclick = () => { button.remove(); controller.play(); };
    host.append(button);
    app.ticker.stop();
    const destroy = controller.destroy;
    controller.destroy = () => { button.remove(); destroy(); };
    controller.play = ((play) => () => { button.remove(); play(); })(controller.play);
  }
  return controller;
}

Object.assign(window, { AOA: { mountClip, preload: (url: string) => { load(url).catch(() => {}); } } });
window.dispatchEvent(new Event('aoa-ready'));
