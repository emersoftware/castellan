import type { Graphics } from "pixi.js";
import { VISIBILITY } from "@castellan/shared";
import { TILE_H, TILE_W } from "./sprites";
import { iso } from "./projection";
import { dim } from "./palette";

/** Explored ground keeps this much of its light; what stands on it dims the same way. */
const EXPLORED_LIGHT = 0.2;

/**
 * A player's fog of war over the ground: unexplored tiles opaque, explored ones dark,
 * tiles in sight clear. Objects on fogged tiles are dimmed whole (see `shade`), so a
 * tall building is never half-dark where it overlaps tiles of different visibility.
 */
export class FogOfWar {
  private visibility?: string[];

  constructor(private graphics: Graphics, private width: number, private height: number) {}

  /** Draw a frame's visibility rows ('0' unexplored, '1' explored, '2' in sight); none for the omniscient view. */
  show(visibility: string[] | undefined) {
    this.visibility = visibility;
    this.graphics.clear();
    if (!visibility) return;
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      const tile = visibility[y]?.[x];
      if (tile === VISIBILITY.visible) continue;
      const { sx, sy } = iso(x, y);
      // Unexplored tiles are opaque, so they can overlap: grow them a pixel so the
      // ground's edge never peeks out as a dotted line along the map border.
      const grow = tile === VISIBILITY.explored ? 0 : 1;
      const hw = TILE_W / 2 + grow * 2, hh = TILE_H / 2 + grow;
      this.graphics.poly([sx, sy - hh, sx + hw, sy, sx, sy + hh, sx - hw, sy]).fill({ color: 0x000000, alpha: tile === VISIBILITY.explored ? 0.8 : 1 });
    }
  }

  /** Whether a tile is in sight (always, without fog). */
  sees(at: { x: number; y: number }): boolean {
    return !this.visibility || this.visibility[at.y]?.[at.x] === VISIBILITY.visible;
  }

  /** A colour as seen on a tile: unchanged in sight, darkened like the fog on explored ground. */
  shade(color: number, at: { x: number; y: number }): number {
    return this.sees(at) ? color : dim(color, EXPLORED_LIGHT);
  }
}
