/**
 * The entities on the field as Pixi objects: a body sprite with its shadow, health bar and
 * occlusion silhouette (units also carry x-ray and outline bodies for when they are hidden),
 * moved between ticks, posed from its clips, burning when a castle is damaged, and left as a
 * fading corpse when it dies. Barriers show the piece their neighbours call for.
 */
import { Container, Graphics, Sprite } from "pixi.js";
import { barrierAxes, currentKind, NEUTRAL_OWNER, type EntityView, type Ruleset, type SoundName, type SpectatorView } from "@castellan/shared";
import type { ClipArt } from "./clips";
import type { Arrival, Moment, PlaybackClock } from "./clock";
import type { FogOfWar } from "./fog";
import { animatedUnit, buildingLook, fall, strikeMs, unitLook, type FireLook, type Strike } from "./look";
import { syncOccluder } from "./occlusion";
import { PLAYER_RAMPS, RAMPS, dim } from "./palette";
import { iso } from "./projection";
import { screenDir, type SpriteSet } from "./sprites";
import { depthTint } from "./xray";

/** A drawn entity as the rest of the scene reads it. */
export interface Figure {
  readonly view: EntityView;
  /** The tile the game has it on. */
  readonly tile: { x: number; y: number };
  /** Its body, for picking and for effects that follow it. */
  readonly sprite: Sprite;
  /** The ramp key its owner's pieces are tinted with. */
  readonly tint: number;
}

/** A sound from the field: its name, the tile it comes from and its volume. */
export type Cue = (name: SoundName, x: number, y: number, volume: number) => void;

interface Drawn {
  view: EntityView;
  sprite: Sprite;
  shadow: Graphics;
  bar: Graphics;
  /** Player colour index (PLAYER_RAMPS) and the key it tints with. */
  color: number;
  tint: number;
  /** Interpolation runs from `from` to the tile the game has it on. */
  from: { x: number; y: number };
  tile: { x: number; y: number };
  /** Screen direction 0..7 (S, SE, E, NE, N, NW, W, SW) the unit faces. */
  dir: number;
  shot?: Strike;
  /** Simulation time of the next possible tile step; unchanged ticks are not idle. */
  walkUntil?: number;
  step?: { at: number; ms: number };
  /** Grid steps completed before the current interpolated step. */
  walkDistance?: number;
  /** Units: drawn where an occluder hides them. */
  xray: Sprite | null;
  outline: Sprite | null;
  /** Its silhouette in the occlusion pass. */
  depth: Sprite;
  flashUntil: number;
  lungeUntil: number;
  lunge: { x: number; y: number };
  /** Half-tile footfalls walked so far, and whether the pick is in the rock: sound cues. */
  footfalls?: number;
  pickDown?: boolean;
  /** Preserve the visible barrier shape and axis when it is destroyed. */
  barrierArt?: ClipArt;
  flame?: Sprite;
  sparks?: Graphics;
  /** One mask clips masonry, flame and particles together at a fixed ground edge. */
  collapseLayer?: Container;
}

/** A fallen entity fading on the field. */
interface Corpse {
  /** It crumbled to dust rather than playing a collapse. */
  rubble: boolean;
  /** Returns false once it has faded and been removed. */
  update(now: number): boolean;
  destroy(): void;
}

/** The piece a barrier shows: a door open or shut, a wall running along one axis (cut for doors beside it), or a post. */
function barrierPiece(view: EntityView, axes: { alongX: boolean; alongY: boolean }, doorAt: (sign: number) => boolean): ClipArt {
  if (view.kind === "door") return view.open ? "door-open" : "door";
  if (axes.alongX === axes.alongY) return "wallpost";
  const left = doorAt(1), right = doorAt(-1);
  if (left && right) return "wall-door-both";
  if (left) return "wall-door-left";
  return right ? "wall-door-right" : "wall";
}
/** Grid steps between two points, Chebyshev like the engine: a diagonal step is one step, so feet keep the same cadence. */
const gridSteps = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
/** A player's colour index (0..3) from the match's seat colours. */
const playerColor = (colors: Record<string, number>, owner: string) => (colors[owner] ?? 0) % PLAYER_RAMPS.length;
/** The ramp key an owner's pieces are tinted with; scenario pieces stay neutral. */
const ownerTint = (colors: Record<string, number>, owner: string) => owner === NEUTRAL_OWNER ? RAMPS.neutral.key : PLAYER_RAMPS[playerColor(colors, owner)].key;

