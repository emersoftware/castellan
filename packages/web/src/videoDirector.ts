import type { SpectatorView } from "@castellan/shared";
import { cameraActivity, fightBox, type CameraBox } from "./showcaseCamera";
import type { ScriptLoad } from "./scripts";
import { playerPerspective } from "./perspective";

/** What a video shows at one tick: a battle (tiles to frame, under the fog of its bigger army) or the whole map. */
export interface VideoShot { box: CameraBox | null; pov: string | null }
/** From `tick` until `until`, the unit panel shows `unit` and the script its kind runs. */
export interface ScriptReveal { tick: number; until: number; unit: string }

const RADIUS = 7;
const MIN_POINTS = 6;

type Point = { x: number; y: number };
const near = (a: Point, b: Point) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= RADIUS;
const mean = (points: Point[]) => ({ x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length });
const inBox = (e: Point, b: CameraBox) => e.x >= b.x0 && e.x <= b.x1 && e.y >= b.y0 && e.y <= b.y1;

/** The fighters around the place with most combat among `points`, or none below MIN_POINTS. */
function densest(points: Point[]): Point[] {
  let best: Point[] = [];
  for (const p of points) {
    const around = points.filter(o => near(p, o));
    if (around.length > best.length) best = around;
  }
  return best.length >= MIN_POINTS ? best : [];
}

/**
 * One shot per frame. The camera looks a little ahead and frames the biggest fight about to happen,
 * under the fog of the player with most army in it. It stays on that fight while it moves, until
 * that player's army or all of its enemies' are gone from the shot, or the fighting stops; then it
 * goes to the next fight. Before each fight, while the camera has nothing else to show, it follows
 * that army's units on their way there, from the moment they leave the owner's buildings. With no
 * fight or march anywhere, the whole map, with nobody's fog.
 */
export function planVideoShots(frames: SpectatorView[], tickRate: number, isArmy: (kind: string) => boolean, isBuilding: (kind: string) => boolean): VideoShot[] {
  const s = (seconds: number) => Math.round(seconds * tickRate);
  const lookahead = s(2), memory = s(1), longestMarch = s(25), idleMarch = s(8);
  const activity = frames.map(f => cameraActivity(f).points);
  const pointsIn = (from: number, to: number) => activity.slice(Math.max(0, from), Math.max(0, to)).flat();
  const team = new Map(frames[0]?.players.map(p => [p.id, p.team]) ?? []);
  const armies = (frame: SpectatorView, box: CameraBox) => {
    const count = new Map<string, number>();
    for (const e of frame.entities) if (isArmy(e.kind) && !e.construction && inBox(e, box)) count.set(e.owner, (count.get(e.owner) ?? 0) + 1);
    return count;
  };
  /** The player with most army in the box over the coming seconds; on a tie, the earlier `previous`. */
  const biggest = (t: number, box: CameraBox, previous: string | null) => {
    for (let i = t; i < Math.min(frames.length, t + lookahead + 1); i++) {
      const count = armies(frames[i], box);
      if (!count.size) continue;
      const top = Math.max(...count.values());
      const leaders = [...count].filter(([, n]) => n === top).map(([owner]) => owner);
      return previous && leaders.includes(previous) ? previous : leaders[0];
    }
    return null;
  };

  const shots: VideoShot[] = [];
  let battle: { centre: Point; box: CameraBox; pov: string | null; met: boolean } | null = null;
  let lastPov: string | null = null;
  const starts: { tick: number; box: CameraBox; pov: string }[] = [];
  for (let t = 0; t < frames.length; t++) {
    if (battle) {
      const fighting = pointsIn(t - memory, t + lookahead).filter(p => near(battle!.centre, p));
      if (!fighting.length) battle = null;
      else {
        battle.centre = mean(fighting);
        battle.box = fightBox(fighting);
        if (battle.pov) {
          const count = armies(frames[t], battle.box);
          const own = count.get(battle.pov) ?? 0;
          const enemies = [...count].filter(([owner]) => team.get(owner) !== team.get(battle!.pov!)).reduce((sum, [, n]) => sum + n, 0);
          if (own && enemies) battle.met = true;
          // Once both sides have met in the shot, the fight is over when one of them is gone.
          else if (battle.met) battle = null;
        }
      }
    }
    if (!battle) {
      const cluster = densest(pointsIn(t, t + lookahead));
      if (cluster.length) {
        const box = fightBox(cluster);
        battle = { centre: mean(cluster), box, pov: biggest(t, box, lastPov), met: false };
        lastPov = battle.pov;
        if (battle.pov) starts.push({ tick: t, box, pov: battle.pov });
      }
    }
    shots.push(battle ? { box: battle.box, pov: battle.pov } : { box: null, pov: null });
  }

  // The march: back from each fight, the units that brought its army there.
  for (const { tick, box, pov } of starts) {
    const arriving = frames.slice(tick, tick + lookahead + 1).find(f => f.entities.some(e => e.owner === pov && isArmy(e.kind) && inBox(e, box)));
    const group = new Set(arriving?.entities.filter(e => e.owner === pov && isArmy(e.kind) && inBox(e, box)).map(e => e.id));
    const march: VideoShot[] = [];
    let left = false;
    for (let t = tick - 1; t >= Math.max(0, tick - longestMarch) && !shots[t].box; t--) {
      const units = frames[t].entities.filter(e => group.has(e.id));
      if (!units.length) break;
      march.push({ box: fightBox(units), pov });
      const centre = mean(units);
      if (frames[t].entities.some(e => e.owner === pov && isBuilding(e.kind) && near(centre, e))) { left = true; break; }
    }
    // Units that were already out in the field are followed only for their last seconds.
    (left ? march : march.slice(0, idleMarch)).forEach((shot, i) => { shots[tick - 1 - i] = shot; });
  }
  return shots;
}

