/**
 * Runs player-written bot scripts inside QuickJS compiled to WebAssembly.
 *
 * Isolation comes from two walls: the script can only touch the `self` object
 * we build for it (no host APIs are exposed), and the interpreter itself lives
 * in WASM linear memory. CPU is limited by counting QuickJS interrupt cycles
 * (deterministic, unlike wall-clock timeouts), so a replay re-running the same
 * scripts gets the same results.
 */
import { newQuickJSWASMModuleFromVariant, type QuickJSContext, type QuickJSHandle, type QuickJSRuntime, type QuickJSWASMModule } from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-singlefile-mjs-release-sync";
import type { ProjectileView, ScriptLimits, UnitOrder } from "@aoa/shared";
import { PRELUDE } from "./prelude";

let quickjs: QuickJSWASMModule | null = null;

/** Loads the WASM module once per process. Must be awaited before `createScriptHost`. */
export async function initSandbox(): Promise<void> {
  quickjs ??= await newQuickJSWASMModuleFromVariant(variant);
}

/** What a script's unit can perceive: every entity, compact. */
export interface ScriptWorld {
  reactiveOrders?: boolean;
  deposits?: { id: string; x: number; y: number; amount: number; tie: number }[];
  projectiles?: ProjectileView[];
  tick: number;
  /** The player's seat (map rotation) 0..3. */
  side: number;
  /** Units that must decide this tick, by id. */
  units: Record<string, ScriptUnit>;
  /**
   * All entities: [id, kind, owner, relation (0 enemy, 1 mine, 2 ally), x, y,
   * hp, maxHp, isBuilding (0|1), tie-break key (position in the player's own reading order)].
   */
  all: [string, string, string, number, number, number, number, number, number, number, ScriptVisibleStats?][];
  myBase: { x: number; y: number } | null;
  enemyBase: { x: number; y: number } | null;
  /** What perception helpers return: everything the player sees, or (older rules) only within the unit's vision. */
  sight?: "player" | "unit";
}

/** Public combat information only; never includes an opponent's cooldowns or orders. */
export interface ScriptVisibleStats {
  atk: number; def: number; range: number; minRange: number; vision: number;
  attackMs: number; moveMs: number; ruin: boolean;
}

export interface ScriptActionResult {
  tick: number;
  action: ScriptAction;
  status: "acted" | "blocked" | "cooldown" | "aiming" | "held" | "invalid" | "arrived";
  effect?: "move" | "attack" | "gather" | "unload";
  reason?: string;
}

export interface ScriptUnit {
  id: string;
  type: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  range: number;
  /** Blind spot: closer targets can't be attacked. */
  minRange?: number;
  vision: number;
  attackMs?: number;
  moveMs?: number;
  /** Remaining ticks at the beginning of this decision, before any unit moves. */
  attackReadyInTicks?: number;
  moveReadyInTicks?: number;
  aimReadyInTicks?: number;
  gatherReadyInTicks?: number;
  lastActionResult?: ScriptActionResult | null;
  /** Local occupancy now, independent of cooldown. null means outside current vision. */
  moves?: Record<string, boolean | null>;
  carrying?: number;
  carryCapacity?: number;
  lastAttacker?: string | null;
  lastAttackedTick?: number | null;
  order?: UnitOrder | null;
  orderSuspended?: boolean;
  events?: ScriptEvent[];
}

/** Engine-provided facts; IDs are resolved to visible entities by the sandbox. */
export type ScriptEvent =
  | { type: "attacked"; tick: number; damage: number; attacker: string | null }
  | { type: "enemy_seen"; tick: number; enemy: string }
  | { type: "order_ended"; tick: number; order: UnitOrder; reason: string };

/** The single action a unit chose. Validated by the engine, never trusted. */
export type ScriptAction =
  | { a: "hold" }
  | { a: "move"; dir: string }
  | { a: "moveTo"; x: number; y: number }
  | { a: "attack"; id: string }
  | { a: "shootAt"; x: number; y: number }
  | { a: "flee"; id: string }
  | { a: "gather"; id?: string }
  | { a: "unload" };