export class SceneEntities {
  private drawn = new Map<string, Drawn>();
  /** The living entities by id. */
  readonly figures: ReadonlyMap<string, Figure> = this.drawn;
  private corpses: Corpse[] = [];

  /** `colors`: each player's colour index (0..3). Cues are the sounds units make as they animate. */
  constructor(
    private layers: { objects: Container; shadows: Container; fx: Container; xray: Container; outlines: Container; depth: Container },
    private sprites: SpriteSet, private ruleset: Ruleset, private colors: Record<string, number>,
    private clock: PlaybackClock, private fog: FogOfWar, private cue: Cue,
  ) {}

  /**
   * Place the frame's entities: newcomers appear, known ones move on (or snap on a seek), and
   * the gone fall or vanish. `before` is where the previous frame's movement stood. Returns the
   * tiles where buildings crumbled, for their dust.
   */
  sync(frame: SpectatorView, before: Moment, arrival: Arrival): { x: number; y: number }[] {
    const seen = new Set<string>();
    for (const e of frame.entities) {
      seen.add(e.id);
      const d = this.drawn.get(e.id);
      if (d) this.move(d, e, before, arrival);
      else this.add(e);
    }
    const crumbled: { x: number; y: number }[] = [];
    for (const [id, d] of this.drawn) {
      if (seen.has(id)) continue;
      this.drawn.delete(id);
      d.bar.destroy();
      d.xray?.destroy();
      d.outline?.destroy();
      d.depth.destroy();
      // A death seen this tick leaves a corpse; one lost to fog, a seek or a repeated frame just vanishes.
      const died = frame.events.some((ev) => ev.type === "death" && ev.id === id);
      if (arrival !== "tick" || (frame.visibility && !died)) {
        this.clearFire(d);
        d.sprite.destroy();
        d.shadow.destroy();
        continue;
      }
      const corpse = this.corpse(d);
      this.corpses.push(corpse);
      if (corpse.rubble) crumbled.push(d.tile);
    }
    if (arrival === "jump") {
      for (const corpse of this.corpses) corpse.destroy();
      this.corpses = [];
    }
    this.layoutBarriers();
    return crumbled;
  }

  /** Pose and place every entity for this instant, and advance the corpses. */
  animate(moment: Moment) {
    for (const d of this.drawn.values()) this.draw(d, moment);
    this.corpses = this.corpses.filter((corpse) => corpse.update(moment.now));
  }

  /** Where an entity is drawn now, in tiles. */
  position(id: string, moment: Moment): { x: number; y: number } | undefined {
    const d = this.drawn.get(id);
    return d && this.positionOf(d, moment);
  }

  /**
   * A ranged attack toward a tile: the shooter faces it. A kind drawn from a shoot clip starts
   * the clip at once and settles at its authoritative tile within a tick; the screen offset its
   * sprite still had from that tile is returned so a projectile can start at the sprite.
   */
  shoot(id: string, toward: { x: number; y: number }): { x: number; y: number } | undefined {
    const d = this.drawn.get(id);
    if (!d) return undefined;
    d.dir = this.facing(d, toward);
    if (strikeMs(d.view.kind) === undefined) return undefined;
    const position = this.positionOf(d, this.clock.moment());
    const visible = iso(position.x, position.y), authoritative = iso(d.tile.x, d.tile.y);
    // Settle at the authoritative tile promptly, without delaying release.
    d.walkDistance = (d.walkDistance ?? 0) + gridSteps(position, d.from);
    d.from = position;
    d.step = { at: this.clock.gameMs, ms: this.clock.gameTickMs };
    d.sprite.position.set(visible.sx, visible.sy + 3);
    d.walkUntil = undefined;
    d.shot = { at: this.clock.gameMs, dir: d.dir };
    return { x: visible.sx - authoritative.sx, y: visible.sy - authoritative.sy };
  }

