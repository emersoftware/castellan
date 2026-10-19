import type { SpectatorView } from "@aoa/shared";

/** Tiles to keep in view; `null` is the whole map. */
export interface CameraBox { x0: number; y0: number; x1: number; y1: number }
/** From `tick` until the next shot, the hero frames `box`. */
export interface CameraShot { tick: number; box: CameraBox | null }
/** Where combat happened in one tick. */
export interface CameraActivity { tick: number; points: { x: number; y: number }[] }

const RADIUS = 7;
const MIN_POINTS = 8;
const PADDING = 3;
const MIN_SIDE = 12;

/** Attackers, targets, landing arrows and the fallen of one frame. */
export function cameraActivity(frame: SpectatorView): CameraActivity {
  const points: { x: number; y: number }[] = [];
  let byId: Map<string, { x: number; y: number }> | undefined;
  for (const event of frame.events) {
    if (event.type === "attack") {
      byId ??= new Map(frame.entities.map(e => [e.id, e]));
      for (const id of [event.from, event.to]) { const e = id ? byId.get(id) : undefined; if (e) points.push({ x: e.x, y: e.y }); }
    } else if (event.type === "projectile_end" || event.type === "death") points.push({ x: event.x, y: event.y });
  }
  return { tick: frame.tick, points };
}

/**
 * A calm shot list for the decorative hero: the whole map first, then close-ups
 * of the biggest fight about to happen, each held for seconds. The camera goes
 * back to the whole map between fights in different places and at least every
 * two close-ups, so the viewer keeps their bearings.
 */
export function planShowcaseCamera(activity: CameraActivity[], startTick: number, finalTick: number, tickRate: number): CameraShot[] {
  const s = (seconds: number) => Math.round(seconds * tickRate);
  const opening = s(5), lookahead = s(8), minClose = s(5), maxClose = s(11), minOverview = s(4), linger = s(1.5), retry = s(2);
  const points = activity.filter(a => a.tick >= startTick && a.tick <= finalTick)
    .flatMap(a => a.points.map(p => ({ ...p, tick: a.tick })));
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= RADIUS;

  /** The densest fight starting within the lookahead, and how long it lasts near its centre. */
  const fightFrom = (t: number) => {
    const window = points.filter(p => p.tick >= t && p.tick < t + lookahead);
    // Count per tile: a long fight repeats the same few tiles many times.
    const tiles = new Map<string, { x: number; y: number; n: number }>();
    for (const p of window) {
      const key = `${p.x},${p.y}`;
      const tile = tiles.get(key);
      if (tile) tile.n++; else tiles.set(key, { x: p.x, y: p.y, n: 1 });
    }
    let core: { x: number; y: number } | undefined, best = 0;
    for (const p of tiles.values()) {
      let n = 0;
      for (const o of tiles.values()) if (near(p, o)) n += o.n;
      if (n > best) { best = n; core = p; }
    }
    if (!core || best < MIN_POINTS) return;
    const cluster = window.filter(p => near(core!, p));
    const centre = { x: cluster.reduce((sum, p) => sum + p.x, 0) / cluster.length, y: cluster.reduce((sum, p) => sum + p.y, 0) / cluster.length };
    // Follow the fight while it continues around the same place.
    const held = points.filter(p => p.tick >= t && p.tick < t + maxClose && near(centre, p));
    const end = Math.min(t + maxClose, Math.max(t + minClose, Math.max(...held.map(p => p.tick)) + linger));
    const inShot = held.filter(p => p.tick < end);
    return { end, centre, box: frame(inShot) };
  };

  const shots: CameraShot[] = [{ tick: startTick, box: null }];
  let t = startTick + opening, closeUps = 0;
  let last: { x: number; y: number } | undefined;
  while (t < finalTick) {
    const fight = fightFrom(t);
    if (!fight) { push(shots, { tick: t, box: null }); closeUps = 0; last = undefined; t += retry; continue; }
    // A different place, or a long run of close-ups: show the whole map first.
    if ((last && !near(last, fight.centre)) || closeUps >= 2) {
      push(shots, { tick: t, box: null });
      closeUps = 0;
      t += minOverview;
      last = undefined;
      continue;
    }
    push(shots, { tick: t, box: fight.box });
    closeUps++;
    last = fight.centre;
    t = fight.end;
  }
  return shots;
}

/**
 * A close-up that drifts with its subject: the same size as `box`, centred on
 * the mean position of the units (not buildings) inside it. With no unit in
 * view, the box stays where it was planned.
 */
export function followUnits(box: CameraBox, frame: SpectatorView, isBuilding: (kind: string) => boolean): CameraBox {
  const inside = frame.entities.filter(e => !isBuilding(e.kind) && !e.construction
    && e.x >= box.x0 && e.x <= box.x1 && e.y >= box.y0 && e.y <= box.y1);
  if (!inside.length) return box;
  const cx = inside.reduce((sum, e) => sum + e.x, 0) / inside.length, cy = inside.reduce((sum, e) => sum + e.y, 0) / inside.length;
  const rx = (box.x1 - box.x0) / 2, ry = (box.y1 - box.y0) / 2;
  return { x0: cx - rx, y0: cy - ry, x1: cx + rx, y1: cy + ry };
}

/** The shot showing at `tick`. */
export function shotAt(shots: readonly CameraShot[] | undefined, tick: number | undefined): CameraShot | undefined {
  if (!shots?.length || tick === undefined) return;
  let found = shots[0];
  for (const shot of shots) { if (shot.tick > tick) break; found = shot; }
  return found;
}

function push(shots: CameraShot[], shot: CameraShot) {
  // Consecutive whole-map shots are one shot.
  if (shot.box === null && shots[shots.length - 1]?.box === null) return;
  shots.push(shot);
}

/** Bounds of the fighters with some ground around them, never tighter than MIN_SIDE tiles. */
function frame(points: { x: number; y: number }[]): CameraBox {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const grow = (lo: number, hi: number) => {
    const extra = Math.max(0, MIN_SIDE - (hi - lo + 2 * PADDING)) / 2;
    return [lo - PADDING - extra, hi + PADDING + extra];
  };
  const [x0, x1] = grow(Math.min(...xs), Math.max(...xs));
  const [y0, y1] = grow(Math.min(...ys), Math.max(...ys));
  return { x0, y0, x1, y1 };
}