/**
 * When to open each accepted script upload, as a viewer would by clicking a unit of that kind, so that
 * the unit is on screen: inside a battle's shot and out of its fog, or anywhere while the camera has
 * no battle (it then goes to the unit, see `withReveals`). It opens at the upload, or once such a unit
 * is in view, after the previous panel; it closes after `hold` ticks, or earlier if the unit dies or
 * leaves the view. An upload replaced before its panel would close (the panel shows the newer one),
 * or with no such unit in view within `wait` ticks, is skipped.
 */
export function planScriptReveals(loads: readonly ScriptLoad[], frames: SpectatorView[], shots: readonly VideoShot[], hold: number, wait: number): ScriptReveal[] {
  const inView = (t: number, id: string) => {
    const unit = frames[t]?.entities.find(e => e.id === id), shot = shots[t];
    if (!unit || !shot) return false;
    if (!shot.box) return true;
    return inBox(unit, shot.box) && (!shot.pov || !!playerPerspective(frames[t], shot.pov)?.entities.some(e => e.id === id));
  };
  const reveals: ScriptReveal[] = [];
  let free = 0;
  loads.forEach((load, i) => {
    if (load.code === null) return;
    const replaced = loads.slice(i + 1).find(l => l.player === load.player && l.kind === load.kind)?.tick ?? Infinity;
    for (let t = Math.max(load.tick, free); t < Math.min(frames.length, load.tick + wait); t++) {
      const unit = frames[t].entities.find(e => e.owner === load.player && e.kind === load.kind && !e.construction && inView(t, e.id));
      if (!unit) continue;
      if (replaced < t + hold) return;
      let until = t + 1;
      while (until < Math.min(frames.length, t + hold) && inView(until, unit.id)) until++;
      reveals.push({ tick: t, until, unit: unit.id });
      free = until;
      return;
    }
  });
  return reveals;
}

/** `shots` with the camera on each revealed unit, following it, where it would otherwise show the whole map. */
export function withReveals(shots: readonly VideoShot[], reveals: readonly ScriptReveal[], frames: SpectatorView[]): VideoShot[] {
  const result = shots.slice();
  for (const { tick, until, unit } of reveals) {
    for (let t = tick; t < until; t++) {
      const e = frames[t].entities.find(x => x.id === unit);
      if (e && !result[t].box) result[t] = { box: fightBox([e]), pov: null };
    }
  }
  return result;
}

/**
 * The match's biggest battle, for its preview picture: the second with most combat in one place,
 * sampled every second, and the tiles around it; null without any fight.
 */
export function biggestBattle(frames: SpectatorView[], tickRate: number): { tick: number; box: CameraBox } | null {
  const activity = frames.map(f => cameraActivity(f).points);
  let best: { tick: number; cluster: Point[] } | null = null;
  for (let t = 0; t < frames.length; t += Math.max(1, Math.round(tickRate))) {
    const cluster = densest(activity.slice(t, t + Math.round(tickRate)).flat());
    if (cluster.length > (best?.cluster.length ?? 0)) best = { tick: t, cluster };
  }
  return best && { tick: best.tick, box: fightBox(best.cluster) };
}

/** The first tick the camera leaves the whole map, where a recording's story starts; null without one. */
export function storyStart(shots: readonly VideoShot[]): number | null {
  const tick = shots.findIndex(shot => shot.box);
  return tick < 0 ? null : tick;
}