  /** A melee blow toward a tile: kinds with an attack clip play it facing the target, the rest lunge at it. */
  strike(id: string, at: { x: number; y: number }) {
    const d = this.drawn.get(id);
    if (!d) return;
    const attackDir = this.facing(d, at);
    const { gameMs } = this.clock;
    if (strikeMs(d.view.kind) !== undefined) {
      // The engine may hit one tick after a step. Preserve that step's cadence and walking
      // heading instead of rushing its remainder in one tick; only the strike faces the
      // target during recovery.
      if (gameMs >= (d.walkUntil ?? 0)) d.dir = attackDir;
      d.shot = { at: gameMs, dir: attackDir };
      d.lungeUntil = 0;
    } else {
      d.dir = attackDir;
      d.lungeUntil = this.clock.now() + 140;
    }
    const a = iso(d.tile.x, d.tile.y), b = iso(at.x, at.y);
    d.lunge = { x: Math.sign(b.sx - a.sx), y: Math.sign(b.sy - a.sy) };
  }

  /** The hit entity blinks. */
  flash(id: string) {
    const d = this.drawn.get(id);
    if (d) d.flashUntil = this.clock.now() + 90;
  }

  /** Each living entity's drawable parts, for the staged entrance: buildings assemble before units. */
  *revealParts(): Iterable<{ building: boolean; parts: (Container | undefined)[] }> {
    for (const d of this.drawn.values()) yield {
      building: !!this.ruleset.kinds[d.view.kind]?.building,
      parts: [d.sprite, d.shadow, d.flame, d.sparks],
    };
  }

  private add(e: EntityView) {
    const { map, kinds } = this.ruleset;
    const color = playerColor(this.colors, e.owner);
    const spec = kinds[e.kind];
    // Start facing the middle of the map.
    const c = iso((map.width - 1) / 2, (map.height - 1) / 2);
    const p = iso(e.x, e.y);
    const dir = screenDir(c.sx - p.sx, c.sy - p.sy);
    const { art } = this.sprites(e.kind, dir);
    const sprite = new Sprite(art.texture);
    sprite.anchor.set(art.anchorX, art.anchorY);
    sprite.scale.set(art.scale);
    sprite.tint = ownerTint(this.colors, e.owner);
    // A spawn/reveal can attack in this same frame, before the animation ticker
    // runs. Arrow endpoints must already be on the map, never at Pixi's (0, 0).
    sprite.position.set(p.sx, p.sy + (spec?.building ? 0 : 3));
    let xray: Sprite | null = null;
    let outline: Sprite | null = null;
    const depth = new Sprite(art.silhouette);
    this.layers.depth.addChild(depth);
    if (!spec?.building) {
      xray = new Sprite(art.xray[color]);
      this.layers.xray.addChild(xray);
      if (art.outline) {
        outline = new Sprite(art.outline[color]);
        this.layers.outlines.addChild(outline);
      }
    }
    const r = !spec?.building ? 6 : currentKind(e.kind) === "castle" ? 22 : 12;
    const shadow = new Graphics().ellipse(0, 0, r, r / 2.6).fill({ color: 0x000000, alpha: 0.4 });
    this.layers.shadows.addChild(shadow);
    this.layers.objects.addChild(sprite);
    const bar = new Graphics();
    this.layers.fx.addChild(bar);
    this.drawn.set(e.id, {
      view: e, sprite, shadow, bar, color, tint: sprite.tint, from: { x: e.x, y: e.y }, tile: { x: e.x, y: e.y },
      dir, xray, outline, depth, flashUntil: 0, lungeUntil: 0, lunge: { x: 0, y: 0 },
    });
  }

