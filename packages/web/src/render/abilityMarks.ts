import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { Ability, EntityView, IntrusionSpec } from "@castellan/shared";
import type { CastClip } from "./look";
import { RAMPS, dim } from "./palette";

interface Point { x: number; y: number }

/**
 * Where a mark attaches: a drawn body, the ramp key it is tinted with, its visible height above the ground point and
 * the tile it is drawn at this instant (for depth among the field's objects).
 */
interface Body { sprite: Sprite; tint: number; height: number; at: Point }

/** The layers marks draw into: overhead signs, objects sorted by depth, and the ground under them. */
interface MarkLayers { fx: Container; objects: Container; ground: Container }

/** How long a channel's motes stay on the field after it ends, in presentation milliseconds. */
const END_MS = 450;
/** How long a mote takes from the staff to its target, in simulation milliseconds. */
const TRAVEL_MS = 900;
const MOTES = 8;
/** Motes a flare sends, and how far apart they leave the crystal, in simulation milliseconds. */
const BURST = 8;
const BURST_GAP_MS = 45;
/** How long the crystal stays bright after a flare. */
const FLARE_MS = 300;
/** A trail mote's lag behind its mote, as a fraction of the trip. */
const TRAIL = 0.04;
/** Stored-depth offset that puts a mote just in front of a unit on the same tile (units sort at +5). */
const MOTE_DEPTH = 6;
const STOPPED = dim(RAMPS.neutral.key, 0.6);

/**
 * A Wizard's abilities and their effect on an entity, drawn from its current view, so seeking, pausing and speed
 * changes never leave a stale mark:
 * - while it casts, its staff's crystal glows where the clip's frame has it and sends motes to the target, sorted by
 *   depth among the field's objects so buildings hide them. A clip with reviewed flares sends a burst at each flare,
 *   brightening the crystal; one without sends a steady stream. Soft rising motes for healing, jittering square ones
 *   for a hack, and for a conversion round ones that a dotted ring turning at the target's feet gathers;
 * - when the view carries them, the channel time over the caster (dim until the shortest channel, then bright: a channel
 *   can complete from there, certainly by the end) and the recharge left;
 * - a turning spiral over an entity running a hack's script, in its controller's colour only when the view names the
 *   controller; an owner's view carries no controller, so its spiral stays neutral. No text: marks are drawn.
 * Overhead signs stack upward from `overhead`, the free space over the body and its health bar.
 */
export class AbilityMarks {
  private overlay = new Graphics();
  private glow = new Graphics();
  private ring = new Graphics();
  private motes: Sprite[] = [];
  /** The channel last shown and, once it ends, how it went. */
  private channel?: { from: Point; to: Point; fromAt: Point; toAt: Point; tint: number; action: Ability; flares?: { times: number[]; from: Point } };
  private ended?: { at: number; confirmed: boolean; timeMs: number };
  /** Simulation time of the last draw: where the motes stood when a channel ended. */
  private timeMs = 0;

  constructor(private layers: MarkLayers) {
    layers.fx.addChild(this.overlay);
    layers.objects.addChild(this.glow);
    layers.ground.addChild(this.ring);
  }

