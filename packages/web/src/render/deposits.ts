import { Graphics, Sprite, type Container } from "pixi.js";
import { seatToMap, type DepositView, type MapSpec, type SpectatorView } from "@castellan/shared";
import type { FogOfWar } from "./fog";
import { syncOccluder } from "./occlusion";
import { RAMPS } from "./palette";
import { iso } from "./projection";
import type { SpriteSet } from "./sprites";

/** Each stage has its own silhouette; all three keep the same scale and anchor. */
function depositSprite(amount: number, initialAmount: number): string {
  const remaining = amount / Math.max(1, initialAmount);
  return remaining > 2 / 3 ? "minerals-full" : remaining > 1 / 3 ? "minerals-half" : "minerals-low";
}

export function initialDepositAmount(map: MapSpec, deposit: DepositView): number {
  const shared = map.sharedDeposits.find((d) => d.x === deposit.x && d.y === deposit.y);
  if (shared) return shared.amount;
  // Each seat gets the listed deposits turned to its corner.
  const seats = map.seats ?? 2;
  for (const d of map.deposits) {
    const positions = Array.from({ length: seats }, (_, seat) => seatToMap(d.x, d.y, seat, map.width, map.height, map.origins));
    if (positions.some(([x, y]) => x === deposit.x && y === deposit.y)) return d.amount;
  }
  return Math.max(1, deposit.amount);
}

interface DrawnDeposit { view: DepositView; sprite: Sprite; shadow: Graphics; depth: Sprite }

/** Mineral deposits as drawn: art for how much is left, dimmed under fog, with a silhouette in the occlusion pass. */
export class SceneDeposits {
  private drawn = new Map<string, DrawnDeposit>();
  /** By id, for picking, hovering and selection: the view shown and its body sprite. */
  readonly figures: ReadonlyMap<string, { view: DepositView; sprite: Sprite }> = this.drawn;

  constructor(private layers: { objects: Container; shadows: Container; depth: Container }, private sprites: SpriteSet, private map: MapSpec, private fog: FogOfWar) {}

  /** Show the frame's deposits; returns those mined out since the last frame. */
  sync(frame: SpectatorView): DepositView[] {
    const seen = new Set<string>();
    for (const dv of frame.deposits) {
      seen.add(dv.id);
      const { art } = this.sprites(depositSprite(dv.amount, initialDepositAmount(this.map, dv)));
      let d = this.drawn.get(dv.id);
      if (!d) {
        const { sx, sy } = iso(dv.x, dv.y);
        const sprite = new Sprite(art.texture);
        sprite.anchor.set(art.anchorX, art.anchorY);
        sprite.tint = RAMPS.neutral.key;
        sprite.position.set(sx, sy + 2);
        sprite.zIndex = (dv.x + dv.y) * 10 + 1;
        const shadow = new Graphics().ellipse(sx, sy + 3, 12, 4).fill({ color: 0x000000, alpha: 0.35 });
        this.layers.shadows.addChild(shadow);
        this.layers.objects.addChild(sprite);
        const depth = new Sprite(art.silhouette);
        this.layers.depth.addChild(depth);
        d = { view: dv, sprite, shadow, depth };
        this.drawn.set(dv.id, d);
      }
      d.sprite.texture = art.texture;
      d.sprite.anchor.set(art.anchorX, art.anchorY);
      d.sprite.scale.set(art.scale);
      d.sprite.tint = this.fog.shade(RAMPS.neutral.key, dv);
      d.depth.texture = art.silhouette;
      d.view = dv;
    }
    const mined: DepositView[] = [];
    for (const [id, d] of this.drawn) {
      if (seen.has(id)) continue;
      mined.push(d.view);
      d.sprite.destroy();
      d.shadow.destroy();
      d.depth.destroy();
      this.drawn.delete(id);
    }
    return mined;
  }

  /** Mirror each deposit into the occlusion pass. */
  animate() {
    for (const d of this.drawn.values()) syncOccluder(d.sprite, d.depth);
  }
}