  /** The entity's new state: units step from tile to tile at the engine's cadence, the rest hop a tick at a time. */
  private move(d: Drawn, e: EntityView, before: Moment, arrival: Arrival) {
    // A remembered enemy (fog memory) keeps its id: when sighted again it
    // reappears where it is now, not walking there from where it was last seen.
    const recalled = d.view.lastSeenMs !== undefined;
    const snap = arrival === "jump" || recalled;
    if (animatedUnit(e.kind)) {
      if (snap) {
        d.walkUntil = undefined;
        d.step = undefined;
        d.walkDistance = 0;
        d.pickDown = undefined;
        d.from = d.tile = { x: e.x, y: e.y };
      } else if (e.x !== d.tile.x || e.y !== d.tile.y) {
        const dx = e.x - d.tile.x, dy = e.y - d.tile.y;
        const { gameMs, gameTickMs } = this.clock;
        // Same timing as the engine: a diagonal step takes diagonalMove times
        // as long, and steps are quantized to ticks (380 ms at 10 Hz is four
        // ticks). Only an actual tile change renews this window.
        const moveMs = (e.stats?.moveMs ?? this.ruleset.kinds[e.kind]?.moveMs ?? gameTickMs) * (dx && dy ? this.ruleset.diagonalMove ?? 1 : 1);
        const cadence = Math.max(1, Math.round(moveMs / gameTickMs)) * gameTickMs;
        const position = this.positionOf(d, before);
        d.walkDistance = (d.walkDistance ?? 0) + gridSteps(position, d.from);
        d.from = position;
        d.tile = { x: e.x, y: e.y };
        d.step = { at: gameMs, ms: cadence };
        d.walkUntil = gameMs + cadence;
        d.dir = screenDir(dx - dy, (dx + dy) / 2);
      }
    } else {
      if (arrival !== "repeat" || recalled) d.from = snap ? { x: e.x, y: e.y } : this.positionOf(d, before);
      d.tile = { x: e.x, y: e.y };
      const mx = e.x - d.from.x;
      const my = e.y - d.from.y;
      if (Math.abs(mx) + Math.abs(my) > 0.01) d.dir = screenDir(mx - my, (mx + my) / 2);
    }
    d.view = e;
    if (arrival === "jump") d.shot = undefined;
  }

  /**
   * Walls run along x or y depending on their neighbours: the rendered piece
   * runs along y; mirrored it runs along x; corners and lone walls are posts.
   */
  private layoutBarriers() {
    const at = new Map<string, Drawn>();
    for (const d of this.drawn.values()) if (d.view.kind === "wall" || d.view.kind === "door") at.set(`${d.tile.x},${d.tile.y},${d.view.owner}`, d);
    for (const d of at.values()) {
      const axes = barrierAxes(d.tile.x, d.tile.y, (x, y) => at.has(`${x},${y},${d.view.owner}`));
      const { alongX, alongY } = axes;
      const piece = barrierPiece(d.view, axes, (sign) => at.get(`${d.tile.x + (alongX ? sign : 0)},${d.tile.y + (alongY ? sign : 0)},${d.view.owner}`)?.view.kind === "door");
      const { art } = this.sprites(piece);
      d.barrierArt = piece;
      d.sprite.texture = art.texture;
      d.sprite.anchor.set(art.anchorX, art.anchorY);
      d.sprite.scale.set(alongX && !alongY ? -art.scale : art.scale, art.scale);
      d.depth.texture = art.silhouette;
    }
  }

  private positionOf(d: Drawn, moment: Moment) {
    const k = d.step ? Math.min(1, Math.max(0, (moment.animationMs - d.step.at) / d.step.ms)) : moment.alpha;
    return { x: d.from.x + (d.tile.x - d.from.x) * k, y: d.from.y + (d.tile.y - d.from.y) * k };
  }

  /** The screen direction from the entity's tile toward a point; its current heading if the point is its own tile. */
  private facing(d: Drawn, toward: { x: number; y: number }) {
    const a = iso(d.tile.x, d.tile.y), b = iso(toward.x, toward.y);
    return b.sx !== a.sx || b.sy !== a.sy ? screenDir(b.sx - a.sx, b.sy - a.sy) : d.dir;
  }

