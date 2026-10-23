import { Sprite, type Container, type Graphics } from "pixi.js";
import { type GameEvent, type Ruleset, type SpectatorView } from "@castellan/shared";
import type { Arrival, Moment, PlaybackClock } from "./clock";
import { SceneDeposits } from "./deposits";
import { SceneEffects, type Effect } from "./effects";
import { SceneEntities, type Cue } from "./entities";
import { FogOfWar } from "./fog";
import { syncOccluder } from "./occlusion";
import { RAMPS } from "./palette";
import { iso } from "./projection";
import { Projectiles } from "./projectiles";
import type { SpriteSet } from "./sprites";

/** The world layers the field draws into, in the renderer's z-order. `depth` is the occlusion pass. */
export interface FieldLayers {
  objects: Container; shadows: Container; fx: Container; fog: Graphics;
  xray: Container; outlines: Container; depth: Container;
}

/**
 * The battlefield as drawn: rocks, deposits, entities and projectiles kept in step with
 * the game's frames, the fog over the ground, and the effects and sounds its events set
 * off. The renderer feeds it frames and animates it; it knows nothing of the camera,
 * input or the GPU.
 */
export class Battlefield {
  readonly entities: SceneEntities;
  readonly deposits: SceneDeposits;
  readonly fog: FogOfWar;
  private projectiles: Projectiles;
  private transient: SceneEffects;
  private effects: Effect[] = [];
  /** Terrain walls: static occluders, shown once their ground is explored. */
  private rocks: { sprite: Sprite; depth: Sprite; x: number; y: number }[] = [];
  private lastTick = -1;

  /** `play` sounds the field's events and its units' cues from where they happen. */
  constructor(private layers: FieldLayers, sprites: SpriteSet, private ruleset: Ruleset, colors: Record<string, number>, private clock: PlaybackClock, private play: Cue) {
    this.fog = new FogOfWar(layers.fog, ruleset.map.width, ruleset.map.height);
    this.entities = new SceneEntities(layers, sprites, ruleset, colors, clock, this.fog, play);
    this.deposits = new SceneDeposits(layers, sprites, ruleset.map, this.fog);
    this.projectiles = new Projectiles(layers.fx, clock);
    this.transient = new SceneEffects(layers.fx, () => clock.now());
    this.buildRocks(sprites);
  }

  /** The next game state, animated from the last one; `tickMs` is how long until the one after it. */
  show(frame: SpectatorView, tickMs: number) {
    this.present(frame, tickMs, this.lastTick < 0 ? "jump" : frame.tick === this.lastTick ? "repeat" : "tick");
  }

  /** A state elsewhere in the game: shown at once, without animation, effects or sounds. */
  seek(frame: SpectatorView, tickMs: number) {
    this.present(frame, tickMs, "jump");
  }

  animate(moment: Moment) {
    this.entities.animate(moment);
    this.deposits.animate();
    for (const rock of this.rocks) syncOccluder(rock.sprite, rock.depth);
    this.projectiles.draw(moment);
    this.effects = this.effects.filter((effect) => effect.update(moment.now));
  }

  private present(frame: SpectatorView, tickMs: number, arrival: Arrival) {
    this.lastTick = frame.tick;
    const before = this.clock.advance(frame, tickMs, arrival);
    this.fog.show(frame.visibility);
    for (const rock of this.rocks) {
      rock.sprite.visible = !frame.visibility || frame.visibility[rock.y]?.[rock.x] !== "0";
      rock.sprite.tint = this.fog.shade(RAMPS.neutral.key, rock);
    }
    for (const crumbled of this.entities.sync(frame, before, arrival)) this.effects.push(this.transient.dust(crumbled.x, crumbled.y, 0xaaaaaa, 24, 14));
    for (const mined of this.deposits.sync(frame)) if (arrival === "tick" && !frame.visibility) this.effects.push(this.transient.dust(mined.x, mined.y, RAMPS.neutral.key, 10));
    this.projectiles.sync(frame, before, arrival);
    if (arrival === "tick") for (const event of frame.events) this.react(event, frame.events);
  }