export interface UnitRun {
  action: ScriptAction;
  /** Independent of the single physical action: first explicit order control wins. */
  orderControl?: "continue" | "suspend" | "cancel";
  error?: string;
  log?: string;
  /** Deterministic QuickJS interrupt cycles used, including result serialization. */
  gasUsed?: number;
  /** Trusted host failure only; never parsed from player code's result. */
  operationalFailure?: true;
}

export interface ScriptHost {
  /** Compiles `code` for `kind` (null removes it). Returns a readable error on failure. */
  setScript(kind: string, code: string | null): { ok: true } | { ok: false; error: string };
  hasScript(kind: string): boolean;
  /** Runs the script of each listed unit. Units whose kind has no script hold. */
  run(world: ScriptWorld, unitIds: string[]): Record<string, UnitRun>;
  dispose(): void;
}

export type ScriptHostFactory = (limits: ScriptLimits, seed: number) => ScriptHost;

/** One isolated VM per player per match. */
export function createScriptHost(limits: ScriptLimits, seed: number): ScriptHost {
  if (!quickjs) throw new Error("call initSandbox() first");
  const runtime: QuickJSRuntime = quickjs.newRuntime();
  runtime.setMemoryLimit(limits.heapBytes);
  runtime.setMaxStackSize(256 * 1024);

  // No VM execution after bootstrap is exempt: even world loading or error
  // formatting can reach player-controlled accessors/prototypes. Load/compile
  // use the player budget; each unit additionally has its own budget.
  let bootstrapping = true;
  let meteringUnit = false;
  let unitCycles = 0;
  let playerCycles = 0;
  runtime.setInterruptHandler(() => {
    if (bootstrapping) return false;
    if (meteringUnit) unitCycles++;
    playerCycles++;
    return unitCycles > limits.gasPerUnit || playerCycles > limits.gasPerPlayer;
  });

  const ctx: QuickJSContext = runtime.newContext();
  const api = unwrap(ctx, ctx.evalCode(PRELUDE.replace("__SEED__", String(seed >>> 0)).replace("__MEMLIMIT__", String(limits.memoryBytes)), "prelude.js"));
  const loadFn = ctx.getProp(api, "load");
  const runFn = ctx.getProp(api, "run");
  api.dispose();
  bootstrapping = false;
  const scripts = new Map<string, QuickJSHandle>();

  return {
    setScript(kind, code) {
      if (code === null) {
        scripts.get(kind)?.dispose();
        scripts.delete(kind);
        return { ok: true };
      }
      if (new TextEncoder().encode(code).length > limits.maxBytes) return { ok: false, error: `script over ${limits.maxBytes} bytes` };
      meteringUnit = false;
      unitCycles = 0;
      playerCycles = 0;
      const r = ctx.evalCode(`(function (self) {"use strict";\n${code}\n})`, `${kind}.js`);
      if (r.error) {
        const error = describe(ctx, r.error);
        r.error.dispose();
        return { ok: false, error };
      }
      scripts.get(kind)?.dispose();
      scripts.set(kind, r.value);
      return { ok: true };
    },

    hasScript: (kind) => scripts.has(kind),

    run(world, unitIds) {
      const out: Record<string, UnitRun> = {};
      if (unitIds.length === 0) return out;
      playerCycles = 0;
      unitCycles = 0;
      meteringUnit = false;
      const json = ctx.newString(JSON.stringify(world));
      const loaded = ctx.callFunction(loadFn, ctx.undefined, json);
      json.dispose();
      if (loaded.error) {
        const error = playerCycles > limits.gasPerPlayer ? "player gas exhausted loading world" : describe(ctx, loaded.error);
        loaded.error.dispose();
        for (const id of unitIds) out[id] = { action: { a: "hold" }, error, gasUsed: 0 };
        return out;
      }
      loaded.value.dispose();

      for (const id of unitIds) {
        const fn = scripts.get(world.units[id].type);
        if (!fn) {
          out[id] = { action: { a: "hold" } };
          continue;
        }
        if (playerCycles > limits.gasPerPlayer) {
          out[id] = { action: { a: "hold" }, error: "player gas exhausted this tick" };
          continue;
        }
        const idH = ctx.newString(id);
        unitCycles = 0;
        meteringUnit = true;
        const r = ctx.callFunction(runFn, ctx.undefined, idH, fn);
        idH.dispose();
        if (r.error) {
          const msg = unitCycles > limits.gasPerUnit ? "out of gas"
            : playerCycles > limits.gasPerPlayer ? "player gas exhausted this tick" : describe(ctx, r.error);
          r.error.dispose();
          out[id] = { action: { a: "hold" }, error: msg, gasUsed: unitCycles };
          continue;
        }
        out[id] = parseRun(ctx.getString(r.value));
        out[id].gasUsed = unitCycles;
        r.value.dispose();
      }
      return out;
    },

    dispose() {
      for (const h of scripts.values()) h.dispose();
      loadFn.dispose();
      runFn.dispose();
      ctx.dispose();
      runtime.dispose();
    },
  };
}