  private draw(d: Drawn, moment: Moment) {
    const { now, alpha, animationMs } = moment;
    const { x, y } = this.positionOf(d, moment);
    const { sx, sy } = iso(x, y);
    const moving = (d.from.x !== d.tile.x || d.from.y !== d.tile.y) && alpha < 1;
    const building = this.ruleset.kinds[d.view.kind]?.building;
    let ox = 0;
    let oy = 0;
    if (moving && !animatedUnit(d.view.kind)) oy = -Math.abs(Math.sin(alpha * Math.PI * 2)) * 1.2;
    if (now < d.lungeUntil) {
      const k = Math.sin(((d.lungeUntil - now) / 140) * Math.PI);
      ox = d.lunge.x * k * 2.5;
      oy += d.lunge.y * k * 1.5;
    }
    d.sprite.position.set(sx + ox, sy + oy + (building ? 0 : 3));
    d.sprite.zIndex = Math.round((x + y) * 10) + 5;
    d.sprite.tint = this.fog.shade(now < d.flashUntil ? RAMPS.neutral.key : d.tint, d.tile);
    if (!building) this.pose(d, moment, x, y);
    const standing = building ? buildingLook(d.view, animationMs) : undefined;
    if (standing) {
      const { art } = this.sprites(d.view.kind, 1, standing.animation);
      d.sprite.texture = art.texture;
      d.sprite.anchor.set(art.anchorX, art.anchorY);
      d.sprite.scale.set(art.scale);
      d.depth.texture = art.silhouette;
      if (standing.fire && this.fog.sees(d.tile)) this.drawFire(d, standing.fire);
      else this.clearFire(d);
    }
    // Colour separates overlapping units; only the building tag enables x-ray.
    syncOccluder(d.sprite, d.depth, d.view.owner === NEUTRAL_OWNER ? undefined : d.color, this.ruleset.kinds[d.view.kind]);
    d.shadow.position.set(sx, sy + (building ? 2 : 3));
    this.drawBar(d, sx);
  }

  /** A unit's clip for this instant (striking, mining, walking or idle), with its x-ray bodies and sound cues. */
  private pose(d: Drawn, moment: Moment, x: number, y: number) {
    const { animationMs } = moment;
    if (d.shot && animationMs >= d.shot.at + (strikeMs(d.view.kind) ?? 0)) d.shot = undefined;
    // Decide locomotion from confirmed simulation ticks, not the end of
    // one tick's interpolation. This also avoids an idle flash just before
    // the next movement snapshot arrives at the cadence boundary.
    const walked = this.clock.gameMs < (d.walkUntil ?? 0) ? (d.walkDistance ?? 0) + gridSteps({ x, y }, d.from) : undefined;
    const look = unitLook(d.view, d.dir, animationMs, { walked, strike: d.shot });
    d.dir = look.heading;
    // Footfalls and pick strikes follow the animation.
    if (look.footfalls !== undefined && d.footfalls !== undefined && look.footfalls > d.footfalls) this.cue("footstep", x, y, 0.2);
    d.footfalls = look.footfalls;
    if (look.pickDown !== undefined && d.pickDown !== undefined && look.pickDown !== d.pickDown) this.cue("pick", x, y, 0.4);
    d.pickDown = look.pickDown;
    const { art, flip } = this.sprites(d.view.kind, d.shot?.dir ?? d.dir, look.animation);
    d.sprite.texture = art.texture;
    d.sprite.anchor.set(art.anchorX, art.anchorY);
    d.sprite.scale.set(flip ? -art.scale : art.scale, art.scale);
    d.depth.texture = art.silhouette;
    if (d.xray) {
      d.xray.texture = art.xray[d.color];
      d.xray.anchor.copyFrom(d.sprite.anchor);
      d.xray.scale.copyFrom(d.sprite.scale);
      d.xray.position.copyFrom(d.sprite.position);
      d.xray.tint = depthTint(d.sprite.zIndex);
      // Hidden units must survive the mask composite behind visible units.
      d.xray.zIndex = -d.sprite.zIndex;
    }
    if (d.outline && art.outline) {
      d.outline.texture = art.outline[d.color];
      d.outline.anchor.copyFrom(d.sprite.anchor);
      d.outline.scale.copyFrom(d.sprite.scale);
      d.outline.position.copyFrom(d.sprite.position);
      d.outline.tint = depthTint(d.sprite.zIndex);
      d.outline.zIndex = d.sprite.zIndex;
    }
  }

