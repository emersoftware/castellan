import type { Ability, GameEvent, OrderEndReason, PlayerId, Ruleset, UnitOrder } from "@castellan/shared";
import { dist, intrusionLevel, intrusionOpens, NEUTRAL_OWNER } from "@castellan/shared";
import type { ScriptActionResult, ScriptResult } from "@castellan/sandbox";
import type { SimulationClock } from "./clock";
import { executorOf, type Entity, type Intent, type Player } from "./entities";

/** What a Wizard was asked to do this tick, by its order or its script. */
interface AbilityRequest { action: Ability; target: string; code?: string }

/** What a successful channel does to the world; Match owns ownership, scripts and events. */
interface AbilityEffects {
  /** Install `script` (already compiled in `player`'s VM) as `target`'s own script, run by `player`. */
  hack(target: Entity, player: PlayerId, caster: Entity, script: string, emit: (e: GameEvent) => void): void;
  /** Return an own entity with an installed script to its owner's kind script. */
  recover(target: Entity, emit: (e: GameEvent) => void): void;
  /** `player` takes `target`. */
  convert(target: Entity, player: PlayerId, caster: Entity, emit: (e: GameEvent) => void): void;
}

/** Hack payloads in players' VMs: a channel compiles one when it starts and removes it if it does not succeed. */
export interface PayloadStage {
  install(player: PlayerId, name: string, code: string): ScriptResult;
  remove(player: PlayerId, name: string): void;
}

/**
 * Wizards' heal, hack and convert. A hack changes who decides, not sides: a caster heals, hacks and converts for its owner,
 * with its owner's research, while the player whose script decides for it (under hypno, its controller) supplies the sight
 * it acts on and the VM a payload compiles in. Owns who may target what, the channels (their seeded durations, progress in range,
 * pursuit and cancellation), the shared recharge and healing over time. A channel continues only while its caster asks
 * for the same action at the same target every tick: anything else, including a new order or hold, cancels it.
 * Effects are resolved after the tick's deaths, so a dead caster or target never completes one.
 */
export class Abilities {
  /** Casters that asked for an ability this tick; the rest lose their channel and heal streak in `cancelUnrequested`. */
  private requested = new Set<string>();

  constructor(private rules: () => Ruleset, private clock: Readonly<SimulationClock>, private world: {
    players: readonly Player[];
    entities: ReadonlyMap<string, Entity>;
    ruined: ReadonlySet<PlayerId>;
  }, private deps: {
    hostile(a: PlayerId, b: PlayerId): boolean;
    canSee(player: PlayerId, x: number, y: number): boolean;
    stage: PayloadStage;
    effects: AbilityEffects;
    result(entity: Entity, status: ScriptActionResult["status"], effect?: ScriptActionResult["effect"], reason?: string): void;
    endOrder(entity: Entity, reason: OrderEndReason, emit: (e: GameEvent) => void): void;
  }, private seed: number) {}

  /** Some kind heals or intrudes: older rules have no such state, so their hashes stay as recorded. */
  get enabled(): boolean {
    return Object.values(this.rules().kinds).some((k) => k.heals || k.intrusion);
  }

