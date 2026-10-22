import { Graphics, type Container } from "pixi.js";
import type { ProjectileView, SpectatorView } from "@castellan/shared";
import type { Arrival, Moment, PlaybackClock } from "./clock";
import { iso } from "./projection";

interface Shot {
  graphic: Graphics;
  /** Where it was last drawn, in tiles; it flies on from there to the game's position. */
  from: { x: number; y: number };
  to: ProjectileView;
  /** Screen offset the streak starts from, closing over one tick. */
  launchOffset?: { x: number; y: number; at: number };
}

/** Projectiles in flight: the game's positions, interpolated between ticks and drawn as a streak with a bright head. */
export class Projectiles {
  private shots = new Map<string, Shot>();

  constructor(private fx: Container, private clock: PlaybackClock) {}

  /** The frame's projectiles: new ones appear, known ones fly on from where they were drawn, ended ones vanish at once. */
  sync(frame: SpectatorView, before: Moment, arrival: Arrival) {
    if (arrival === "jump") {
      for (const shot of this.shots.values()) shot.graphic.destroy();
      this.shots.clear();
    }
    const flying = new Set((frame.projectiles ?? []).map((p) => p.id));
    for (const [id, shot] of this.shots) {
      if (flying.has(id)) continue;
      // Impact state already includes damage: stop the shot in this same frame.
      shot.graphic.destroy();
      this.shots.delete(id);
    }
    for (const p of frame.projectiles ?? []) {
      const shot = this.shots.get(p.id);
      if (!shot) {
        const graphic = new Graphics();
        this.fx.addChild(graphic);
        this.shots.set(p.id, { graphic, from: { x: p.x, y: p.y }, to: p });
        continue;
      }
      if (arrival !== "repeat") shot.from = { x: shot.from.x + (shot.to.x - shot.from.x) * before.alpha, y: shot.from.y + (shot.to.y - shot.from.y) * before.alpha };
      shot.to = p;
    }
  }

  draw(moment: Moment) {
    for (const shot of this.shots.values()) {
      const { from, to, graphic } = shot;
      graphic.clear();
      const x = from.x + (to.x - from.x) * moment.alpha, y = from.y + (to.y - from.y) * moment.alpha;
      const head = iso(x, y), tail = iso(x - to.vx * 0.035, y - to.vy * 0.035);
      // An archer can shoot before its interpolated step finishes. Start the
      // visible arrow at that sprite and join the real trajectory in one tick.
      if (shot.launchOffset) {
        const k = Math.max(0, 1 - (moment.animationMs - shot.launchOffset.at) / this.clock.gameTickMs);
        head.sx += shot.launchOffset.x * k; head.sy += shot.launchOffset.y * k;
        tail.sx += shot.launchOffset.x * k; tail.sy += shot.launchOffset.y * k;
      }
      graphic.moveTo(tail.sx, tail.sy - 6).lineTo(head.sx, head.sy - 6).stroke({ width: 1, color: 0xaaaaaa });
      graphic.rect(head.sx - 0.5, head.sy - 6.5, 1, 1).fill(0xffffff);
    }
  }

  /** A shot in the air: its flight vector, and a way to start its streak at the shooter's sprite instead of its true position. */
  inFlight(id: string): { vx: number; vy: number; launchFrom(offset: { x: number; y: number }): void } | undefined {
    const shot = this.shots.get(id);
    if (!shot) return undefined;
    return { vx: shot.to.vx, vy: shot.to.vy, launchFrom: (offset) => { shot.launchOffset = { ...offset, at: this.clock.gameMs }; } };
  }
}