  private drawBar(d: Drawn, sx: number) {
    const { hp, maxHp } = d.view;
    d.bar.clear();
    if (hp >= maxHp) return;
    const w = this.ruleset.kinds[d.view.kind]?.building ? 22 : 12;
    const top = Math.round(d.sprite.y - d.sprite.height - 4);
    const left = Math.round(sx - w / 2);
    d.bar.rect(left - 0.5, top - 0.5, w + 1, 2.5).fill(0x000000);
    d.bar.rect(left, top, (w * hp) / maxHp, 1.5).fill(hp / maxHp > 0.35 ? d.tint : RAMPS.neutral.key);
  }

  /** A fallen entity stays on the field and fades out, like AoE corpses. */
  private corpse(d: Drawn): Corpse {
    const { way, art: fallen, at } = fall(d.view, this.ruleset.kinds[d.view.kind], d.barrierArt);
    const collapsing = way === "collapse";
    const animated = collapsing || way === "death";
    const start = this.clock.now();
    const facing = d.shot?.dir ?? d.dir;
    const barrierFlip = d.sprite.scale.x < 0;
    let previous = start, elapsed = 0;
    d.sprite.tint = collapsing ? d.tint : dim(d.tint, 0.45);
    if (way === "corpse") {
      d.sprite.anchor.set(0.5, 0.5);
      d.sprite.rotation = (Math.PI / 2) * Math.sign(d.sprite.scale.x);
      d.sprite.y -= 3;
    }
    d.sprite.zIndex -= 3;
    if (collapsing) {
      const layer = new Container(); layer.sortableChildren = true; layer.zIndex = d.sprite.zIndex;
      layer.addChild(d.sprite);
      if (d.flame) layer.addChild(d.flame);
      if (d.sparks) layer.addChild(d.sparks);
      this.layers.objects.addChild(layer); d.collapseLayer = layer;
    }
    const destroy = () => {
      this.clearFire(d);
      if (d.collapseLayer) {
        d.collapseLayer.destroy({ children: true });
        d.collapseLayer = undefined;
      } else d.sprite.destroy();
      d.shadow.destroy();
    };
    return {
      rubble: way === "rubble",
      destroy,
      update: (now) => {
        // Follow replay speed, including changes during the fall. Keep advancing
        // after the final snapshot so a lethal King hit can finish its animation.
        elapsed += Math.max(0, now - previous) * (animated ? this.clock.gameTickMs / this.clock.tickMs : 1);
        previous = now;
        const look = at(elapsed);
        if (look.animation) {
          const { art, flip } = this.sprites(fallen, facing, look.animation);
          d.sprite.texture = art.texture;
          d.sprite.anchor.set(art.anchorX, art.anchorY);
          const mirrored = collapsing && d.barrierArt ? barrierFlip : flip;
          d.sprite.scale.set(mirrored ? -art.scale : art.scale, art.scale);
        }
        if (look.fire) this.drawFire(d, look.fire);
        else this.clearFire(d);
        d.sprite.alpha = look.alpha;
        d.shadow.alpha = look.shadow;
        if (d.sprite.alpha > 0) return true;
        destroy();
        return false;
      },
    };
  }

  private clearFire(d: Drawn) {
    d.flame?.destroy(); d.sparks?.destroy();
    d.flame = undefined; d.sparks = undefined;
  }

  /** Fire and sparks use the dedicated key inside the actual game dither pass. */
  private drawFire(d: Drawn, fire: FireLook) {
    const { art } = this.sprites(d.view.kind, 1, fire.animation);
    const layer = d.collapseLayer ?? this.layers.objects;
    if (!d.flame) { d.flame = new Sprite(art.texture); layer.addChild(d.flame); }
    d.flame.texture = art.texture;
    d.flame.anchor.set(art.anchorX, art.anchorY);
    d.flame.scale.set(art.scale);
    d.flame.position.copyFrom(d.sprite.position);
    d.flame.tint = dim(RAMPS.fire.key, fire.intensity);
    d.flame.zIndex = d.sprite.zIndex + 1;
    if (!d.sparks) { d.sparks = new Graphics(); layer.addChild(d.sparks); }
    d.sparks.position.copyFrom(d.sprite.position);
    d.sparks.zIndex = d.sprite.zIndex + 2;
    d.sparks.clear();
    for (const p of fire.particles) {
      d.sparks.rect(p.x, p.y, p.size, p.size).fill(dim(RAMPS.fire.key, p.heat * fire.intensity));
    }
  }
}