  /**
   * Why `caster` cannot use `action` on `targetId`, seen by `viewer` (default: whoever decides for it now), whatever the
   * range or recharge. Undefined when it can.
   */
  reason(caster: Entity, action: Ability, targetId: string, viewer = executorOf(caster)): string | undefined {
    const target = this.world.entities.get(targetId);
    if (!target || !this.deps.canSee(viewer, target.x, target.y)) return `target ${targetId} is not visible or does not exist`;
    const side = caster.owner;
    if (target === caster) return `${action} cannot target the caster itself`;
    if (action === "heal") {
      if (!caster.spec.heals) return `${caster.kind} cannot heal`;
      if (target.spec.building) return "buildings cannot be healed";
      if (this.deps.hostile(target.owner, side)) return "heal targets your or your allies' units";
      return undefined;
    }
    const intrusion = caster.spec.intrusion;
    if (!intrusion) return `${caster.kind} cannot ${action}`;
    if (target.spec.vital) return `${target.kind} is immune to hack and convert`;
    if (target.owner === NEUTRAL_OWNER || this.world.ruined.has(target.owner)) return "ruins and neutral walls are inert";
    const opens = intrusionOpens(this.level(side, intrusion.upgrade));
    if (target.spec.building) {
      if (action === "convert") return "buildings cannot be converted";
      if (!opens.buildings) return `hacking buildings requires ${intrusion.upgrade} L${intrusionLevel("buildings")}`;
    } else if (!opens.units) return `${action} requires ${intrusion.upgrade} research`;
    const enemy = this.deps.hostile(target.owner, side);
    if (action === "convert") return enemy ? undefined : "convert targets enemy units";
    if (!enemy && !(target.owner === side && target.payload)) return "hack targets enemy entities, or your own ones running an installed script (recovery)";
    return undefined;
  }

  /**
   * The physical step for `caster`'s request this tick: heal or channel in range, approach out of range, or hold with the
   * reason it cannot. Starting a channel draws its duration and compiles a hack's payload once; repeating the same
   * action at the same target continues it with that payload, ignoring any other code.
   */
  intent(caster: Entity, request: AbilityRequest): Intent {
    this.requested.add(caster.id);
    const target = this.world.entities.get(request.target);
    const channel = caster.channel;
    const continuing = channel && request.action === channel.action && request.target === channel.target;
    if (!continuing) this.cancel(caster);
    if (request.action !== "heal") delete caster.healing;
    const refused = this.reason(caster, request.action, request.target);
    if (refused || !target) {
      if (continuing) this.cancel(caster);
      const lost = !target || !this.deps.canSee(executorOf(caster), target.x, target.y);
      return { t: "hold", reason: refused, end: lost ? "target lost" : "target not eligible" };
    }
    if (request.action === "heal") {
      if (caster.healing?.target !== target.id) caster.healing = { target: target.id, ticks: 0 };
      return this.approach(caster, target, caster.spec.heals!.range) ?? { t: "heal", id: target.id };
    }
    const intrusion = caster.spec.intrusion!;
    if (!continuing) {
      const wait = (caster.rechargeUntil ?? 0) - this.clock.tick;
      if (wait > 0) return { t: "hold", status: "cooldown", reason: `hack and convert recharge for ${wait} more ticks` };
      const player = executorOf(caster);
      let script: string | undefined;
      const code = request.code ?? "";
      // Recovering an own entity with empty code returns it to its kind's script; any other hack installs the code.
      if (request.action === "hack" && (code !== "" || target.owner !== caster.owner)) {
        script = `hack:${caster.id}:${this.clock.tick}`;
        const problem = this.stagePayload(player, script, code);
        if (problem) return { t: "hold", reason: problem, end: "target not eligible" };
      }
      const window = target.spec.building ? intrusion.buildingChannel : intrusion.unitChannel;
      caster.channel = { action: request.action, target: target.id, player, ...(script ? { script } : {}), startTick: this.clock.tick, progress: 0,
        required: this.clock.ticks(this.duration(caster.id, target.id, window, intrusion.rollMs, intrusion.chance)) };
    }
    return this.approach(caster, target, target.spec.building ? intrusion.buildingRange : intrusion.unitRange)
      ?? { t: "channel", action: caster.channel!.action, id: target.id };
  }

  /** Why `code` cannot be a hack's payload in `player`'s VM: too long or not compiling. Leaves nothing installed. */
  payloadProblem(player: PlayerId, code: string): string | undefined {
    const problem = this.stagePayload(player, PAYLOAD_CHECK, code);
    if (!problem) this.deps.stage.remove(player, PAYLOAD_CHECK);
    return problem;
  }

