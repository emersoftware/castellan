/* Por y para agentes · DevDay Concepción 2026 — what each scene does.
 *
 * slides.js calls enter / update / leave with the scene's current step; every hook draws the
 * state of that step, so going back and forth always shows the same thing. Animations run only
 * while their scene is on screen (one requestAnimationFrame loop per active scene).
 *
 * One look everywhere: canvases are drawn in "key" colours at 2 design px per pixel and then go
 * through rampDither, a CPU copy of the game's dither shader (packages/web/src/render/dither.ts).
 * Sprite canvases are dithered at atlas resolution and shown at 2 design px per atlas pixel, the
 * same cell. Sprites, atlases, sounds and music are the game's own files (assets/). Board clips
 * are recorded matches drawn by the game's renderer (game.js).
 */
(() => {
  const talk = window.talk;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const scenes = {};
  window.TalkScenes = scenes;
  /** The game's name lives once, in the HTML of scene 3. */
  const GAME_NAME = $('[data-game-name]')?.textContent.trim() || '';

  // ═════════════ palette (packages/web/src/render/palette.ts) ═════════════
  const RAMPS = {
    teamA: ['#000000', '#2d63c8', '#b4dcff'], teamB: ['#000000', '#d24a1c', '#ffcaa0'],
    teamC: ['#000000', '#23a19a', '#b0fff4'], teamD: ['#000000', '#8e3fc4', '#eec4ff'],
    terrain: ['#000000', '#3f8a33', '#8fcf5a'], mineral: ['#000000', '#b88a12', '#ffe98a'],
    fire: ['#1e1e1e', '#a4a4a4', '#ffffff'], neutral: ['#000000', '#8c8c8c', '#ffffff'],
  };
  const TEAM = [RAMPS.teamA, RAMPS.teamB, RAMPS.teamC, RAMPS.teamD];
  const TEAM_LIGHT = TEAM.map(r => r[2]), TEAM_MID = TEAM.map(r => r[1]);
  /** Key colours: what the renderer tints with; rampDither reads them back (palette.ts `key`). */
  const KEY = { teamA: [0, 0, 255], teamB: [255, 0, 0], teamC: [0, 255, 255], teamD: [255, 0, 255], terrain: [0, 255, 0], mineral: [255, 255, 0], neutral: [255, 255, 255] };
  const TEAM_KEY = [KEY.teamA, KEY.teamB, KEY.teamC, KEY.teamD];
  /** A key colour at brightness L (0…1), as a CSS colour for fillStyle. */
  const keyed = (key, L) => `rgb(${Math.round(key[0] * L)},${Math.round(key[1] * L)},${Math.round(key[2] * L)})`;
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const RAMP_RGB = Object.fromEntries(Object.entries(RAMPS).map(([k, r]) => [k, r.map(rgb)]));

  /** The game's three-tone ordered dither on one ramp (src/render/cpuDither.ts). */
  function ditherPixels(d, w, h, ramp, lift = 1) {
    const steps = ramp.map(rgb);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 128) { d[i + 3] = 0; continue; }
      const L = Math.max(d[i], d[i + 1], d[i + 2]) / 255 * lift;
      const t = (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16;
      const scaled = Math.min(1, Math.max(0, L)) * 2;
      const lower = Math.floor(scaled);
      const k = Math.min(2, lower + (scaled - lower >= t ? 1 : 0));
      d[i] = steps[k][0]; d[i + 1] = steps[k][1]; d[i + 2] = steps[k][2]; d[i + 3] = 255;
    }
  }
  /** The renderer's dither pass (dither.ts): classify each pixel's key, dither its brightness on that ramp. */
  function rampDither(ctx, w, h) {
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 3) { d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = 255; continue; }
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const L = Math.max(r, g, b);
      let ramp;
      if (L < 0.0001) ramp = RAMP_RGB.neutral;
      else {
        const nr = r / L, ng = g / L, nb = b / L;
        if (nr > 0.9 && ng > 0.32 && ng < 0.6 && nb < 0.15) ramp = RAMP_RGB.fire;
        else if (nr > 0.6 && ng > 0.6 && nb > 0.6) ramp = RAMP_RGB.neutral;
        else if (nr > 0.6 && ng > 0.6) ramp = RAMP_RGB.mineral;
        else if (ng > 0.6 && nb > 0.6) ramp = RAMP_RGB.teamC;
        else if (nr > 0.6 && nb > 0.6) ramp = RAMP_RGB.teamD;
        else if (nb >= nr && nb >= ng) ramp = RAMP_RGB.teamA;
        else if (nr >= ng) ramp = RAMP_RGB.teamB;
        else ramp = RAMP_RGB.terrain;
      }
      const scaled = Math.min(1, L) * 2, lower = Math.floor(scaled);
      const k = Math.min(2, lower + (scaled - lower >= (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16 ? 1 : 0));
      const c = ramp[k];
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  /** Character atlases share shadow/midtone/highlight targets (src/render/characterContrast.ts). */
  function normalizeCharacterContrast(pixels) {
    const histogram = new Uint32Array(256);
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) { if (pixels[i + 3] < 200) continue; histogram[pixels[i]]++; count++; }
    if (!count) return;
    const percentile = f => { let total = 0; for (let v = 0; v < 256; v++) { total += histogram[v]; if (total >= count * f) return v; } return 255; };
    const low = percentile(0.05), high = percentile(0.95);
    if (high - low < 16) return;
    const middle = Math.max(low + 1, Math.min(high - 1, percentile(0.5)));
    const curve = new Uint8Array(256);
    for (let v = 0; v < 256; v++) {
      const m = v < low ? v / Math.max(1, low) * 24 : v < middle ? 24 + (v - low) / (middle - low) * 104
        : v < high ? 128 + (v - middle) / (high - middle) * 104 : 232 + (v - high) / Math.max(1, 255 - high) * 23;
      curve[v] = Math.round(m);
    }
    for (let i = 0; i < pixels.length; i += 4) { if (!pixels[i + 3]) continue; pixels[i] = pixels[i + 1] = pixels[i + 2] = curve[pixels[i]]; }
  }

  // ═════════════ the interface dither filter (#aoa-dither, #aoa-dither-soft) ═════════════
  // Same construction as DitherDefs.tsx, but each Bayer cell is 2 design px, like every canvas.
  function buildDitherFilters() {
    const NS = 'http://www.w3.org/2000/svg';
    const dpr = window.devicePixelRatio || 1;
    const unit = parseFloat(getComputedStyle(document.documentElement).fontSize) / 10 || 1;
    const cell = Math.max(1, Math.round(unit * dpr * 2)) / dpr;
    for (const [id, soft] of [['aoa-dither', false], ['aoa-dither-soft', true]]) {
      const f = document.getElementById(id);
      if (!f) continue;
      f.replaceChildren();
      const el = (name, attrs) => { const n = document.createElementNS(NS, name); for (const k in attrs) n.setAttribute(k, attrs[k]); f.append(n); return n; };
      BAYER.forEach((v, i) => {
        const g = Math.round(((v + 0.5) / 16) * 255);
        el('feFlood', { 'flood-color': `rgb(${g},${g},${g})`, x: (i % 4) * cell, y: Math.floor(i / 4) * cell, width: cell, height: cell, result: `b${i}` });
      });
      const merge = el('feMerge', { x: 0, y: 0, width: 4 * cell, height: 4 * cell, result: 'cell' });
      BAYER.forEach((_, i) => { const n = document.createElementNS(NS, 'feMergeNode'); n.setAttribute('in', `b${i}`); merge.append(n); });
      el('feTile', { in: 'cell', x: 0, y: 0, width: '100%', height: '100%', result: 'bayer' });
      if (soft) {
        const t = el('feComponentTransfer', { in: 'SourceGraphic', result: 'dim' });
        for (const c of ['R', 'G', 'B']) { const fn = document.createElementNS(NS, `feFunc${c}`); fn.setAttribute('type', 'linear'); fn.setAttribute('slope', '0.9'); t.append(fn); }
      }
      // A lighter screen than the game's (0.25) and edges kept, not cut: thin strokes stay readable at 1x on any display.
      el('feComposite', { in: soft ? 'dim' : 'SourceGraphic', in2: 'bayer', operator: 'arithmetic', k1: 0, k2: 0.85, k3: 0.15, k4: 0 });
      const q = el('feComponentTransfer', {});
      for (const c of ['R', 'G', 'B']) { const fn = document.createElementNS(NS, `feFunc${c}`); fn.setAttribute('type', 'discrete'); fn.setAttribute('tableValues', '0 0.33 0.66 1'); q.append(fn); }
      const fa = document.createElementNS(NS, 'feFuncA'); fa.setAttribute('type', 'discrete'); fa.setAttribute('tableValues', '0 1 1 1'); q.append(fa);
    }
  }
  buildDitherFilters();
  window.addEventListener('talk-resize', buildDitherFilters);

  /** Everything on stage goes through the game's dither: text and logos. Canvases and clips dither themselves,
   *  photos, screenshots and videos are shown as they are, and the QR has to scan; nothing is filtered twice. */
  function ditherEverything() {
    const own = el => el.matches('.dither, .dither-soft') || getComputedStyle(el).filter.includes('dither');
    const AS_IS = 'canvas, .clip, .qr, video, img.hf, img:not([src*="assets/brand/"])';
    const skip = el => el.matches(AS_IS + ', script, style') || own(el);
    const blocked = el => [...el.querySelectorAll('*')].some(d => d.matches(AS_IS) || own(d));
    const walk = (el, cls) => {
      for (const n of [...el.childNodes]) {
        if (n.nodeType === 3 && n.textContent.trim() && el.matches(':not(.scene)')) { const w = document.createElement('span'); w.className = cls; n.replaceWith(w); w.append(n); continue; }
        if (n.nodeType !== 1 || skip(n)) continue;
        if (blocked(n)) walk(n, cls); else n.classList.add(cls);
      }
    };
    // The dither starts with the game: the white intro (Revi, the work) stays as it is.
    for (const scene of document.querySelectorAll('#deck .scene:not(.white)')) walk(scene, 'dither-soft');
  }
  ditherEverything();

  // ═════════════ canvas helpers ═════════════
  /** Design px → current CSS px. */
  const unitPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) / 10 || 1;
  /** Device pixels for `design` design px, rounded to whole device pixels. */
  const chunk = (design = 2) => Math.max(1, Math.round(unitPx() * (window.devicePixelRatio || 1) * design));
  /** Size a canvas to its layout box at 2 design px per canvas pixel: the game's dither cell. */
  function pixelCanvas(canvas, px = chunk(2)) {
    const dpr = window.devicePixelRatio || 1;
    const box = canvas.getBoundingClientRect();
    const w = Math.max(8, Math.floor(box.width * dpr / px)), h = Math.max(8, Math.floor(box.height * dpr / px));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    return { ctx, w, h, px, dpr };
  }

  const images = new Map();
  function loadImage(src) {
    if (!images.has(src)) images.set(src, new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`image ${src}`));
      img.src = src;
    }));
    return images.get(src);
  }
  const jsons = new Map();
  function loadJSON(src) {
    if (!jsons.has(src)) jsons.set(src, fetch(src).then(r => { if (!r.ok) throw new Error(`${src}: ${r.status}`); return r.json(); }));
    return jsons.get(src);
  }

  /** With reduced motion every drawing holds one representative moment (8 s into its loop). */
  const FROZEN_T = 8;
  /** One animation loop per scene: started by enter, cancelled by leave. With reduced motion time
   *  stands still; the loop only repaints a few times per second so late-loading art still appears. */
  function sceneLoop(state, fn) {
    cancelAnimationFrame(state.raf);
    const t0 = performance.now();
    let lastStill = -Infinity;
    const tick = now => {
      if (!state.active) return;
      const still = talk.reduced();
      if (!still || now - lastStill > 250) {
        lastStill = now;
        try { fn(still ? FROZEN_T : (now - t0) / 1000, now); } catch (e) { console.error(e); state.active = false; return; }
      }
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
  }
  function stopLoop(state) { state.active = false; cancelAnimationFrame(state.raf); }
  const ease = t => t < 0 ? 0 : t > 1 ? 1 : 1 - Math.pow(1 - t, 3);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ═════════════ sprites ═════════════
  const manifests = {};
  async function atlasManifest(kind) {
    if (!manifests[kind]) manifests[kind] = loadJSON(`assets/atlas/${kind}/manifest.json`);
    return manifests[kind];
  }
  const ROWS = ['s', 'se', 'e', 'ne', 'n'];
  /** Crop every frame to the union of what is drawn, so sprites line up by their feet. */
  function trim(anim) {
    const W = anim.frames[0].width, H = anim.frames[0].height;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (const c of anim.frames) {
      const d = c.getContext('2d').getImageData(0, 0, W, H).data;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return anim;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    anim.frames = anim.frames.map(c => { const o = document.createElement('canvas'); o.width = w; o.height = h; o.getContext('2d').drawImage(c, -x0, -y0); return o; });
    anim.anchorX = (anim.anchorX * W - x0) / w; anim.anchorY = (anim.anchorY * H - y0) / h;
    return anim;
  }
  /** Grey frames (characters contrast-normalized) of one action and direction, before any tint. */
  async function greyFrames(kind, action, dir = 's') {
    if (kind === 'mineral' || kind === 'wall' || kind === 'door') {
      // Static art at the atlases' 3× stored scale: deposits rasterize to 96 px (sprites/manifest.json),
      // walls and doors are 103 px wide.
      const src = { mineral: 'assets/atlas/minerals-full.png', wall: 'assets/sprites-hi/wall.png', door: 'assets/sprites-hi/door.svg' }[kind];
      const img = await loadImage(src);
      const [w, h] = kind === 'mineral' ? [96, 72] : [103, 108];
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, w, h);
      return { frames: [c], fps: 1, loop: true, anchorX: 0.5, anchorY: kind === 'mineral' ? 0.68 : 0.75 };
    }
    const manifest = await atlasManifest(kind);
    const spec = manifest[action];
    if (!spec) throw new Error(`${kind} has no ${action}`);
    const img = await loadImage(`assets/atlas/${kind}/${spec.image}`);
    const W = spec.frameWidth, H = spec.frameHeight;
    let row = 0, flip = false;
    if (spec.directions) { const d = spec.directions[dir] ?? spec.directions.s; row = d.row; flip = d.flip; }
    const full = document.createElement('canvas'); full.width = img.width; full.height = img.height;
    const fx = full.getContext('2d', { willReadFrequently: true }); fx.drawImage(img, 0, 0);
    if (['knight', 'archer', 'worker', 'king'].includes(kind)) { const data = fx.getImageData(0, 0, full.width, full.height); normalizeCharacterContrast(data.data); fx.putImageData(data, 0, 0); }
    const frames = [];
    for (let i = 0; i < spec.frameCount; i++) {
      const cols = spec.columns ?? spec.frameCount;
      const sx = (spec.columns ? i % cols : i) * W, sy = (spec.columns ? Math.floor(i / cols) : row) * H;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      if (flip) { x.translate(W, 0); x.scale(-1, 1); }
      x.drawImage(full, sx, sy, W, H, 0, 0, W, H);
      frames.push(c);
    }
    const r = ROWS.indexOf(spec.directions?.[dir] ? ROWS[spec.directions[dir].row] : dir);
    return { frames, fps: spec.fps, loop: spec.loop, anchorX: spec.anchorX, anchorY: spec.anchorY,
      impact: (spec.impactFrames ?? spec.releaseFrames)?.[Math.max(0, r)] };
  }
  const frameCache = new Map();
  /** Dithered frames on one ramp, trimmed: [canvas]. Mineral is neutral (white), like the renderer's deposits. */
  function spriteFrames(kind, action, dir = 's', ramp = TEAM[0]) {
    if (kind === 'mineral') ramp = RAMPS.neutral;
    const key = `d:${kind}:${action}:${dir}:${ramp.join()}`;
    if (!frameCache.has(key)) frameCache.set(key, greyFrames(kind, action, dir).then(a => {
      const frames = a.frames.map(src => {
        const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
        const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0);
        const data = x.getImageData(0, 0, c.width, c.height); ditherPixels(data.data, c.width, c.height, ramp); x.putImageData(data, 0, 0);
        return c;
      });
      return trim({ ...a, frames });
    }));
    return frameCache.get(key);
  }
  /** Frames tinted with a key colour, undithered: drawn at any size into a canvas that rampDither finishes. */
  function keyedFrames(kind, action, dir = 's', key = KEY.teamA) {
    const id = `k:${kind}:${action}:${dir}:${key.join()}`;
    if (!frameCache.has(id)) frameCache.set(id, greyFrames(kind, action, dir).then(a => {
      const frames = a.frames.map(src => {
        const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
        const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0);
        const data = x.getImageData(0, 0, c.width, c.height), d = data.data;
        for (let i = 0; i < d.length; i += 4) { const g = Math.max(d[i], d[i + 1], d[i + 2]) / 255; d[i] = key[0] * g; d[i + 1] = key[1] * g; d[i + 2] = key[2] * g; d[i + 3] = d[i + 3] > 110 ? 255 : 0; }
        x.putImageData(data, 0, 0);
        return c;
      });
      return trim({ ...a, frames });
    }));
    return frameCache.get(id);
  }
  /** Draw one keyed frame with its anchor at (x, y), `scale` canvas px per atlas px. */
  function putFrame(ctx, anim, f, x, y, scale = 1) {
    const fr = anim.frames[((f % anim.frames.length) + anim.frames.length) % anim.frames.length];
    const fw = fr.width * scale, fh = fr.height * scale;
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.drawImage(fr, Math.round(x - fw * anim.anchorX), Math.round(y - fh * anim.anchorY), Math.round(fw), Math.round(fh));
  }

  /** Canvases with data-sprite="kind:action:dir:player": 2 design px per atlas pixel, all of them,
   *  so a castle and a knight keep the sizes they have in the game. */
  function sizeSprite(item) {
    const a = item.anim;
    if (!a) return;
    const W = a.frames[0].width, H = a.frames[0].height;
    const dpr = window.devicePixelRatio || 1;
    const k = chunk(2);
    if (item.canvas.width !== W || item.canvas.height !== H) { item.canvas.width = W; item.canvas.height = H; }
    item.canvas.style.width = (W * k / dpr) + 'px';
    item.canvas.style.height = (H * k / dpr) + 'px';
    item.ctx = item.canvas.getContext('2d');
    item.lastFrame = -1;
  }
  function setupSprites(root, state) {
    const items = $$('canvas[data-sprite]', root).map(canvas => ({ canvas, ready: null }));
    for (const item of items) {
      const [kind, action = 'idle', dir = 's', player = '0'] = item.canvas.dataset.sprite.split(':');
      item.kind = kind; item.action = action;
      item.ready = spriteFrames(kind, action, dir, TEAM[Number(player)] ?? TEAM[0])
        .then(anim => { item.anim = anim; sizeSprite(item); })
        .catch(e => console.warn(e));
    }
    state.sprites = items;
  }
  window.addEventListener('talk-resize', () => { for (const sc of Object.values(scenes)) for (const item of sc.sprites?.() ?? []) sizeSprite(item); });
  /** Frame index of a sprite item at scene time t (loops, holds between plays, or plays once). */
  function spriteFrameAt(item, t) {
    const a = item.anim;
    const hold = Number(item.canvas.dataset.hold || 400) / 1000;
    const lt = item.startAt && !talk.reduced() ? (performance.now() - item.startAt) / 1000 : t;
    const n = a.frames.length;
    if (a.loop) return ((Math.floor(lt * a.fps) % n) + n) % n;
    if (item.canvas.dataset.once !== undefined) return clamp(Math.floor(lt * a.fps), 0, a.frames.length - 1);
    const cycle = a.frames.length / a.fps + hold;
    return clamp(Math.floor((((lt % cycle) + cycle) % cycle) * a.fps), 0, n - 1);
  }
  function drawSprites(state, t) {
    for (const item of state.sprites || []) {
      const a = item.anim;
      if (!a || !item.ctx) continue;
      const el = item.canvas.closest('[data-in],[data-out]');
      if (el && !el.classList.contains('on')) continue;
      const f = spriteFrameAt(item, t);
      if (item.lastFrame === f || !a.frames[f]) { if (!a.frames[f]) console.warn('frame', item.canvas.dataset.sprite, f, a.frames.length); continue; }
      item.prevFrame = item.lastFrame;
      item.lastFrame = f;
      item.ctx.clearRect(0, 0, item.canvas.width, item.canvas.height);
      item.ctx.drawImage(a.frames[f], 0, 0);
      item.onFrame?.(f, item.prevFrame);
    }
  }

  // ═════════════ board clips (game.js: the game's renderer) ═════════════
  // ═════════════ who played each match on screen ═════════════
  /** Model · harness · effort for every player of every match the deck shows, by match id and player id.
   *  Recorded player names are kept in each clip; missing overrides use those names. */
  const CC = 'Claude Code', CX = 'Codex', DSH = 'DeepSeek Harness';
  const MATCH_PLAYERS = {
    'a21dc6cf': { p1: `Opus 5.5 · ${CC} · low`, p2: `Sol 6.1 · ${CX} · low`, p3: `Fable 5.1 · ${CC} · low`, p4: `Astra 6 · ${CX} · low` },
    '796f00b9': { p1: `Opus 5.5 · ${CC} · low`, p2: `DeepSeek Flash · ${DSH} · low`, p3: `Opus 5.5 · ${CC} · low`, p4: `DeepSeek Flash · ${DSH} · low` },
    '1b4b65c9': { p1: `Opus 5.5 · ${CC} · low`, p2: `Sol 6.1 · ${CX} · low` },
    'bd6acba5': { p1: `Opus 5.5 · ${CC} · low`, p2: `Opus 5.5 · ${CC} · low`, p3: `Opus 5.5 · ${CC} · low`, p4: `Opus 5.5 · ${CC} · low` },
    '9463fc7e': { p1: `Fable 5.1 · ${CC} · low`, p2: `Astra 6 · ${CX} · low` },
    '77e80cf4': { p1: `Opus 5.5 · ${CC} · low`, p2: `Opus 5.5 · ${CC} · low`, p3: `Opus 5.5 · ${CC} · low`, p4: `Opus 5.5 · ${CC} · low` },
    '346f9d24': { p1: `Sol 6.1 · ${CX} · low`, p2: `Sol 6.1 · ${CX} · low`, p3: `Sol 6.1 · ${CX} · low`, p4: `Sol 6.1 · ${CX} · low` },
    // The first duel (26 Sep): Fable on the account's default effort; Codex ran with no effort set.
    '25fe89ae': { p1: `Fable 5.1 · ${CC} · high`, p2: `Astra 6 · ${CX}` },
    '2346f20b': { p1: `Opus 5.5 · ${CC} · low`, p2: `Fable 5.1 · ${CC} · low`, p3: `Sol 6.1 · ${CX} · low`, p4: `Astra 6 · ${CX} · low` },
    '02eb6795': { p1: `Opus 5.5 · ${CC} · low`, p2: `Sol 6.1 · ${CX} · low`, p3: `Fable 5.1 · ${CC} · low`, p4: `Astra 6 · ${CX} · low` },
  };
  const playerLabel = (matchId, p) => MATCH_PLAYERS[String(matchId).slice(0, 8)]?.[p.id] ?? p.name;
  const clipMeta = new Map();
  /** Every clip says who is playing, in the players' colours; #game and #teaser carry their own score panel, and #pov has no room for it. */
  async function legend(el) {
    if (el.closest('#game, #teaser, #pov') || el.dataset.legend === 'off') return;
    const url = el.dataset.clip;
    if (!clipMeta.has(url)) clipMeta.set(url, fetch(url).then(r => r.json()).then(d => ({ id: d.id, players: d.players })).catch(() => null));
    const meta = await clipMeta.get(url);
    if (!meta || $('.clip-legend', el)) return;
    const ul = document.createElement('ul');
    ul.className = 'clip-legend';
    const players = meta.players?.length ? meta.players : Object.keys(MATCH_PLAYERS[String(meta.id).slice(0, 8)] ?? {}).map(id => ({ id, name: id }));
    if (!players.length) return;
    ul.innerHTML = players.map((p, i) => `<li><span class="swatch bg${i % 4}"></span>${playerLabel(meta.id, p)}</li>`).join('');
    el.append(ul);
  }

  const clips = (() => {
    const live = new Map(); // element → controller (or promise)
    /** A clip lives only while its scene is on screen and the step block that holds it is shown. */
    function want(el) {
      if (!el.closest('.scene.active')) return false;
      for (let node = el; node && !node.classList.contains('scene'); node = node.parentElement) {
        if ((node.hasAttribute('data-in') || node.hasAttribute('data-out')) && !node.classList.contains('on')) return false;
      }
      return true;
    }
    function waitForRenderer() {
      return new Promise(resolve => {
        if (window.AOA) return resolve();
        window.addEventListener('aoa-ready', resolve, { once: true });
        setTimeout(resolve, 4000);
      });
    }
    function mount(el, scene) {
      if (live.has(el)) return live.get(el).promise;
      // Registered synchronously: enter and update in the same tick never mount the clip twice.
      const entry = { promise: null, controller: null, cancelled: false };
      live.set(el, entry);
      entry.promise = (async () => {
        if (!window.AOA) await waitForRenderer();
        if (entry.cancelled) return null;
        if (!window.AOA || location.protocol === 'file:') { live.delete(el); fallback(el, 'Abre la presentación con iniciar.command para ver el replay.'); return null; }
        const onTick = (frame, controller) => { banner(el, frame); scene.onClipTick?.(frame, controller); };
        const controller = await window.AOA.mountClip(el, el.dataset.clip, {
          focus: el.dataset.focus || 'map', loop: el.dataset.loop !== 'false', pixel: chunk(Number(el.dataset.pixel || 2)) / (window.devicePixelRatio || 1),
          reduced: talk.reduced(), onTick, onSound: (name, pan, volume) => scene.onClipSound?.(name, pan, volume),
        });
        entry.controller = controller;
        if (entry.cancelled || !want(el)) { controller.destroy(); if (live.get(el) === entry) live.delete(el); return null; }
        legend(el);
        scene.onClipReady?.(el, controller);
        return controller;
      })().catch(error => { console.error(error); if (live.get(el) === entry) live.delete(el); fallback(el, 'No se pudo dibujar el replay aquí · V abre el video de respaldo'); return null; });
      return entry.promise;
    }
    /** When a clip reaches the end of its match, say how it ended, from the frame's own outcome. */
    function banner(el, frame) {
      if (!el.dataset.banner) return;
      let b = $('.clip-banner', el);
      const outcome = frame.status === 'finished' ? frame.outcome : null;
      if (!outcome) { b?.remove(); return; }
      if (b) return;
      b = document.createElement('p'); b.className = 'clip-banner';
      if (outcome.winner) b.innerHTML = `Gana ${outcome.winner}<small>cae el último rey rival</small>`;
      else if (outcome.reason === 'timeout' && outcome.allDefeated) { b.classList.add('lose'); b.innerHTML = 'Tiempo · todos pierden'; }
      else if (outcome.reason === 'timeout') b.innerHTML = 'Tiempo · empate';
      else return;
      el.append(b);
    }
    function fallback(el, message) {
      if ($('.clip-status', el)) return;
      const p = document.createElement('p'); p.className = 'clip-status'; p.textContent = message; el.append(p);
    }
    function sync(root, scene) {
      for (const el of $$('[data-clip]', root)) {
        if (want(el)) mount(el, scene);
        else release(el);
      }
    }
    function release(el) {
      const entry = live.get(el);
      if (!entry) return;
      entry.cancelled = true;
      entry.controller?.destroy();
      live.delete(el);
    }
    function releaseAll(root) { for (const el of $$('[data-clip]', root)) release(el); }
    function controllers(root) { return $$('[data-clip]', root).map(el => live.get(el)?.controller).filter(Boolean); }
    function preload(root) { for (const el of $$('[data-clip]', root)) window.AOA?.preload?.(el.dataset.clip); }
    return { sync, releaseAll, controllers, preload };
  })();

  /** Clips start by themselves unless motion is reduced (then they wait for their play button). */
  const autoPlay = clip => { if (!talk.reduced()) clip.play(); };

  // ═════════════ generic scene wrapper ═════════════
  /** Wraps a scene definition with sprites, clips and a frame loop. Clips play by themselves. */
  function define(id, def) {
    const state = { active: false, raf: 0, step: 0 };
    const clipHooks = { onClipReady: (el, clip) => { autoPlay(clip); def.onClipReady?.(el, clip); }, onClipTick: (f, c) => def.onClipTick?.(f, c), onClipSound: (n, p, v) => def.onClipSound?.(n, p, v) };
    scenes[id] = {
      sprites: () => state.sprites || [],
      enter(ctx) {
        state.active = true; state.step = ctx.step; state.dir = ctx.dir; state.instant = ctx.instant; state.reduced = ctx.reduced;
        state.entered = performance.now(); state.stepAt = state.entered;
        if (!state.setup) { state.setup = true; setupSprites(ctx.el, state); def.setup?.(ctx, state); }
        def.enter?.(ctx, state);
        clips.sync(ctx.el, clipHooks);
        sceneLoop(state, (t, now) => { drawSprites(state, t); def.frame?.(t, state, now); });
      },
      update(ctx) {
        const changed = state.step !== ctx.step;
        state.step = ctx.step; state.dir = ctx.dir; state.instant = ctx.instant; state.reduced = ctx.reduced;
        if (changed || ctx.sceneChanged) state.stepAt = performance.now();
        def.update?.(ctx, state);
        clips.sync(ctx.el, clipHooks);
      },
      leave(ctx) {
        stopLoop(state);
        def.leave?.(ctx, state);
        clips.releaseAll(ctx.el);
      },
      // While the previous scene is on screen: decode and dither this scene's art, fetch its clips.
      preload(ctx) {
        if (!state.setup) { state.setup = true; setupSprites(ctx.el, state); def.setup?.(ctx, state); }
        def.preload?.(ctx, state); clips.preload(ctx.el);
      },
      visibility(ctx) { for (const c of clips.controllers(ctx.el)) c.setPaused(ctx.hidden); },
    };
    return state;
  }
  /** Seconds since the current step began (99 when arriving by going back: final state at once). */
  const sinceStep = state => state.instant || state.reduced ? 99 : (performance.now() - (state.stepAt || state.entered)) / 1000;

  /** Terrain the way the map draws it: dim grass, mostly black showing through. */
  function grass(ctx, x0, y0, w, h, t = 0, inside = () => true) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      if (!inside(x, y)) continue;
      const n = 0.3 + 0.1 * Math.sin(x * 0.21 + t * 0.4) * Math.cos(y * 0.33 - t * 0.25) + 0.05 * Math.sin((x + y) * 0.09);
      ctx.fillStyle = keyed(KEY.terrain, n); ctx.fillRect(x, y, 1, 1);
    }
  }

  // ═════════════ 1 · intro ═════════════
  define('intro', {
    setup(ctx) {
      const dots = $('[data-hook="reach-dots"]', ctx.el);
      dots.innerHTML = Array.from({ length: 75 }, () => '<i></i>').join('');
    },
    update(ctx, s) {
      const dots = $$('[data-hook="reach-dots"] i', ctx.el);
      clearTimeout(s.dotTimer);
      if (ctx.step < 3) { dots.forEach(d => d.classList.remove('on')); return; }
      if (ctx.instant || ctx.reduced || ctx.step > 3) { dots.forEach((d, i) => d.classList.toggle('on', i < 17)); return; }
      dots.forEach(d => d.classList.remove('on'));
      let i = 0;
      const fill = () => { if (i < 17) { dots[i++].classList.add('on'); s.dotTimer = setTimeout(fill, 55); } };
      s.dotTimer = setTimeout(fill, 380);
    },
    frame(t, s) {
      if (s.step < 4) return;
      // A window into the game world opening in the white page: the map's diamond of grass.
      const { ctx, w, h } = pixelCanvas($('#intro [data-hook="portal"]'));
      const open = s.reduced ? 1 : ease(sinceStep(s) / 1.4);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2;
      grass(ctx, 0, 0, w, h, t, (x, y) => Math.abs(x - cx) / R + Math.abs(y - cy) / (R * 0.62) <= open);
      rampDither(ctx, w, h);
      // Outside the diamond stays white: the page.
      const img = ctx.getImageData(0, 0, w, h), d = img.data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.abs(x - cx) / R + Math.abs(y - cy) / (R * 0.62) > open) d[(y * w + x) * 4 + 3] = 0;
      ctx.putImageData(img, 0, 0);
    },
  });

  // ═════════════ 2 · cover ═════════════
  define('cover', {
    async setup(ctx, s) { s.photo = await loadImage('assets/portada-reyes-v11.png').catch(() => null); },
    enter(ctx, s) { s.slashAt = ctx.step >= 1 && !ctx.instant ? performance.now() : 0; s.photoAt = null; },
    update(ctx, s) {
      if (ctx.step >= 1 && !ctx.instant && ctx.dir > 0) {
        s.slashAt = performance.now();
        talk.audio.play('sword-1', { volume: 0.9 });
      }
      if (ctx.step === 0) s.slashAt = 0;
    },
    frame(t, s) {
      const canvas = $('#cover [data-hook="cover-photo"]');
      // The photo is dithered once per size: the game's ramps, 2 design px per cell.
      const key = s.photo && `${canvas.clientWidth}x${canvas.clientHeight}`;
      if (key && s.photoAt !== key) { s.photoAt = key; drawPhoto(canvas, s.photo); }
      drawSlash($('#cover [data-hook="slash"]'), $('#cover .slash-word'), s);
    },
  });
  /** The painting the way the game draws units: no colours of its own, only brightness on a player's ramp.
   *  Each pixel picks a ramp by its tint (warm → Claude's embers, cool → Codex's blue) and its side of
   *  the duel; nothing is grey. */
  /** Codex's low sword in the painting (portada-reyes-v11.png, px at 1672 wide): tip to hilt. */
  const CODEX_BLADE = [640, 709, 950, 612];
  function nearSegment(px, py, [ax, ay, bx, by], r) {
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - ax - dx * t, py - ay - dy * t) < r;
  }
  function drawPhoto(canvas, img) {
    const { ctx, w, h } = pixelCanvas(canvas);
    const fit = Math.max(w / img.width, h / img.height), dw = img.width * fit, dh = img.height * fit;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    const data = ctx.getImageData(0, 0, w, h), d = data.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      const luma = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
      // Clear team colours decide (red-orange is Claude, blue is Codex); steel and gold follow the side they stand on.
      // Steel and gold follow the side they stand on; Codex's low blade crosses into Claude's half and stays his.
      const ix = (x - (w - dw) / 2) / dw * 1672, iy = (y - (h - dh) / 2) / dw * 1672;
      const split = nearSegment(ix, iy, CODEX_BLADE, 11) ? 0 : 0.52;
      const side = split - (x - (w - dw) / 2) / dw;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
      const hue = mx === mn ? -1 : mx === r ? 60 * (((g - b) / (mx - mn) + 6) % 6) : mx === g ? 60 * ((b - r) / (mx - mn) + 2) : 60 * ((r - g) / (mx - mn) + 4);
      // Grass (olive to green, about 52°) keeps the map's terrain ramp; above the horizon only strong green counts, so steel reflections stay steel.
      const ramp = sat > (iy > 735 ? 0.2 : 0.6) && hue >= 46 && hue <= 170 ? RAMP_RGB.terrain
        : sat > 0.35 && hue >= 190 && hue <= 280 && side < 0.08 ? RAMP_RGB.teamA
        : sat > 0.55 && (hue < 20 || hue > 330) && side > -0.08 ? RAMP_RGB.teamB
        : side + (r - b) / 255 * 0.15 > 0 ? RAMP_RGB.teamB : RAMP_RGB.teamA;
      // Black point: the dark backdrop goes to the map's black, like unexplored ground.
      const lit = Math.max(0, (luma - 0.16) / 0.84);
      const scaled = Math.min(1, Math.pow(lit, 0.85) * 1.3) * 2, lower = Math.floor(scaled);
      const k = Math.min(2, lower + (scaled - lower >= (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16 ? 1 : 0));
      const c = ramp[k];
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
  }
  /** The sword stroke across «Claude», white core and ember edge. */
  function drawSlash(canvas, wordEl, s) {
    const c = pixelCanvas(canvas);
    c.ctx.clearRect(0, 0, c.w, c.h);
    if (s.step < 1) return;
    const word = wordEl.getBoundingClientRect(), stage = canvas.getBoundingClientRect();
    const sx = c.w / stage.width, sy = c.h / stage.height;
    const x0 = (word.left - stage.left - word.width * 0.12) * sx, x1 = (word.right - stage.left + word.width * 0.1) * sx;
    const y0 = (word.top - stage.top + word.height * 0.78) * sy, y1 = (word.top - stage.top + word.height * 0.28) * sy;
    const age = s.slashAt && !s.reduced ? (performance.now() - s.slashAt) / 1000 : 9;
    const reach = s.reduced ? 1 : ease(age / 0.16);
    const fade = s.reduced ? 1 : age < 0.5 ? 1 : Math.max(0.55, 1 - (age - 0.5) * 0.8);
    const ex = x0 + (x1 - x0) * reach, ey = y0 + (y1 - y0) * reach;
    const len = Math.hypot(ex - x0, ey - y0);
    if (len < 1) return;
    const nx = -(ey - y0) / len, ny = (ex - x0) / len;
    const thick = Math.max(2, c.h * 0.012);
    const img = c.ctx.getImageData(0, 0, c.w, c.h), d = img.data;
    const minX = Math.max(0, Math.floor(Math.min(x0, ex) - thick * 3)), maxX = Math.min(c.w - 1, Math.ceil(Math.max(x0, ex) + thick * 3));
    const minY = Math.max(0, Math.floor(Math.min(y0, ey) - thick * 3)), maxY = Math.min(c.h - 1, Math.ceil(Math.max(y0, ey) + thick * 3));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const u = ((x - x0) * (ex - x0) + (y - y0) * (ey - y0)) / (len * len);
      if (u < 0 || u > 1) continue;
      const dist = Math.abs((x - x0) * nx + (y - y0) * ny);
      const w = thick * Math.sin(Math.PI * u) * 1.4;
      if (dist > w) continue;
      const tB = (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16;
      const L = clamp((1 - dist / w) * 1.3 * fade, 0, 1) * 2;
      const k = Math.min(2, Math.floor(L) + (L - Math.floor(L) >= tB ? 1 : 0));
      if (k === 0) continue;
      const col = rgb(k === 2 ? '#ffffff' : '#d24a1c');
      const i = (y * c.w + x) * 4;
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
    c.ctx.putImageData(img, 0, 0);
  }

  // ═════════════ 3 · game ═════════════
  const fmt = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  // The viewer's own audio buttons: game sounds from the clip and the theme, both off until pressed.
  const gameAudio = { sfx: false, music: null, last: {}, n: 0 };
  function setGameButton(hook, on, label) {
    const b = $(`#game [data-hook="${hook}"]`);
    if (b) { b.setAttribute('aria-pressed', String(on)); $('span', b).textContent = `${label}: ${on ? 'on' : 'off'}`; }
  }
  function gameMusic(on) {
    if (on && !talk.state.muted) {
      gameAudio.music ??= Object.assign(new Audio('assets/audio/theme.mp3'), { loop: true, volume: 0.6 });
      gameAudio.music.play().catch(e => console.warn(e));
    } else gameAudio.music?.pause();
    setGameButton('game-music', on && !talk.state.muted, 'Music');
  }
  define('game', {
    setup(ctx) {
      $('[data-hook="game-sfx"]', ctx.el).addEventListener('click', () => { gameAudio.sfx = !gameAudio.sfx; setGameButton('game-sfx', gameAudio.sfx, 'Sounds'); });
      $('[data-hook="game-music"]', ctx.el).addEventListener('click', () => gameMusic(!(gameAudio.music && !gameAudio.music.paused)));
    },
    leave() { gameAudio.sfx = false; setGameButton('game-sfx', false, 'Sounds'); gameMusic(false); },
    onClipSound(name, pan, volume) {
      if (!gameAudio.sfx) return;
      const now = performance.now();
      if (now - (gameAudio.last[name] ?? -1e9) < (GAP_MS[name] ?? 120)) return;
      gameAudio.last[name] = now;
      const pool = SOUND_FILE[name];
      if (pool) talk.audio.play(pool[gameAudio.n++ % pool.length], { volume: Math.min(0.9, volume * 1.2) });
    },
    onClipTick(frame, clip) {
      // The viewer's score list, filled from the replay's own frame (Hud.tsx PlayerList).
      const el = $('#game');
      $('[data-hook="clock"]', el).textContent = fmt(frame.timeMs);
      if (frame.matchMs) $('[data-hook="match"]', el).textContent = `/ ${fmt(frame.matchMs)}`;
      $('[data-hook="progress"]', el).style.width = `${Math.min(100, frame.timeMs / (frame.matchMs || 900000) * 100)}%`;
      $('[data-hook="score-rows"]', el).innerHTML = frame.players.map((p, i) => `<tr class="${p.alive === false ? 'dead' : ''}"><td class="name pc${i}"><span class="swatch bg${i}"></span>${playerLabel(clip?.id, p)}<span class="pid">(${p.id})</span></td><td>${p.mineral ?? '—'}</td><td>${p.pop ?? '—'}/${p.popCap ?? '—'}</td><td>${p.kills ?? '—'}</td><td>${p.score ?? '—'}</td></tr>`).join('');
    },
  });
  // ═════════════ 4 · teaser: the same viewer panel, players then chat ═════════════
  define('teaser', {
    onClipTick(frame, clip) {
      const el = $('#teaser');
      $('[data-hook="clock"]', el).textContent = fmt(frame.timeMs);
      if (frame.matchMs) $('[data-hook="match"]', el).textContent = `/ ${fmt(frame.matchMs)}`;
      $('[data-hook="progress"]', el).style.width = `${Math.min(100, frame.timeMs / (frame.matchMs || 900000) * 100)}%`;
      $('[data-hook="score-rows"]', el).innerHTML = frame.players.map((p, i) => `<tr class="${p.alive === false ? 'dead' : ''}"><td class="name pc${i}"><span class="swatch bg${i}"></span>${playerLabel(clip?.id, p)}<span class="pid">(${p.id})</span></td><td>${p.mineral ?? '—'}</td><td>${p.pop ?? '—'}/${p.popCap ?? '—'}</td><td>${p.kills ?? '—'}</td><td>${p.score ?? '—'}</td></tr>`).join('');
    },
  });

  define('basics', {});
  define('king-down', {});

  // ═════════════ pov ═════════════
  const povState = { clips: new Map(), shown: -1 };
  /** The world, Opus's own view of it and the text state Opus gets, on one clock. */
  define('pov', {
    async setup() { povState.states = (await fetch('assets/clips/a21dc6cf-2024-p1-state.json').then(r => r.json()).catch(() => null))?.states ?? []; },
    enter() { povState.clips = new Map(); povState.shown = -1; },
    onClipReady(el, clip) {
      const s = povState;
      s.clips.set(el, clip);
      if (el.classList.contains('pov-player')) s.player = clip;
      // Both boards restart together so the fog, the world and the text show the same tick.
      if (s.clips.size === 2) for (const c of s.clips.values()) { c.seek(0); c.play(); }
    },
    onClipTick(frame, clip) {
      const s = povState;
      if (clip !== s.player || !s.states?.length) return;
      let i = 0;
      while (i + 1 < s.states.length && s.states[i + 1].tick <= frame.tick) i++;
      if (i !== s.shown) { s.shown = i; fitState($('#pov [data-hook="pov-state"]'), s.states[i].text); }
    },
    update() { if (povState.shown >= 0) fitState($('#pov [data-hook="pov-state"]'), povState.states[povState.shown].text); },
  });
  /** The state's first lines, as many as the box holds, then «…»; the rest is cut, never rewritten. */
  function fitState(pre, text) {
    pre.textContent = text;
    if (!pre.clientHeight || pre.scrollHeight <= pre.clientHeight) return;
    const lines = text.split('\n');
    let lo = 0, hi = lines.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      pre.textContent = lines.slice(0, mid).join('\n') + '\n…';
      if (pre.scrollHeight <= pre.clientHeight) lo = mid; else hi = mid - 1;
    }
    pre.textContent = lines.slice(0, lo).join('\n') + '\n…';
  }
  // ═════════════ qué es un RTS ═════════════
  define('rts', {
    async setup(ctx, s) {
      const load = (kind, action, dir, team) => keyedFrames(kind, action, dir, TEAM_KEY[team]).catch(() => null);
      s.chess = { a: await load('knight', 'idle', 'ne', 0), b: await load('knight', 'idle', 'sw', 1), aw: await load('knight', 'walk', 'ne', 0), bw: await load('knight', 'walk', 'sw', 1) };
      s.lanes = await Promise.all([0, 1, 2, 3].map(p => load(['knight', 'archer', 'worker', 'knight'][p], 'walk', p % 2 ? 'nw' : 'se', p)));
    },
    update(ctx) { playVisibleVideos(ctx.el); },
    leave(ctx) { $$('video', ctx.el).forEach(v => v.pause()); },
    frame(t, s) {
      if (s.step !== 0 || !s.chess?.a || !s.lanes) return;
      drawChess($('#rts [data-hook="chess"]'), t, s);
      drawLanes($('#rts [data-hook="lanes"]'), t, s);
    },
  });

  // ═════════════ lo que ve el jugador ═════════════
  define('state', {
    setup(ctx) {
      const pre = $('[data-hook="state-text"]', ctx.el);
      fetch('assets/data/state-1b4b65c9-p1.txt').then(r => r.ok ? r.text() : Promise.reject(r.status)).then(t => { pre.textContent = t; }).catch(() => {});
    },
  });

  // ═════════════ los sonidos, en el motor ═════════════
  /** The renderer's sound names → the game's samples (packages/web/src/audio/mix.ts). */
  const SOUND_FILE = { sword: ['sword-1', 'sword-2', 'sword-3', 'sword-4'], arrow: ['whoosh-1'], tower: ['whoosh-3'], pick: ['pick-1', 'pick-3'], footstep: ['footstep-1'],
    death: ['death-3'], hit: ['hit-1', 'hit-6'], collapse: ['collapse-1', 'collapse-2'], spawn: ['spawn-1'], build: ['build-1'], horn: ['horn-4'], fanfare: ['fanfare-3'], chat: ['chat-1', 'chat-2'] };
  const SOUND_LABEL = { sword: 'espada', arrow: 'flecha', tower: 'torre', pick: 'pico', footstep: 'paso', death: 'muerte', hit: 'golpe', collapse: 'derrumbe', spawn: 'unidad nueva', build: 'construcción', horn: 'cuerno', fanfare: 'fanfarria', chat: 'chat' };
  const GAP_MS = { sword: 90, hit: 160, arrow: 200, tower: 250, death: 90, spawn: 120, pick: 110, footstep: 180 };
  define('sound-engine', {
    enter(ctx) { soundEngine.last = {}; soundEngine.n = 0; $('[data-hook="sound-log"]', ctx.el).innerHTML = ''; },
    onClipTick(frame, clip) { soundEngine.time = frame.timeMs; },
    onClipSound(name, pan, volume) {
      // Footsteps would flood the list: they still sound, quieter, but don't get a line.
      const s = soundEngine, now = performance.now();
      if (now - (s.last[name] ?? -1e9) < (GAP_MS[name] ?? 120)) return;
      s.last[name] = now;
      const pool = SOUND_FILE[name];
      if (pool) talk.audio.play(pool[s.n++ % pool.length], { volume: Math.min(0.9, volume * 1.2) });
      if (name === 'footstep') return;
      const log = $('#sound-engine [data-hook="sound-log"]');
      log.insertAdjacentHTML('afterbegin', `<p class="s-${name}"><span class="t">${fmt(s.time || 0)}</span><b>${SOUND_LABEL[name] ?? name}</b><span class="f">${pool ? pool[(s.n - 1) % pool.length] + '.mp3' : '—'}</span></p>`);
      while (log.children.length > 14) log.lastElementChild.remove();
    },
  });
  const soundEngine = { last: {}, n: 0, time: 0 };
  /** Isometric board: tile (i, j) → canvas point. The board sits at the bottom; the room above is for the units. */
  const iso = (w, h, n) => { const tw = w / n, th = tw / 2, ox = w / 2, oy = h - th * n - 2; return { tw, th, at: (i, j) => [ox + (i - j) * tw / 2, oy + (i + j) * th / 2 + th / 2] }; };
  function isoBoard(ctx, w, h, n, checker, t) {
    const B = iso(w, h, n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const [cx, cy] = B.at(i, j);
      const L = checker ? ((i + j) % 2 ? 0.42 : 0.22) : 0.28 + 0.08 * Math.sin(i * 1.7 + j * 0.9 + t * 0.3);
      ctx.fillStyle = keyed(KEY.terrain, L);
      ctx.beginPath(); ctx.moveTo(cx, cy - B.th / 2); ctx.lineTo(cx + B.tw / 2, cy); ctx.lineTo(cx, cy + B.th / 2); ctx.lineTo(cx - B.tw / 2, cy); ctx.closePath(); ctx.fill();
    }
    return B;
  }
  /** Chess: one side moves, then the other; nothing happens in between. Knights of the game. */
  function drawChess(canvas, t, s) {
    const { ctx, w, h } = pixelCanvas(canvas);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    const n = 6, B = isoBoard(ctx, w, h, n, true, 0);
    const scale = B.th * 2 / s.chess.a.frames[0].height;
    // Blue on the near edge, red on the far one; they alternate, one piece and one square per turn.
    const start = [[0, 5], [1, 0], [2, 5], [3, 0], [4, 5], [5, 0]];
    const turns = start.length * 2, turn = Math.floor(t / 1.4) % turns, phase = (t % 1.4) / 1.4;
    const pieces = start.map(([x, y], i) => {
      const dy = i % 2 ? 1 : -1, done = (turn > i) + (turn > i + start.length);
      const moving = (turn === i || turn === i + start.length) && phase < 0.55;
      const a = moving ? ease(phase / 0.55) : (turn === i || turn === i + start.length) ? 1 : 0;
      return { x, y: y + dy * (done + a), side: i % 2, moving };
    }).sort((a, b) => (a.x + a.y) - (b.x + b.y));
    for (const p of pieces) {
      const [px, py] = B.at(p.x, p.y);
      const anim = p.side ? (p.moving ? s.chess.bw : s.chess.b) : (p.moving ? s.chess.aw : s.chess.a);
      putFrame(ctx, anim, Math.floor(t * 12), px, py, scale);
    }
    rampDither(ctx, w, h);
  }
  /** RTS: everybody busy at once on the same kind of board. */
  function drawLanes(canvas, t, s) {
    const { ctx, w, h } = pixelCanvas(canvas);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    const n = 6, B = isoBoard(ctx, w, h, n, false, t);
    const ref = s.lanes.find(Boolean);
    if (!ref) return;
    const scale = B.th * 2 / ref.frames[0].height;
    // Four parallel lanes, alternating direction: everyone moves at once, nobody waits.
    const paths = [0.7, 2.0, 3.3, 4.6].map((j, p) => p % 2 ? [[5.6, j], [0.2, j]] : [[0.2, j], [5.6, j]]);
    const units = [];
    s.lanes.forEach((anim, p) => {
      if (!anim) return;
      for (let k = 0; k < 2; k++) {
        const [[ax, ay], [bx, by]] = paths[p];
        const u = ((t * (0.12 + p * 0.02) + k * 0.5 + p * 0.13) % 1);
        units.push({ anim, x: ax + (bx - ax) * u, y: ay + (by - ay) * u, f: Math.floor(t * 12) + k * 7 });
      }
    });
    units.sort((a, b) => (a.x + a.y) - (b.x + b.y));
    for (const u of units) { const [px, py] = B.at(u.x, u.y); putFrame(ctx, u.anim, u.f, px, py, scale); }
    rampDither(ctx, w, h);
  }

  // ═════════════ 4 · question ═════════════
  define('thinking', {
    frame(t) { drawThinkRace($('#thinking [data-hook="think-race"]'), t); },
  });
  /** The world ticks on; one agent thinks long, the other short. Labels are HTML beside it. */
  function drawThinkRace(canvas, t) {
    const { ctx, w, h } = pixelCanvas(canvas);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    const rows = [h / 6, h / 2, h * 5 / 6].map(Math.round), pxPerS = w / 12, now = t % 12, bar = Math.round(h * 0.09);
    for (let i = 0; i <= 120; i++) {
      const x = Math.round(i * pxPerS / 10), major = i % 10 === 0;
      ctx.fillStyle = i / 10 <= now ? keyed(major ? KEY.mineral : KEY.neutral, major ? 1 : 0.55) : keyed(KEY.neutral, 0.16);
      ctx.fillRect(x, rows[0] - (major ? bar : bar / 2), 1, major ? bar * 2 : bar);
    }
    const lane = (y, plan, key) => {
      ctx.fillStyle = keyed(KEY.neutral, 0.1); ctx.fillRect(0, y - bar, w, bar * 2);
      for (const [a, b] of plan) {
        if (a > now) continue;
        ctx.fillStyle = keyed(key, 0.62); ctx.fillRect(Math.round(a * pxPerS), y - bar + 2, Math.max(1, Math.round((Math.min(b, now) - a) * pxPerS)), bar * 2 - 4);
        if (b <= now) { ctx.fillStyle = keyed(KEY.mineral, 1); ctx.fillRect(Math.round(b * pxPerS), y - bar * 1.5, 2, bar * 3); }
      }
    };
    lane(rows[1], [[0, 5.5], [5.7, 11.2]], KEY.teamA);
    lane(rows[2], [[0, 1.2], [1.4, 2.5], [2.7, 3.6], [3.8, 5.1], [5.3, 6.2], [6.4, 7.5], [7.7, 8.6], [8.8, 10.1], [10.3, 11.4]], KEY.teamB);
    ctx.fillStyle = keyed(KEY.mineral, 1); ctx.fillRect(Math.round(now * pxPerS), 0, 1, h);
    rampDither(ctx, w, h);
  }
  // ═════════════ 6 · harness ═════════════
  define('harness', {
    frame(t) {
      const peek = $('#harness [data-hook="state-peek"]');
      if (peek) peek.textContent = `tick ${1743 + Math.floor(t * 10)}`;
    },
  });

  // ═════════════ 7 · scripts ═════════════
  /** Minimal JavaScript colouring for the script cards (keywords, strings, numbers, comments, self.calls). */
  function highlightJs(pre) {
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const re = /(\/\/[^\n]*)|('[^']*'|"[^"]*")|\b(const|let|if|else|return|for|of|function|new)\b|\b(\d+(?:\.\d+)?)\b|\.([a-zA-Z]+)(?=\()/g;
    const src = pre.textContent; let out = '', last = 0, m;
    while ((m = re.exec(src))) {
      out += esc(src.slice(last, m.index));
      out += m[1] ? `<span class="c">${esc(m[1])}</span>` : m[2] ? `<span class="s">${esc(m[2])}</span>` : m[3] ? `<span class="k">${m[3]}</span>` : m[4] ? `<span class="n">${m[4]}</span>` : `.<span class="f">${m[5]}</span>`;
      last = re.lastIndex;
    }
    pre.innerHTML = out + esc(src.slice(last));
  }
  define('scripts', {
    setup(ctx) {
      $$('pre.code.js', ctx.el).forEach(highlightJs);
      // Codex's king: the lines that measure distances and project each arrow stand out.
      for (const pre of $$('.s-codex pre', ctx.el)) pre.innerHTML = pre.innerHTML.split('\n').map(l => /hypot|p\.vx/.test(l) ? l : `<span class="cold">${l}</span>`).join('\n');
    },
    frame(t, s) { drawRhythms($('#scripts [data-hook="rhythms"]'), t); },
  });
  /** Two rhythms: the agent decides every few seconds, its script runs every tick. */
  function drawRhythms(canvas, t) {
    const { ctx, w, h } = pixelCanvas(canvas);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    const span = 12, now = t % span, x = s => Math.round(w * s / span);
    const yA = Math.round(h * 0.28), yS = Math.round(h * 0.72), half = Math.round(h * 0.12);
    ctx.fillStyle = keyed(KEY.neutral, 0.1); ctx.fillRect(0, yA - half, w, half * 2); ctx.fillRect(0, yS - half, w, half * 2);
    for (const [a, b] of [[0, 4.6], [4.8, 9.1], [9.3, 12]]) {
      if (a > now) continue;
      ctx.fillStyle = keyed(KEY.teamA, 0.62); ctx.fillRect(x(a), yA - half + 2, Math.max(1, x(Math.min(b, now)) - x(a)), half * 2 - 4);
      if (b <= now) { ctx.fillStyle = keyed(KEY.mineral, 1); ctx.fillRect(x(b), yA - half * 1.6, 2, half * 3.2); }
    }
    for (let i = 0; i <= now * 10; i++) { ctx.fillStyle = keyed(KEY.teamC, i % 10 === 0 ? 1 : 0.6); ctx.fillRect(x(i / 10), yS - half + 2, 1, half * 2 - 4); }
    rampDither(ctx, w, h);
  }

  // ═════════════ 8 · build ═════════════
  define('build', { setup(ctx) { $$('pre.code.js', ctx.el).forEach(highlightJs); } });

  // ═════════════ 9 · sprites ═════════════
  define('sprites', {
    async setup(ctx, s) {
      s.sheet = await loadImage('assets/art/knight-sheet.png').catch(() => null);
      if (!s.sheet) return;
      // The generated sheet: five views on magenta. Crop the band with the knights.
      const band = { x: 60, y: 560, w: 1416, h: 360 };
      const make = () => { const c = document.createElement('canvas'); c.width = band.w; c.height = band.h; return c; };
      const raw = make(); raw.getContext('2d').drawImage(s.sheet, band.x, band.y, band.w, band.h, 0, 0, band.w, band.h);
      const keyedSheet = make(), kx = keyedSheet.getContext('2d', { willReadFrequently: true }); kx.drawImage(raw, 0, 0);
      const data = kx.getImageData(0, 0, band.w, band.h), d = data.data;
      // Chroma key: magenta out (r and b high, g low).
      for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; if (r > 150 && b > 150 && g < 110) d[i + 3] = 0; else if (r > 120 && b > 120 && g < 140 && Math.abs(r - b) < 70) d[i + 3] = 90; }
      kx.putImageData(data, 0, 0);
      s.layers = { raw, keyed: keyedSheet, band };
    },
    frame(t, s) {
      if (!s.layers) return;
      const canvas = $('#sprites [data-hook="sprite-lab"]');
      const { raw, keyed: keyedSheet, band } = s.layers;
      const k = sinceStep(s);
      if (s.step >= 2) {
        // The game's look at the game's cell: grey, the first player's key, the renderer's dither.
        const c = pixelCanvas(canvas), fit = Math.min(c.w / band.w, c.h / band.h), dw = Math.round(band.w * fit), dh = Math.round(band.h * fit), ox = Math.round((c.w - dw) / 2), oy = Math.round((c.h - dh) / 2);
        const key = s.tinted ?? (s.tinted = tintSheet(keyedSheet)[0]);
        c.ctx.fillStyle = '#000'; c.ctx.fillRect(0, 0, c.w, c.h);
        c.ctx.imageSmoothingEnabled = true;
        const p = s.step === 2 && !s.reduced ? ease(k / 1.2) : 1, cut = Math.round(dw * p);
        c.ctx.save(); c.ctx.beginPath(); c.ctx.rect(ox, oy, cut, dh); c.ctx.clip(); c.ctx.drawImage(key, ox, oy, dw, dh); c.ctx.restore();
        rampDither(c.ctx, c.w, c.h);
        if (p < 1) { c.ctx.save(); c.ctx.beginPath(); c.ctx.rect(ox + cut, oy, dw - cut, dh); c.ctx.clip(); c.ctx.drawImage(keyedSheet, ox, oy, dw, dh); c.ctx.restore(); }
        return;
      }
      // Steps 0–1: the generated image itself, at full resolution.
      const dpr = window.devicePixelRatio || 1, box = canvas.getBoundingClientRect();
      const w = Math.round(box.width * dpr), h = Math.round(box.height * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      const ctx = canvas.getContext('2d');
      const fit = Math.min(w / band.w, h / band.h), dw = band.w * fit, dh = band.h * fit, ox = (w - dw) / 2, oy = (h - dh) / 2;
      ctx.imageSmoothingEnabled = true;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      if (s.step === 0) { ctx.drawImage(raw, ox, oy, dw, dh); return; }
      // A wipe removes the magenta from left to right; a checkerboard shows the transparency.
      const p = s.reduced ? 1 : ease(k / 1.2), cut = dw * p, cell = Math.round(16 * dpr);
      for (let y = 0; y < dh; y += cell) for (let x = 0; x < cut; x += cell) { ctx.fillStyle = ((x + y) / cell) % 2 ? '#1a1a1a' : '#111'; ctx.fillRect(ox + x, oy + y, Math.min(cell, cut - x), cell); }
      ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, cut, dh); ctx.clip(); ctx.drawImage(keyedSheet, ox, oy, dw, dh); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(ox + cut, oy, dw - cut, dh); ctx.clip(); ctx.drawImage(raw, ox, oy, dw, dh); ctx.restore();
    },
  });
  /** The keyed sheet in grey, normalized like the game's characters, tinted with each player's key. */
  function tintSheet(src) {
    const grey = document.createElement('canvas'); grey.width = src.width; grey.height = src.height;
    const g = grey.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0);
    const data = g.getImageData(0, 0, src.width, src.height), d = data.data;
    for (let i = 0; i < d.length; i += 4) { const v = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; d[i] = d[i + 1] = d[i + 2] = v; }
    normalizeCharacterContrast(d);
    return TEAM_KEY.map(key => {
      const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
      const copy = new ImageData(new Uint8ClampedArray(d), src.width, src.height), e = copy.data;
      for (let i = 0; i < e.length; i += 4) { const v = e[i] / 255; e[i] = key[0] * v; e[i + 1] = key[1] * v; e[i + 2] = key[2] * v; e[i + 3] = e[i + 3] > 110 ? 255 : 0; }
      c.getContext('2d').putImageData(copy, 0, 0);
      return c;
    });
  }

  // ═════════════ 10 · art ═════════════
  function playVisibleVideos(root) {
    for (const v of $$('video[data-autoplay]', root)) {
      let visible = true;
      for (let n = v; n && n !== root; n = n.parentElement) if ((n.hasAttribute('data-in') || n.hasAttribute('data-out')) && !n.classList.contains('on')) visible = false;
      if (visible && !talk.reduced()) v.play().catch(() => {}); else v.pause();
    }
  }
  define('gameplay', {});
  define('fight', {});
  define('art', {
    async setup(ctx, s) { s.cutout = await loadImage('assets/pipeline/knight-walk-cutout.png').catch(() => null); },
    update(ctx) { playVisibleVideos(ctx.el); },
    frame(t, s) {
      // The exporter's 28 cut-out color frames (export-frames/color-XX.png), at the atlas's 12 fps.
      if (s.step !== 2 || !s.cutout) return;
      const c = $('#art [data-hook="cutout"]'), x = c.getContext('2d'), f = Math.floor(t * 12) % 28;
      x.clearRect(0, 0, 320, 320); x.drawImage(s.cutout, f * 320, 0, 320, 320, 0, 0, 320, 320);
    },
    leave(ctx) { $$('video', ctx.el).forEach(v => v.pause()); },
  });

  // ═════════════ 11 · music ═════════════
  // The chord plan of assets/music/compose.py, 76 BPM, one bar = 4 beats.
  const PLAN = ['Dm', 'Dm', ['G', 'Am'], 'Dm', 'Dm', 'C', 'Dm', 'Dm', 'G', 'F', 'C', 'G', 'G', 'F', 'C', 'Asus',
    'Am', 'Em', 'Am', ['G', 'Em'], 'Am', 'Em', 'G', 'Asus', 'Dm', 'Dm', 'C', 'Dm', 'Dm', ['G', 'Am'], 'C', 'Asus'];
  const BAR = 4 * 60 / 76;
  /** Bar 25 of compose.py (pickup at 75.05 s): melody and arpeggio together, at the same level, to the loop's end. */
  const TWO_VOICES_AT = 75.05;
  const music = { el: null, analyser: null, source: null, playing: false };
  function musicElement() {
    if (!music.el) {
      music.el = new Audio('assets/audio/theme.mp3');
      music.el.preload = 'auto';
      music.el.loop = true;
    }
    return music.el;
  }
  function startMusic() {
    if (talk.state.muted) return;
    const el = musicElement();
    const ac = talk.audio.context();
    if (ac && !music.source) {
      try { music.source = ac.createMediaElementSource(el); music.analyser = ac.createAnalyser(); music.analyser.fftSize = 2048; music.source.connect(music.analyser).connect(ac.destination); } catch (e) { console.warn(e); }
    }
    el.currentTime = TWO_VOICES_AT;
    el.volume = 0.9;
    el.play().then(() => { music.playing = true; setPlayButton(); }).catch(e => console.warn(e));
  }
  function stopMusic() { if (music.el) music.el.pause(); music.playing = false; setPlayButton(); }
  function setPlayButton() {
    const b = $('#music [data-hook="music-play"]');
    if (b) { b.textContent = music.playing ? '❚❚ Pausar' : '▶ Tema del juego'; b.classList.toggle('playing', music.playing); }
  }
  function stopRefs(except) { for (const v of $$('#music-refs [data-hook="ref-video"]')) if (v !== except) { v.pause(); v.classList.remove('playing'); } }
  window.addEventListener('talk-mute', e => { if (e.detail.muted) { stopMusic(); stopRefs(); } });
  define('music-refs', {
    setup(ctx) {
      // Each reference plays with its sound on a click, one at a time.
      for (const v of $$('[data-hook="ref-video"]', ctx.el)) v.addEventListener('click', e => {
        e.stopPropagation();
        // Hide is about 4 dB louder than the AoE II recording: level them.
        if (v.paused) { stopRefs(v); if (!talk.state.muted) { v.muted = false; v.volume = v.src.includes('hide') ? 0.63 : 1; v.play().catch(() => {}); v.classList.add('playing'); } }
        else { v.pause(); v.classList.remove('playing'); }
      });
    },
    leave() { stopRefs(); },
  });
  define('music', {
    setup(ctx) {
      $('[data-hook="music-play"]', ctx.el).addEventListener('click', () => music.playing ? stopMusic() : startMusic());
      $('[data-hook="chords"]', ctx.el).innerHTML = Array.from({ length: 12 }, () => '<span></span>').join('');
    },
    update(ctx) {
      if (ctx.step === 1 && !ctx.instant && ctx.dir > 0) startMusic();
      else if (ctx.step < 1) stopMusic();
      setPlayButton();
    },
    leave() { stopMusic(); },
    frame(t, s) { if (s.step === 1) drawMusic($('#music [data-hook="music-viz"]'), $('#music [data-hook="chords"]'), t); },
  });
  function drawMusic(canvas, row, t) {
    const { ctx, w, h } = pixelCanvas(canvas);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    const time = music.el && music.playing ? music.el.currentTime : TWO_VOICES_AT;
    // Spectrum as columns on the mineral ramp.
    let bins = null;
    if (music.analyser && music.playing) { bins = new Uint8Array(music.analyser.frequencyBinCount); music.analyser.getByteFrequencyData(bins); }
    const cols = Math.floor(w / 2);
    for (let c = 0; c < cols; c++) {
      const v = bins ? bins[Math.floor(Math.pow(c / cols, 1.8) * bins.length * 0.45)] / 255 : 0.05 + 0.03 * Math.sin(c * 0.3 + t * 2);
      const height = Math.round(v * h * 0.96);
      for (let y = 0; y < height; y++) { ctx.fillStyle = keyed(KEY.mineral, clamp(0.15 + y / h, 0, 1)); ctx.fillRect(c * 2, h - 1 - y, 1, 1); }
    }
    rampDither(ctx, w, h);
    // Chord names: HTML cells, the current one lit.
    const bar = Math.floor(Math.max(0, time - 0.05) / BAR) % PLAN.length;
    [...row.children].forEach((cell, i) => {
      const c = PLAN[(bar - 3 + i + PLAN.length) % PLAN.length];
      const text = Array.isArray(c) ? c.join('/') : c;
      if (cell.textContent !== text) cell.textContent = text;
      cell.classList.toggle('now', i === 3);
    });
  }

  // ═════════════ 12 · sounds ═════════════
  /** Each sound fires on its animation's impact frame, the way the game plays them. */
  const SFX_AT = { 'sword-1': ['sword-1', 'sword-2', 'sword-3'], 'whoosh-1': ['whoosh-1', 'whoosh-3'], 'pick-1': ['pick-1', 'pick-3'], 'collapse-1': ['collapse-1', 'collapse-2'] };
  define('sounds', {
    setup(ctx, s) {
      for (const b of $$('button[data-sfx]', ctx.el)) b.addEventListener('click', async e => {
        e.stopPropagation();
        b.classList.add('playing');
        await talk.audio.play(b.dataset.sfx, { volume: 0.9 });
        setTimeout(() => b.classList.remove('playing'), 900);
      });
      let n = 0;
      for (const item of s.sprites) {
        const name = item.canvas.dataset.sfx;
        if (!name) continue;
        item.ready.then(() => {
          // Impact or release frame of this row; the pick bites at 11 (look.ts); a collapse starts at once.
          const hit = item.anim.impact ?? (item.kind === 'worker' ? 11 : 1);
          item.onFrame = (f, prev) => {
            if (s.step !== 0 || !(prev < hit && f >= hit)) return;
            const pool = SFX_AT[name];
            talk.audio.play(pool[n++ % pool.length], { volume: item.kind === 'castle' ? 0.55 : 0.5 });
          };
        });
      }
    },
  });

  // ═════════════ 14 · experiments ═════════════
  define('final-verdict', {
    update(ctx, s) {
      // GPT's king strikes, Claude's falls once.
      const claude = s.sprites?.find(i => i.canvas.dataset.hook === 'king-claude');
      if (claude) claude.startAt = ctx.instant || ctx.reduced ? performance.now() - 10000 : performance.now() + 900;
    },
  });
  define('experiments', {
    frame(t, s) {
      if (s.step > 1) return;
      // One tile per unique match published on the web (250), filling in; iterating makes them flicker.
      const { ctx, w, h } = pixelCanvas($('#experiments [data-hook="corpus"]'));
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      const n = 250, cols = 25, size = Math.floor(Math.min(w / cols, h / Math.ceil(n / cols))) - 2;
      const ox = Math.floor((w - cols * (size + 2)) / 2), oy = Math.floor((h - Math.ceil(n / cols) * (size + 2)) / 2);
      const k = s.reduced || s.instant ? 99 : (performance.now() - s.entered) / 1000;
      const it = s.step === 1 ? Math.floor(t * 3) : 0;
      for (let i = 0; i < n; i++) {
        if (((i * 97) % n) / n * 2.2 > k) continue;
        const x = ox + (i % cols) * (size + 2), y = oy + Math.floor(i / cols) * (size + 2);
        ctx.fillStyle = keyed(KEY.neutral, 0.22 + ((i * 31 + it * 17) % 7) * 0.04);
        ctx.fillRect(x, y, size, size);
      }
      rampDither(ctx, w, h);
    },
  });

  // ═════════════ 15 · tower rush, 16 · turtling, 17 · diplomacy, 18 · deception ═════════════
  define('balance', {});
  define('turtle', {});
  define('diplomacy', {});
  define('deception', {});

  // ═════════════ 19 · hacks ═════════════
  define('hacks', {
    frame(t) {
      const { ctx, w, h } = pixelCanvas($('#hacks [data-hook="sandbox"]'));
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      const m = Math.floor(Math.min(w, h) * 0.08);
      // The sandbox walls, and attempts bouncing off them.
      for (let y = m; y < h - m; y++) for (let x = m; x < w - m; x++) {
        const edge = Math.min(x - m, y - m, w - m - 1 - x, h - m - 1 - y);
        if (edge > 2) continue;
        ctx.fillStyle = keyed(KEY.teamC, edge === 1 ? 1 : 0.55); ctx.fillRect(x, y, 1, 1);
      }
      for (let i = 0; i < 6; i++) {
        const sp = 0.6 + i * 0.13, px = (Math.sin(t * sp + i * 1.7) * 0.5 + 0.5), py = (Math.cos(t * sp * 1.3 + i) * 0.5 + 0.5);
        const x = Math.round(m + 6 + px * (w - 2 * m - 16)), y = Math.round(m + 6 + py * (h - 2 * m - 16));
        ctx.fillStyle = keyed(i % 2 ? KEY.mineral : KEY.teamB, 1); ctx.fillRect(x, y, 4, 4);
      }
      rampDither(ctx, w, h);
    },
  });

  // ═════════════ 22 · close ═════════════
  define('close', {});
})();
