import type { Grid } from "./grid";

/** What stands on rock-wall terrain. No entity or deposit has this id. */
const ROCK = "#rock";

/** An entity as the board places it: doors share their tile with one allied unit, anything else stands on it. */
interface Piece { id: string; x: number; y: number; spec: { building: boolean; alliedPassage?: boolean } }

/**
 * The tiles of a match: what stands on each one (a unit, a building, a deposit or rock), the doors
 * allied units may share, and the sites active construction reserves. Every change to a static tile
 * bumps `version`, which keys cached paths, so no change can leave a stale route behind.
 */
export class Board implements Grid {
  private standing: (string | null)[];
  private doors = new Map<number, string>();
  private sites = new Map<number, string>();
  private staticVersion = 0;

  /** `staticOccupant`: whether the id standing on a tile never moves (a deposit or a building). */
  constructor(readonly width: number, readonly height: number, private staticOccupant: (id: string) => boolean) {
    this.standing = new Array(width * height).fill(null);
  }

  /** Changes whenever a static tile does. */
  version(): number {
    return this.staticVersion;
  }

  isStatic(x: number, y: number): boolean {
    const tile = y * this.width + x, id = this.standing[tile];
    return this.doors.has(tile) || this.sites.has(tile) || (id !== null && (id === ROCK || this.staticOccupant(id)));
  }

  /** The id standing on a tile, or null. Rock stands too, under an id that is no entity's; doors do not stand. */
  occupant(x: number, y: number): string | null {
    return this.standing[y * this.width + x];
  }

  door(x: number, y: number): string | undefined {
    return this.doors.get(y * this.width + x);
  }

  hasDoors(): boolean {
    return this.doors.size > 0;
  }

  /** The builder whose construction reserves a tile. */
  site(x: number, y: number): string | undefined {
    return this.sites.get(y * this.width + x);
  }

  placeRock(x: number, y: number) {
    this.standing[y * this.width + x] = ROCK;
  }

  placeDeposit(id: string, x: number, y: number) {
    this.standing[y * this.width + x] = id;
  }

  /** An exhausted deposit frees its tile. */
  clearDeposit(x: number, y: number) {
    this.standing[y * this.width + x] = null;
    this.staticVersion++;
  }

  place(e: Piece) {
    if (e.spec.alliedPassage) this.doors.set(e.y * this.width + e.x, e.id);
    else this.standing[e.y * this.width + e.x] = e.id;
    if (e.spec.building) this.staticVersion++;
  }

  remove(e: Piece) {
    if (e.spec.alliedPassage) this.doors.delete(e.y * this.width + e.x);
    else this.standing[e.y * this.width + e.x] = null;
    if (e.spec.building) this.staticVersion++;
  }

  /** A unit's step from its tile to (x, y). Units are never static, so routes stay valid. */
  move(e: Piece, x: number, y: number) {
    this.standing[e.y * this.width + e.x] = null;
    this.standing[y * this.width + x] = e.id;
  }

  reserve(x: number, y: number, builder: string) {
    this.sites.set(y * this.width + x, builder);
    this.staticVersion++;
  }

  /** Frees a site, if `builder`'s construction still holds it. */
  release(x: number, y: number, builder: string) {
    const tile = y * this.width + x;
    if (this.sites.get(tile) !== builder) return;
    this.sites.delete(tile);
    this.staticVersion++;
  }
}