  /** Compiles `code` as script `name` in `player`'s VM; why it cannot be a payload, or undefined, leaving it installed. */
  private stagePayload(player: PlayerId, name: string, code: string): string | undefined {
    const max = this.rules().script.maxBytes;
    if (new TextEncoder().encode(code).length > max) return `hack code over ${max} bytes`;
    const compiled = this.deps.stage.install(player, name, code);
    return compiled.ok ? undefined : `hack code: ${compiled.error}`;
  }

  /** After every intent of the tick: casters that asked for something else lose their channel and heal streak. */
  cancelUnrequested() {
    for (const e of this.world.entities.values()) if (!this.requested.has(e.id)) this.reset(e);
    this.requested.clear();
  }

  /** `e` stops whatever ability it was using: its channel (and staged payload) and its heal streak. */
  reset(e: Entity) {
    this.cancel(e);
    delete e.healing;
  }

  /** A manual order was accepted (null: stop). Unless it repeats the ability under way at the same target, that ability ends now. */
  ordered(e: Entity, order: UnitOrder | null) {
    const same = (action: Ability, target: string) => order?.type === action && order.target === target;
    if (e.channel && !same(e.channel.action, e.channel.target)) this.cancel(e);
    if (e.healing && !same("heal", e.healing.target)) delete e.healing;
  }

  /** Drops `e`'s channel and its staged payload from the VM that compiled it (a new order, death, conversion or hack ends it). */
  cancel(e: Entity) {
    if (e.channel?.script) this.deps.stage.remove(e.channel.player, e.channel.script);
    delete e.channel;
  }

  /** Heals and channels of the tick, after deaths: positions are final, the dead are gone. One effect per target per tick. */
  resolve(ordered: readonly Entity[], intents: ReadonlyMap<string, Intent>, emit: (e: GameEvent) => void) {
    const affected = new Set<string>();
    for (const e of ordered) {
      const it = intents.get(e.id);
      if (!this.world.entities.has(e.id) || (it?.t !== "heal" && it?.t !== "channel")) continue;
      const target = this.world.entities.get(it.id);
      if (it.t === "heal") {
        if (!target || !e.healing || this.reason(e, "heal", it.id) || dist(e.x, e.y, target.x, target.y) > e.spec.heals!.range) {
          this.deps.result(e, "blocked", undefined, "target no longer visible or in range");
          continue;
        }
        // Whole hit points by elapsed time: hpPerSecond over each second of uninterrupted healing.
        const rate = e.spec.heals!.hpPerSecond, n = e.healing.ticks++;
        const amount = Math.floor((n + 1) * rate / this.clock.rate) - Math.floor(n * rate / this.clock.rate);
        const before = target.hp;
        target.hp = Math.min(target.spec.hp, target.hp + amount);
        this.deps.result(e, target.hp > before || (amount === 0 && before < target.spec.hp) ? "acted" : "held", "heal", target.hp === target.spec.hp ? "target at full health" : undefined);
        continue;
      }
      const channel = e.channel;
      if (!channel || !target) continue;
      const intrusion = e.spec.intrusion!;
      if (dist(e.x, e.y, target.x, target.y) > (target.spec.building ? intrusion.buildingRange : intrusion.unitRange)) {
        this.deps.result(e, "blocked", undefined, "target out of range");
        continue;
      }
      if (++channel.progress < channel.required) {
        this.deps.result(e, "working", channel.action);
        continue;
      }
      // Recheck at completion: ownership, control and research may have changed since the channel started.
      const refused = (executorOf(e) !== channel.player ? "control of the caster changed" : undefined)
        ?? this.reason(e, channel.action, target.id, channel.player) ?? (affected.has(target.id) ? "another effect changed the target this tick" : undefined);
      const script = channel.script;
      delete e.channel;
      if (refused) {
        if (script) this.deps.stage.remove(channel.player, script);
        this.deps.result(e, "invalid", undefined, refused);
        if (e.order?.type === channel.action) this.deps.endOrder(e, "target not eligible", emit);
        continue;
      }
      affected.add(target.id);
      e.rechargeUntil = this.clock.tick + this.clock.ticks(intrusion.rechargeMs);
      if (channel.action === "convert") this.deps.effects.convert(target, e.owner, e, emit);
      else if (script) this.deps.effects.hack(target, channel.player, e, script, emit);
      else this.deps.effects.recover(target, emit);
      this.deps.result(e, "acted", channel.action);
      if (e.order?.type === channel.action) this.deps.endOrder(e, "completed", emit);
    }
  }

