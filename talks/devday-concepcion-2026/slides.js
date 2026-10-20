/* Por y para agentes · DevDay Concepción 2026 — presentation engine.
 *
 * Scenes are <section class="scene"> in index.html. Each one has data-steps (clicks inside the
 * scene) and data-cues (one presenter cue per step, separated by "|"). Inside a scene,
 * [data-in="k"] shows from step k on and [data-out="k"] hides from step k on. The whole visual
 * state is a function of (scene, step): going back re-renders the earlier state, so ← and →
 * always agree. Scene behaviour (canvases, replays, audio) lives in scenes.js and receives the
 * same (scene, step) through enter/update/leave hooks.
 *
 * Layout: 1 rem = 10 design px of a 1920×1080 stage, sized to the window at native resolution,
 * so canvases and dithering are never resampled by a CSS transform.
 */
(() => {
  const deck = document.getElementById('deck');
  const scenes = [...deck.querySelectorAll(':scope > .scene')];
  const notes = window.TALK_NOTES || [];
  const params = new URLSearchParams(location.search);
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('aoa-devday-v2') : null;
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const hooks = () => window.TalkScenes || {};
  const state = { scene: 0, step: 0, dir: 1, muted: false, black: false, white: false };
  let started = false;

  const reduced = () => params.get('motion') === 'reduce' || motionQuery.matches;
  const stepsOf = el => Math.max(1, Number(el.dataset.steps) || 1);
  const cuesOf = el => (el.dataset.cues || '').split('|').map(s => s.trim());

  // ───────── layout ─────────
  function fit() {
    const unit = Math.min(innerWidth / 192, innerHeight / 108);
    document.documentElement.style.fontSize = unit + 'px';
    const w = unit * 192, h = unit * 108;
    deck.style.left = Math.round((innerWidth - w) / 2) + 'px';
    deck.style.top = Math.round((innerHeight - h) / 2) + 'px';
    document.documentElement.style.setProperty('--unit', String(unit));
    window.dispatchEvent(new CustomEvent('talk-resize', { detail: { unit } }));
  }

  // ───────── Bayer dissolve masks (the game's 4×4 ordered dither) ─────────
  // 17 screen-door masks, 0 = nothing shown … 16 = all shown, used by CSS keyframes.
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function installBayer() {
    const vars = [];
    for (let k = 0; k <= 16; k++) {
      const cells = BAYER.map((v, i) => v < k ? `<rect x="${i % 4}" y="${Math.floor(i / 4)}" width="1" height="1"/>` : '').join('');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" shape-rendering="crispEdges">${cells}</svg>`;
      vars.push(`--bayer-${k}:url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
    }
    const frames = (dir) => Array.from({ length: 17 }, (_, k) => {
      const level = dir > 0 ? k : 16 - k;
      return `${(k / 16 * 100).toFixed(2)}%{-webkit-mask-image:var(--bayer-${level});mask-image:var(--bayer-${level})}`;
    }).join('');
    const style = document.createElement('style');
    style.textContent = `:root{${vars.join(';')}}@keyframes bayer-in{${frames(1)}}@keyframes bayer-out{${frames(-1)}}`;
    document.head.append(style);
  }

  // ───────── steps ─────────
  function applySteps(el, step, animate) {
    el.dataset.step = String(step);
    const total = stepsOf(el);
    for (let k = 0; k < total; k++) el.classList.toggle(`ge-${k}`, step >= k);
    for (const node of el.querySelectorAll('[data-in],[data-out]')) {
      const from = node.dataset.in === undefined ? 0 : Number(node.dataset.in);
      const to = node.dataset.out === undefined ? Infinity : Number(node.dataset.out);
      const on = step >= from && step < to;
      const was = node.classList.contains('on');
      node.classList.toggle('on', on);
      if (on && !was && animate && from === step) {
        node.classList.remove('anim');
        void node.offsetWidth; // restart the entrance animation
        node.classList.add('anim');
      } else if (!animate) node.classList.remove('anim');
    }
  }

  function context(el, extra = {}) {
    return { el, id: el.id, step: state.step, steps: stepsOf(el), dir: state.dir, reduced: reduced(), talk: api, ...extra };
  }

  function show(index, step, { dir = 1, instant = false } = {}) {
    index = Math.max(0, Math.min(scenes.length - 1, index));
    const el = scenes[index];
    step = Math.max(0, Math.min(stepsOf(el) - 1, step));
    const prev = scenes[state.scene];
    const sceneChanged = !started || prev !== el;
    const animate = !instant && !reduced() && dir > 0;
    state.dir = dir;
    if (sceneChanged && started) {
      try { hooks()[prev.id]?.leave?.(context(prev)); } catch (e) { console.error(e); }
      prev.classList.remove('active');
      prev.inert = true;
      prev.setAttribute('aria-hidden', 'true');
      pauseMedia(prev);
      audio.stopAll();
      // A scene may ask to dissolve in over the one it replaces (the game world arriving).
      if (animate && el.dataset.enter === 'dissolve') {
        prev.classList.add('behind');
        setTimeout(() => prev.classList.remove('behind'), 1300);
      }
    }
    state.scene = index;
    state.step = step;
    if (sceneChanged) {
      for (const s of scenes) if (s !== el && s !== prev) s.classList.remove('active', 'behind');
      el.classList.remove('entering');
      el.classList.add('active');
      el.inert = false;
      el.removeAttribute('aria-hidden');
      if (animate) { void el.offsetWidth; el.classList.add('entering'); }
      deck.dataset.world = el.dataset.world || 'game';
      document.body.dataset.world = deck.dataset.world;
    }
    deck.classList.toggle('instant', !animate);
    applySteps(el, step, animate);
    const ctx = context(el, { instant: !animate, sceneChanged });
    try {
      if (sceneChanged) hooks()[el.id]?.enter?.(ctx);
      hooks()[el.id]?.update?.(ctx);
    } catch (e) { console.error(e); }
    // Warm up the next scene's heavy media while this one is on screen.
    const next = scenes[index + 1];
    if (next) try { hooks()[next.id]?.preload?.(context(next)); } catch (e) { console.error(e); }
    started = true;
    history.replaceState(null, '', `#${el.id}${step ? '/' + step : ''}`);
    updateChrome();
    publish();
  }

  function next() {
    const el = scenes[state.scene];
    if (state.step < stepsOf(el) - 1) show(state.scene, state.step + 1, { dir: 1 });
    else if (state.scene < scenes.length - 1) show(state.scene + 1, 0, { dir: 1 });
  }
  function prev() {
    if (state.step > 0) show(state.scene, state.step - 1, { dir: -1, instant: true });
    else if (state.scene > 0) show(state.scene - 1, stepsOf(scenes[state.scene - 1]) - 1, { dir: -1, instant: true });
  }
  function go(target, step = 0, opts = {}) {
    const index = typeof target === 'number' ? target : scenes.findIndex(s => s.id === target);
    if (index < 0) return;
    show(index, step === 'last' ? stepsOf(scenes[index]) - 1 : step, { dir: 1, instant: true, ...opts });
  }
  function replayStep() { show(state.scene, state.step, { dir: 1 }); }

  // ───────── media ─────────
  function pauseMedia(el) {
    el.querySelectorAll('video, audio').forEach(m => { try { m.pause(); } catch {} });
  }

  // ───────── audio (sound effects and music, local files) ─────────
  const audio = (() => {
    let ctx;
    const buffers = new Map();
    const playing = new Set();
    function context() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    async function load(name) {
      if (buffers.has(name)) return buffers.get(name);
      const promise = fetch(`assets/audio/${name}.mp3`).then(r => {
        if (!r.ok) throw new Error(`audio ${name}: ${r.status}`);
        return r.arrayBuffer();
      }).then(data => context().decodeAudioData(data));
      buffers.set(name, promise);
      return promise;
    }
    // Bumped by stopAll: a sound still loading when the scene changes or M is pressed never starts.
    let generation = 0;
    /** One-shot effect. Only after a gesture (any click or key press counts). */
    async function play(name, { volume = 0.8, rate = 1, delay = 0 } = {}) {
      if (state.muted || !navigator.userActivation?.hasBeenActive) return null;
      const c = context();
      if (!c) return null;
      const requested = { generation, scene: state.scene };
      try {
        const buffer = await load(name);
        if (state.muted || requested.generation !== generation || requested.scene !== state.scene) return null;
        const source = c.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = rate;
        const gain = c.createGain();
        gain.gain.value = volume;
        source.connect(gain).connect(c.destination);
        source.start(c.currentTime + delay);
        const handle = { source, gain, scene: scenes[state.scene].id };
        playing.add(handle);
        source.onended = () => playing.delete(handle);
        return handle;
      } catch (e) { console.warn(e); return null; }
    }
    function stopAll(fade = 0.12) {
      generation++;
      if (!ctx) return;
      for (const h of playing) {
        try { h.gain.gain.setTargetAtTime(0, ctx.currentTime, fade / 3); h.source.stop(ctx.currentTime + fade); } catch {}
      }
      playing.clear();
    }
    return { play, load, stopAll, context, get ctx() { return ctx; } };
  })();

  function setMuted(value) {
    state.muted = value;
    document.body.classList.toggle('muted', value);
    // Silent clips (the muted attribute, e.g. the MiniMax videos) stay muted; only sound-bearing media follow M.
    deck.querySelectorAll('audio, video').forEach(m => { m.muted = value || m.defaultMuted; });
    if (value) audio.stopAll();
    window.dispatchEvent(new CustomEvent('talk-mute', { detail: { muted: value } }));
    const b = document.getElementById('mute');
    if (b) b.textContent = value ? 'Sonido: no' : 'Sonido: sí';
    publish();
  }

  // ───────── chrome: controls, overview, help, black/white screens ─────────
  function updateChrome() {
    const el = scenes[state.scene];
    const counter = document.getElementById('counter');
    if (counter) counter.textContent = `${state.scene + 1}/${scenes.length} · ${state.step + 1}/${stepsOf(el)}`;
    document.getElementById('previous').disabled = state.scene === 0 && state.step === 0;
    document.getElementById('next').disabled = state.scene === scenes.length - 1 && state.step === stepsOf(el) - 1;
    document.querySelectorAll('#overview-list button').forEach((b, i) => b.classList.toggle('current', i === state.scene));
  }
  function toggleDialog(id, force) {
    const d = document.getElementById(id);
    const open = force ?? !d.open;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }
  function setScreen(kind) {
    state.black = kind === 'black' ? !state.black : false;
    state.white = kind === 'white' ? !state.white : false;
    document.body.classList.toggle('blackout', state.black);
    document.body.classList.toggle('whiteout', state.white);
    publish();
  }
  function openBackupVideo() {
    const d = document.getElementById('backup-video');
    audio.stopAll();
    toggleDialog('backup-video', true);
    const v = d.querySelector('video');
    v.muted = state.muted;
    v.play().catch(() => {});
  }
  const fullscreen = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {});
  const openPresenter = () => window.open('presenter.html', 'aoa-presenter', 'width=1280,height=860');

  function buildOverview() {
    const list = document.getElementById('overview-list');
    scenes.forEach((s, i) => {
      const b = document.createElement('button');
      const note = notes.find(n => n.id === s.id);
      b.innerHTML = `<span class="n">${String(i + 1).padStart(2, '0')}</span><span class="t"></span><span class="m">${note?.timing?.split(' · ')[0] ?? ''}</span>`;
      b.querySelector('.t').textContent = s.dataset.title || note?.title || s.id;
      b.onclick = () => { toggleDialog('overview', false); go(i, 0); };
      list.append(b);
    });
  }

  // Number typed then Enter jumps to that scene (PowerPoint habit), useful if a clicker misfires.
  let typed = '', typedTimer;
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest('input, select, textarea, [contenteditable]')) return;
    const key = e.key;
    if (document.querySelector('dialog[open]')) {
      if (key === 'Escape') return;
      if (key.toLowerCase() === 'o' || key === '?') { e.preventDefault(); document.querySelectorAll('dialog[open]').forEach(d => d.close()); }
      return;
    }
    // A typed number + Enter jumps, even if a control still has focus.
    if (/^[0-9]$/.test(key)) { typed += key; clearTimeout(typedTimer); typedTimer = setTimeout(() => typed = '', 1500); return; }
    if (key === 'Enter' && typed) { e.preventDefault(); go(Number(typed) - 1, 0); typed = ''; return; }
    if (e.target.closest('button, a, audio, video') && (key === ' ' || key === 'Enter')) return;
    switch (key) {
      case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': case 'Enter':
        e.preventDefault(); next(); break;
      case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace':
        e.preventDefault(); prev(); break;
      case 'Home': e.preventDefault(); go(0, 0); break;
      case 'End': e.preventDefault(); go(scenes.length - 1, 'last'); break;
      case 'f': case 'F': fullscreen(); break;
      case 'b': case 'B': case '.': setScreen('black'); break;
      case 'w': case 'W': case ',': setScreen('white'); break;
      case 'o': case 'O': toggleDialog('overview'); break;
      case 'p': case 'P': openPresenter(); break;
      case 'm': case 'M': setMuted(!state.muted); break;
      case 'r': case 'R': replayStep(); break;
      case '?': case 'h': case 'H': toggleDialog('help'); break;
      case 'v': case 'V': openBackupVideo(); break;
      case 'Escape': setScreen(null); break;
    }
  }

  // ───────── presenter channel ─────────
  function publish() {
    if (!channel || !started) return;
    const el = scenes[state.scene];
    const cues = cuesOf(el);
    const nextEl = scenes[state.scene + 1];
    channel.postMessage({
      type: 'state', scene: state.scene, id: el.id, step: state.step, steps: stepsOf(el), total: scenes.length,
      cue: cues[state.step] || '', nextCue: state.step < stepsOf(el) - 1 ? cues[state.step + 1] || `paso ${state.step + 2}` : null,
      nextScene: nextEl ? { id: nextEl.id, title: nextEl.dataset.title, cue: cuesOf(nextEl)[0] || '' } : null,
      muted: state.muted, black: state.black, white: state.white,
      scenes: scenes.map(s => ({ id: s.id, title: s.dataset.title, steps: stepsOf(s), cues: cuesOf(s) })),
    });
  }
  if (channel) channel.onmessage = ({ data }) => {
    if (data.type === 'hello') publish();
    else if (data.type === 'next') next();
    else if (data.type === 'prev') prev();
    else if (data.type === 'go') go(data.scene, data.step ?? 0);
    else if (data.type === 'black') setScreen('black');
    else if (data.type === 'white') setScreen('white');
    else if (data.type === 'mute') setMuted(!state.muted);
    else if (data.type === 'replay') replayStep();
  };

  // ───────── wiring ─────────
  const api = {
    next, prev, go, replayStep, audio, setMuted, reduced,
    get state() { return { ...state, id: scenes[state.scene].id, steps: stepsOf(scenes[state.scene]), total: scenes.length }; },
    scenes: scenes.map(s => ({ id: s.id, title: s.dataset.title, steps: stepsOf(s), cues: cuesOf(s) })),
  };
  window.talk = api;

  installBayer();
  buildOverview();
  document.getElementById('previous').onclick = prev;
  document.getElementById('next').onclick = next;
  document.getElementById('overview-toggle').onclick = () => toggleDialog('overview');
  document.getElementById('help-toggle').onclick = () => toggleDialog('help');
  document.getElementById('fullscreen').onclick = fullscreen;
  document.getElementById('presenter-open').onclick = openPresenter;
  document.getElementById('mute').onclick = () => setMuted(!state.muted);
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
  // Focus never stays on a control: a clicker's space or Enter must move the talk, not press a button again.
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('close', () => {
    d.querySelectorAll('video').forEach(v => v.pause());
    setTimeout(() => document.activeElement?.blur(), 0);
  }));
  document.getElementById('controls').addEventListener('click', e => { if (e.detail) e.target.closest('button')?.blur(); });
  document.addEventListener('keydown', onKey);
  let chromeTimer;
  const showChrome = () => { document.body.classList.add('chrome'); clearTimeout(chromeTimer); chromeTimer = setTimeout(() => document.body.classList.remove('chrome'), 2600); };
  document.addEventListener('pointermove', showChrome);
  document.addEventListener('touchstart', showChrome, { passive: true });
  // Swipe on touch screens; a plain click on the stage never advances (it may target a control).
  let touchX = null;
  deck.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
  deck.addEventListener('touchend', e => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 60) dx < 0 ? next() : prev();
    touchX = null;
  });
  window.addEventListener('resize', fit);
  window.addEventListener('hashchange', () => {
    const [id, step] = location.hash.slice(1).split('/');
    const index = scenes.findIndex(s => s.id === id);
    if (index >= 0 && (index !== state.scene || Number(step || 0) !== state.step)) go(index, Number(step) || 0);
  });
  document.addEventListener('visibilitychange', () => {
    const el = scenes[state.scene];
    try { hooks()[el.id]?.visibility?.(context(el, { hidden: document.hidden })); } catch (e) { console.error(e); }
    if (document.hidden) { pauseMedia(el); audio.stopAll(); }
  });
  motionQuery.addEventListener?.('change', () => show(state.scene, state.step, { instant: true }));
  if (params.get('motion') === 'reduce') document.documentElement.classList.add('reduce-motion');

  fit();
  const [hashId, hashStep] = location.hash.slice(1).split('/');
  const startIndex = Math.max(0, scenes.findIndex(s => s.id === hashId));
  // Scene hooks may load after this file; start once the document is parsed.
  const start = () => { show(startIndex, Number(hashStep) || 0, { instant: true }); showChrome(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