  /**
   * `caster` is the entity itself, with `cast` its casting clip's crystal while it casts; `target` the
   * body its ability aims at, when drawn (buildings channel longer). `controllerTint` is the key of the controller the
   * view names. `timeMs` is simulation time, so motion freezes with
   * a paused replay; `now` is presentation time, for a channel's ending.
   */
  draw(view: EntityView, caster: Body & { cast?: CastClip }, overhead: number, target: (Body & { building: boolean }) | undefined,
    intrusion: IntrusionSpec | undefined, controllerTint: number | undefined, timeMs: number, now: number) {
    this.timeMs = timeMs;
    const g = this.overlay.clear();
    this.glow.clear();
    this.ring.clear();
    const { sprite } = caster;
    const casting = view.casting;
    if (casting && target && !target.sprite.destroyed) {
      this.ended = undefined;
      const { cast } = caster;
      const at = (offset: Point | undefined) => offset ? { x: sprite.x + offset.x, y: sprite.y + offset.y } : { x: sprite.x, y: sprite.y - caster.height * 0.6 };
      const from = at(cast?.crystal(clipFrame(cast, timeMs)));
      const flares = cast?.pulses.length ? flareTimes(cast, timeMs) : undefined;
      this.channel = { from, to: { x: target.sprite.x, y: target.sprite.y - target.height * 0.5 }, fromAt: caster.at, toAt: target.at, tint: caster.tint, action: casting.action,
        flares: flares && cast && { times: flares, from: at(cast.crystal(clipFrame(cast, flares.at(-1) ?? timeMs))) } };
      const flare = flares?.length ? Math.max(0, 1 - (timeMs - flares.at(-1)!) / FLARE_MS) : 0;
      const pulse = 0.5 + 0.5 * Math.sin(timeMs / 130);
      this.glow.zIndex = sprite.zIndex + 1;
      this.glow.circle(from.x, from.y, 1.6 + pulse * 1.2 + flare * 2.5).fill({ color: caster.tint, alpha: 0.35 + 0.2 * pulse + 0.4 * flare }).circle(from.x, from.y, 0.8 + flare * 0.6).fill(RAMPS.neutral.key);
      this.drawMotes(timeMs, caster.tint, 1);
      if (casting.action === "convert") this.drawGatheringRing(target.sprite, caster.tint, timeMs);
    } else this.drawEnding(now);
    let row = overhead;
    const timer = (fraction: number, color: number, from?: number) => {
      const w = 12, left = Math.round(sprite.x - w / 2), filled = w * Math.max(0, Math.min(1, fraction));
      row -= 2;
      g.rect(left - 0.5, row - 0.5, w + 1, 2).fill(0x000000);
      if (from === undefined) g.rect(left, row, filled, 1).fill(color);
      else {
        const notch = w * from;
        g.rect(left, row, Math.min(filled, notch), 1).fill(dim(color, 0.5));
        if (filled > notch) g.rect(left + notch, row, filled - notch, 1).fill(color);
        g.rect(left + notch - 0.5, row - 0.5, 1, 2).fill(RAMPS.neutral.key);
      }
    };
    if (casting?.progressMs !== undefined && casting.action !== "heal" && intrusion) {
      const channel = target?.building ? intrusion.buildingChannel : intrusion.unitChannel;
      timer(casting.progressMs / channel.maxMs, caster.tint, channel.minMs / channel.maxMs);
    }
    if (view.rechargeMs !== undefined && intrusion) timer(view.rechargeMs / intrusion.rechargeMs, dim(RAMPS.neutral.key, 0.6));
    if (view.hypno) {
      spiral(g, sprite.x, row - 4, timeMs).stroke({ width: 1, color: controllerTint ?? RAMPS.neutral.key });
      row -= 8;
    }
  }

  /**
   * The channel shown last ended at presentation time `now`: `confirmed` when an event of its action named its caster.
   * Its motes linger briefly, reaching the target for a confirmed effect, falling grey for one that stopped short.
   */
  end(confirmed: boolean, now: number) {
    if (this.channel && this.channel.action !== "heal") this.ended = { at: now, confirmed, timeMs: this.timeMs };
  }

  /** Whether anything is still on screen without a view to show: a channel's ending. */
  lingering(now: number) {
    return !!this.ended && now - this.ended.at < END_MS;
  }