  /** The ability state a Wizard's script sees. */
  scriptView(e: Entity): { healRange: number; intrusionRange: number; buildingRange: number; intrusion: { units: boolean; buildings: boolean };
    rechargeReadyInTicks: number; channel: { action: "hack" | "convert"; target: string; progressMs: number } | null } {
    const intrusion = e.spec.intrusion, level = intrusion ? this.level(e.owner, intrusion.upgrade) : 0;
    return {
      healRange: e.spec.heals?.range ?? 0, intrusionRange: intrusion?.unitRange ?? 0, buildingRange: intrusion?.buildingRange ?? 0,
      intrusion: intrusionOpens(level),
      rechargeReadyInTicks: Math.max(0, (e.rechargeUntil ?? 0) - this.clock.tick),
      channel: e.channel ? { action: e.channel.action, target: e.channel.target, progressMs: this.clock.ms(e.channel.progress) } : null,
    };
  }

  hash(e: Entity, mix: (value: number) => void) {
    for (const ch of JSON.stringify([e.owner, e.payload ?? null, e.channel ?? null, e.healing ?? null, e.rechargeUntil ?? 0])) mix(ch.charCodeAt(0));
  }

  /** Out of range: a mobile caster approaches (progress is kept), an immobile one waits. Undefined in range. */
  private approach(caster: Entity, target: Entity, range: number): Intent | undefined {
    if (dist(caster.x, caster.y, target.x, target.y) <= range) return undefined;
    return caster.spec.moveMs ? { t: "goto", x: target.x, y: target.y, range } : { t: "hold", reason: "target out of range" };
  }

  /**
   * A channel's length: one roll of `chance` every `rollMs` from `minMs`, certain at `maxMs`. Each roll is a hash of the
   * match seed, the caster, the target, the start tick and the roll's second, so no random stream depends on event order.
   */
  private duration(caster: string, target: string, window: { minMs: number; maxMs: number }, rollMs: number, chance: number): number {
    for (let ms = window.minMs; ms < window.maxMs; ms += rollMs) {
      if (unitHash(`${this.seed}:${caster}:${target}:${this.clock.tick}:${ms}`) < chance) return ms;
    }
    return window.maxMs;
  }

  /** `player`'s intrusion research level (INTRUSION_LEVELS). */
  private level(player: PlayerId, upgrade: string): number {
    return this.world.players.find((p) => p.id === player)?.upgrades[upgrade] ?? 0;
  }
}

/** The script name a hack order's code is compiled under to check it, then removed. */
const PAYLOAD_CHECK = "hack:check";

/** 32-bit FNV-1a: offset basis and prime. */
const FNV_OFFSET = 0x811c9dc5, FNV_PRIME = 0x01000193;
/** MurmurHash3's 32-bit finalizer (fmix32): shifts and multipliers that spread every input bit over the output. */
const FMIX_FIRST_SHIFT = 16, FMIX_SECOND_SHIFT = 13, FMIX_FIRST_MULTIPLIER = 0x85ebca6b, FMIX_SECOND_MULTIPLIER = 0xc2b2ae35;
const UINT32_RANGE = 4294967296;

/** FNV-1a with MurmurHash3's finalizer, as a number in [0, 1). */
function unitHash(text: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), FNV_PRIME);
  h ^= h >>> FMIX_FIRST_SHIFT; h = Math.imul(h, FMIX_FIRST_MULTIPLIER);
  h ^= h >>> FMIX_SECOND_SHIFT; h = Math.imul(h, FMIX_SECOND_MULTIPLIER);
  h ^= h >>> FMIX_FIRST_SHIFT;
  return (h >>> 0) / UINT32_RANGE;
}