/** Run finite decision scenarios in a fresh VM without changing a live match. */
export function testScript(code: string, kind: string, worlds: ScriptWorld[], limits: ScriptLimits, seed = 0, factory: ScriptHostFactory = createScriptHost):
  { ok: false; error: string } | { ok: true; frames: { tick: number; runs: Record<string, UnitRun> }[] } {
  const host = factory(limits, seed);
  try {
    const compiled = host.setScript(kind, code);
    if (!compiled.ok) return compiled;
    return { ok: true, frames: worlds.map(world => ({ tick: world.tick,
      runs: host.run(world, Object.keys(world.units).filter(id => world.units[id].type === kind)) })) };
  } finally {
    host.dispose();
  }
}

export interface RunLimits { maxBytes: number; heapBytes: number; gas: number; maxOrders: number; maxOutputBytes: number }
export const RUN_LIMITS: RunLimits = { maxBytes: 16 * 1024, heapBytes: 32 * 1024 * 1024, gas: 2_500, maxOrders: 50, maxOutputBytes: 32 * 1024 };
export interface RunResult { orders: unknown[]; logs: string[]; value: unknown; error?: string; operationalFailure?: true }

/**
 * Runs a player's one-shot script in a fresh VM: `code` is a function body with
 * `view`, `game` (the room's settings; `rules` is its former name), `act(order)` and `log(...)` in scope; its return value is sent
 * back. Gas is counted in interpreter cycles, so the cap is deterministic.
 */
export function runOnce(code: string, input: { view: unknown; rules: unknown }, limits: RunLimits = RUN_LIMITS): RunResult {
  if (!quickjs) throw new Error("call initSandbox() first");
  if (new TextEncoder().encode(code).length > limits.maxBytes) return { orders: [], logs: [], value: null, error: `script over ${limits.maxBytes} bytes` };
  const runtime = quickjs.newRuntime();
  runtime.setMemoryLimit(limits.heapBytes);
  runtime.setMaxStackSize(512 * 1024);
  let cycles = 0;
  runtime.setInterruptHandler(() => ++cycles > limits.gas);
  const ctx = runtime.newContext();
  try {
    const wrapper = `(function (input) {"use strict";
  const data = JSON.parse(input), orders = [], logs = [];
  const act = function (order) { if (orders.length >= ${limits.maxOrders}) throw new Error("more than ${limits.maxOrders} orders"); orders.push(JSON.parse(JSON.stringify(order))); };
  const log = function () { if (logs.length < 50) logs.push(Array.prototype.map.call(arguments, function (x) { return typeof x === "string" ? x : JSON.stringify(x); }).join(" ").slice(0, 500)); };
  const value = (function (view, game, rules, act, log) {"use strict";
${code}
})(data.view, data.rules, data.rules, act, log);
  return JSON.stringify({ orders: orders, logs: logs, value: value === undefined ? null : value });
})`;
    const fn = ctx.evalCode(wrapper, "run.js");
    if (fn.error) { const error = describe(ctx, fn.error); fn.error.dispose(); return { orders: [], logs: [], value: null, error }; }
    const arg = ctx.newString(JSON.stringify(input));
    const r = ctx.callFunction(fn.value, ctx.undefined, arg);
    arg.dispose(); fn.value.dispose();
    if (r.error) {
      const error = cycles > limits.gas ? `out of gas (${limits.gas})` : describe(ctx, r.error);
      r.error.dispose();
      return { orders: [], logs: [], value: null, error };
    }
    const raw = ctx.dump(r.value);
    r.value.dispose();
    if (typeof raw !== "string" || raw.length > limits.maxOutputBytes) return { orders: [], logs: [], value: null, error: `result must be JSON under ${limits.maxOutputBytes} bytes` };
    const out = JSON.parse(raw) as RunResult;
    return { orders: Array.isArray(out.orders) ? out.orders : [], logs: Array.isArray(out.logs) ? out.logs.map(String) : [], value: out.value ?? null };
  } catch (e) {
    return { orders: [], logs: [], value: null, error: (e as Error).message.slice(0, 300) };
  } finally {
    ctx.dispose();
    runtime.dispose();
  }
}