  /** Terrain walls take the art of their style; rocks vary a little in size. */
  private buildRocks(sprites: SpriteSet) {
    const style = this.ruleset.map.wallStyle ?? "rock";
    const terrainWall = style === "wall";
    const { art } = sprites(style);
    for (const w of this.ruleset.map.walls ?? []) {
      const { sx, sy } = iso(w.x, w.y);
      const sprite = new Sprite(art.texture);
      sprite.anchor.set(art.anchorX, art.anchorY);
      sprite.scale.set(art.scale * (terrainWall ? 1 : 0.85 + ((w.x * 7 + w.y * 13) % 5) * 0.06));
      sprite.tint = RAMPS.neutral.key;
      sprite.position.set(sx, sy + (terrainWall ? 0 : 3));
      sprite.zIndex = (w.x + w.y) * 10 + 4;
      this.layers.objects.addChild(sprite);
      const depth = new Sprite(art.silhouette);
      this.layers.depth.addChild(depth);
      this.rocks.push({ sprite, depth, x: w.x, y: w.y });
    }
  }

  /** What an event looks and sounds like: strikes and flashes on the entities, dust, arrows, texts and bubbles. */
  private react(ev: GameEvent, events: GameEvent[]) {
    const { kinds, map } = this.ruleset;
    if (ev.type === "attack") {
      const from = this.entities.figures.get(ev.from);
      if (!from) return;
      const to = ev.to ? this.entities.figures.get(ev.to) : undefined;
      // A real shot carries its launch vector even if its target has just died
      // or left the visible frame. Movement heading never defines this facing.
      const shot = ev.projectile ? this.projectiles.inFlight(ev.projectile) : undefined;
      const death = events.find((e): e is Extract<GameEvent, { type: "death" }> => e.type === "death" && e.id === ev.to);
      // A shootAt shot has a point instead of a target.
      const target = to?.tile ?? death ?? ev.at;
      const spec = kinds[from.view.kind];
      if ((spec?.range ?? 1) > 1) {
        const toward = shot ? { x: from.tile.x + shot.vx, y: from.tile.y + shot.vy } : target;
        if (!toward) return;
        const offset = this.entities.shoot(ev.from, toward);
        // A shot drawn from a clip leaves the shooter's sprite.
        if (shot && offset) shot.launchFrom(offset);
        if (!ev.projectile && to) this.effects.push(this.transient.arrow(from.sprite, to.sprite));
        this.play(spec?.building ? "tower" : "arrow", from.tile.x, from.tile.y, 0.35);
      } else if (target) {
        this.entities.strike(ev.from, target);
        if (to) this.entities.flash(to.view.id);
        this.effects.push(this.transient.dust(target.x, target.y, RAMPS.neutral.key, 3, 5));
        this.play("sword", target.x, target.y, 0.5);
      }
    } else if (ev.type === "projectile_end") {
      if (ev.reason === "miss") return;
      this.effects.push(this.transient.dust(ev.x, ev.y, RAMPS.neutral.key, 3, 5));
      this.play("hit", ev.x, ev.y, 0.5);
      if (ev.target) this.entities.flash(ev.target);
    } else if (ev.type === "death") {
      const vital = kinds[ev.kind]?.vital;
      const building = kinds[ev.kind]?.building;
      this.play(vital ? "horn" : building ? "collapse" : "death", ev.x, ev.y, vital ? 0.8 : building ? 0.7 : 0.4);
      if (vital) this.effects.push(this.transient.floatText(ev.kind === "king" ? "KING DOWN" : `${ev.kind.toUpperCase()} DESTROYED`, ev.x, ev.y, RAMPS.neutral.key));
    } else if (ev.type === "spawn") {
      const building = kinds[ev.kind]?.building;
      this.effects.push(this.transient.dust(ev.x, ev.y, 0xaaaaaa, building ? 14 : 6));
      this.play(building ? "build" : "spawn", ev.x, ev.y, 0.5);
    } else if (ev.type === "chat") {
      const king = [...this.entities.figures.values()].find((f) => f.view.owner === ev.owner && f.view.kind === "king");
      if (!king) return;
      this.effects.push(this.transient.bubble(`${ev.channel === "private" ? `[private → ${ev.to}] ` : ev.channel === "team" ? "[team] " : ""}${ev.text}`, king.sprite, king.tint));
      this.play("chat", king.tile.x, king.tile.y, 0.6);
    } else if (ev.type === "match_end") {
      this.play("fanfare", map.width / 2, map.height / 2, 0.6);
    }
  }
}
