import { Container, Graphics, Sprite, Text } from "pixi.js";
import { iso } from "./projection";

export interface Effect {
  /** Returns false when finished. */
  update(now: number): boolean;
}

/** Creates short-lived visuals; the caller advances them on its presentation clock. */
export class SceneEffects {
  /** `ground` holds effects under the field's objects, such as rings at a unit's feet. */
  constructor(private fx: Container, private ground: Container, private now: () => number) {}

  dust(x: number, y: number, color: number, n: number, spread = 8): Effect {
    const { sx, sy } = iso(x, y);
    const g = new Graphics();
    this.fx.addChild(g);
    const parts = Array.from({ length: n }, (_, i) => {
      const ang = (i / n) * Math.PI * 2 + Math.random();
      const sp = (0.2 + Math.random()) * (spread / 10);
      return { x: sx, y: sy - 3, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp * 0.5 - 0.4, life: 24 + Math.random() * 16 };
    });
    return {
      update: () => {
        g.clear();
        let alive = false;
        for (const p of parts) {
          if (p.life <= 0) continue;
          p.life--;
          p.vy += 0.03;
          p.x += p.vx;
          p.y += p.vy;
          g.rect(p.x, p.y, 1, 1).fill({ color, alpha: Math.min(1, p.life / 16) });
          alive = true;
        }
        if (!alive) g.destroy();
        return alive;
      },
    };
  }

  /** An arrow on a shallow arc from shooter to target. */
  arrow(from: Sprite, to: Sprite): Effect {
    const g = new Graphics();
    this.fx.addChild(g);
    const a = { x: from.x, y: from.y - from.height * 0.7 };
    const b = { x: to.x, y: to.y - 6 };
    const start = this.now();
    const ms = 220;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    return {
      update: (now) => {
        const k = (now - start) / ms;
        g.clear();
        if (k >= 1) {
          g.destroy();
          return false;
        }
        const pos = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * dist * 0.18 });
        const p = pos(k);
        const q = pos(Math.max(0, k - 0.06));
        g.moveTo(q.x, q.y).lineTo(p.x, p.y).stroke({ width: 1, color: 0xaaaaaa });
        g.rect(p.x - 0.5, p.y - 0.5, 1, 1).fill(0xffffff);
        return true;
      },
    };
  }

  /** A ring that spreads on the ground from under a body over half a second and fades: an effect confirmed on it. */
  ring(sprite: Sprite, color: number): Effect {
    const g = new Graphics();
    this.ground.addChild(g);
    const start = this.now();
    return {
      update: (now) => {
        const k = (now - start) / 500;
        g.clear();
        if (k >= 1 || sprite.destroyed) {
          g.destroy();
          return false;
        }
        g.ellipse(sprite.x, sprite.y + 2, 6 + k * 8, 3 + k * 4).stroke({ width: 1, color, alpha: 1 - k });
        return true;
      },
    };
  }

  /** A speech scroll that follows the king for a few seconds. */
  bubble(text: string, sprite: Sprite, color: number): Effect {
    const short = text.length > 80 ? text.slice(0, 77) + "…" : text;
    const box = new Container();
    const t = new Text({ text: short, style: { fontFamily: "Arial, Helvetica, sans-serif", fontSize: 8, fill: 0x000000, wordWrap: true, wordWrapWidth: 110 }, resolution: 2 });
    t.position.set(4, 2);
    const w = Math.ceil(t.width) + 8;
    const h = Math.ceil(t.height) + 4;
    const g = new Graphics();
    g.rect(0, 0, w, h).fill(0xdddddd).stroke({ width: 1, color });
    g.poly([w / 2 - 3, h, w / 2 + 3, h, w / 2, h + 4]).fill(0xdddddd);
    box.addChild(g, t);
    this.fx.addChild(box);
    const start = this.now();
    return {
      update: (now) => {
        const k = (now - start) / 6000;
        if (k >= 1 || sprite.destroyed) {
          box.destroy({ children: true });
          return false;
        }
        box.position.set(Math.round(sprite.x - w / 2), Math.round(sprite.y - sprite.height - h - 6));
        box.alpha = k > 0.85 ? (1 - k) / 0.15 : 1;
        return true;
      },
    };
  }
}