  /**
   * Motes along the path from the staff to the target, each at its own phase of the trip and followed by a fainter
   * trail. `fade` scales their alpha; `fall` (0..1) drops them as a stopped channel's last motes. Each sorts at the
   * depth of the tile it passes over.
   */
  private drawMotes(timeMs: number, tint: number, fade: number, fall = 0) {
    const { to, fromAt, toAt, action, flares } = this.channel!;
    // A flare's burst leaves from where the crystal flared; a stream from where it is now.
    const from = flares ? flares.from : this.channel!.from;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const trips: number[] = flares
      ? flares.times.flatMap((at) => Array.from({ length: BURST }, (_, j) => (timeMs - at - j * BURST_GAP_MS) / TRAVEL_MS))
      : Array.from({ length: MOTES }, (_, i) => ((timeMs / TRAVEL_MS + i / MOTES) % 1 + 1) % 1);
    let used = 0;
    trips.forEach((head, i) => {
      for (const trail of [false, true]) {
        const k = head - (trail ? TRAIL : 0);
        if (k < 0 || k >= 1) continue;
        const mote = this.motes[used] ??= this.newMote();
        used++;
        let x = from.x + (to.x - from.x) * k, y = from.y + (to.y - from.y) * k;
        if (action === "heal") y -= Math.sin(k * Math.PI) * Math.min(10, length * 0.3) + (i % 3 - 1) * Math.sin(k * Math.PI) * 2;
        else if (action === "hack") {
          // A square hop sideways every few pixels: the angular look of a hack.
          const side = (Math.floor(k * length / 4) % 2 ? 1 : -1) * 1.5;
          x += -(to.y - from.y) / (length || 1) * side;
          y += (to.x - from.x) / (length || 1) * side;
        } else {
          // Conversion motes curl in as they arrive.
          const curl = k * k * Math.PI * 2, r = (1 - k) * 3;
          x += Math.cos(curl + i) * r;
          y += Math.sin(curl + i) * r * 0.5 - Math.sin(k * Math.PI) * 4;
        }
        y += fall * 6;
        mote.visible = true;
        mote.position.set(x, y);
        const size = (action === "hack" ? 1.5 : 1.8 - k * 0.5) * (trail ? 0.6 : 1);
        mote.setSize(size, size);
        mote.tint = tint;
        mote.alpha = Math.min(1, Math.sin(k * Math.PI) * 2) * fade * (trail ? 0.5 : 1);
        mote.zIndex = Math.round((fromAt.x + (toAt.x - fromAt.x) * k + fromAt.y + (toAt.y - fromAt.y) * k) * 10) + MOTE_DEPTH;
      }
    });
    for (let i = used; i < this.motes.length; i++) this.motes[i].visible = false;
  }

  private newMote() {
    const mote = new Sprite(Texture.WHITE);
    mote.label = "ability-mote";
    mote.anchor.set(0.5);
    this.layers.objects.addChild(mote);
    return mote;
  }

  /** Eight dots turning around the target's feet, on the ground: a conversion gathering. */
  private drawGatheringRing(target: Sprite, tint: number, timeMs: number) {
    for (let i = 0; i < 8; i++) {
      const a = timeMs / 500 + i * Math.PI / 4;
      this.ring.rect(target.x + Math.cos(a) * 8 - 0.5, target.y + 2 + Math.sin(a) * 4 - 0.5, 1, 1).fill({ color: tint, alpha: 0.9 });
    }
  }

  private drawEnding(now: number) {
    if (!this.channel || !this.lingering(now)) {
      this.channel = this.ended = undefined;
      for (const mote of this.motes) mote.visible = false;
      return;
    }
    const k = (now - this.ended!.at) / END_MS;
    // The trip goes on (or stops) in presentation time: the view no longer carries this channel.
    if (this.ended!.confirmed) this.drawMotes(this.ended!.timeMs + k * TRAVEL_MS * 0.5, this.channel.tint, 1 - k);
    else this.drawMotes(this.ended!.timeMs, STOPPED, 1 - k, k);
  }

  destroy() {
    for (const part of [this.overlay, this.glow, this.ring, ...this.motes]) part.destroy();
  }
}

/** The clip frame a casting loop shows at simulation time `timeMs`, as the unit's pose plays it. */
const clipFrame = (cast: CastClip, timeMs: number) => Math.floor(Math.max(0, timeMs) * cast.fps / 1000) % cast.frameCount;

/** When the clip's flares happened, up to `timeMs`, recently enough for their bursts to still be travelling. */
function flareTimes(cast: CastClip, timeMs: number): number[] {
  const loopMs = cast.frameCount * 1000 / cast.fps, oldest = timeMs - TRAVEL_MS - BURST * BURST_GAP_MS;
  const times: number[] = [];
  for (let loop = Math.floor(oldest / loopMs); loop * loopMs <= timeMs; loop++) {
    for (const frame of cast.pulses) {
      const at = loop * loopMs + frame * 1000 / cast.fps;
      if (at > oldest && at <= timeMs && at >= 0) times.push(at);
    }
  }
  return times.sort((a, b) => a - b);
}

/** A spiral of one and a half turns around (x, y), 6 display pixels across, turning with time. */
function spiral(g: Graphics, x: number, y: number, timeMs: number): Graphics {
  const turn = timeMs / 400, end = 3 * Math.PI;
  g.moveTo(x, y);
  for (let a = 0.3; a <= end; a += 0.3) {
    const r = 3 * a / end;
    g.lineTo(x + Math.cos(a + turn) * r, y + Math.sin(a + turn) * r);
  }
  return g;
}