/** Compile-checks a script without any match. Used to answer uploads immediately. */
export function validateScript(code: string, limits: ScriptLimits): { ok: true } | { ok: false; error: string } {
  const host = createScriptHost(limits, 0);
  try {
    return host.setScript("check", code);
  } finally {
    host.dispose();
  }
}

function unwrap(ctx: QuickJSContext, r: ReturnType<QuickJSContext["evalCode"]>): QuickJSHandle {
  if (r.error) {
    const msg = describe(ctx, r.error);
    r.error.dispose();
    throw new Error(`sandbox prelude failed: ${msg}`);
  }
  return r.value;
}

function describe(ctx: QuickJSContext, err: QuickJSHandle): string {
  const e = ctx.dump(err);
  if (e && typeof e === "object") return String(e.message ?? e.name ?? JSON.stringify(e)).slice(0, 300);
  return String(e).slice(0, 300);
}

const DIRS = new Set(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
const ORDER_CONTROLS: NonNullable<UnitRun["orderControl"]>[] = ["continue", "suspend", "cancel"];

/** A unit's result as the VM reports it: every field is checked before use. */
type Reported = { a?: { a?: ScriptAction["a"]; dir?: unknown; x?: unknown; y?: unknown; id?: unknown }; err?: unknown; log?: unknown; orderControl?: unknown } | null;

/** The VM is untrusted: anything malformed becomes `hold`. */
function parseRun(raw: string): UnitRun {
  let r: Reported;
  try {
    r = JSON.parse(raw);
  } catch {
    return { action: { a: "hold" }, error: "bad script result" };
  }
  const a = r?.a ?? {};
  const out: UnitRun = { action: { a: "hold" } };
  if (typeof r?.err === "string") out.error = r.err.slice(0, 300);
  if (typeof r?.log === "string") out.log = r.log.slice(0, 200);
  const control = ORDER_CONTROLS.find((c) => c === r?.orderControl);
  if (control) out.orderControl = control;
  const int = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);
  if (a.a === "move" && typeof a.dir === "string" && DIRS.has(a.dir)) out.action = { a: "move", dir: a.dir };
  else if (a.a === "moveTo" && int(a.x) && int(a.y)) out.action = { a: "moveTo", x: a.x, y: a.y };
  else if ((a.a === "attack" || a.a === "flee") && typeof a.id === "string") out.action = { a: a.a, id: a.id };
  // A point, not a tile: leading a moving target needs fractions.
  else if (a.a === "shootAt" && Number.isFinite(a.x) && Number.isFinite(a.y)) out.action = { a: "shootAt", x: a.x as number, y: a.y as number };
  else if (a.a === "gather" && (a.id === undefined || typeof a.id === "string")) out.action = { a: "gather", ...(a.id === undefined ? {} : { id: a.id }) };
  else if (a.a === "unload") out.action = { a: "unload" };
  return out;
}
