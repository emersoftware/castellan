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
import type { ScriptLimits } from "@aoa/shared";
import { PRELUDE } from "./prelude";

let quickjs: QuickJSWASMModule | null = null;

/** Loads the WASM module once per process. Must be awaited before `createScriptHost`. */
export async function initSandbox(): Promise<void> {
  quickjs ??= await newQuickJSWASMModuleFromVariant(variant);
}

/** What a script's unit can perceive: every entity, compact. */
export interface ScriptWorld {
  tick: number;
  /** The player's seat (map rotation) 0..3. */
  side: number;
  /** Units that must decide this tick, by id. */
  units: Record<string, ScriptUnit>;
  /**
   * All entities: [id, kind, owner, relation (0 enemy, 1 mine, 2 ally), x, y,
   * hp, maxHp, isBuilding (0|1), tie-break key (position in the player's own reading order)].
   */
  all: [string, string, string, number, number, number, number, number, number, number][];
  myBase: { x: number; y: number } | null;
  enemyBase: { x: number; y: number } | null;
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
  vision: number;
  attackMs?: number;
  moveMs?: number;
}

/** The single action a unit chose. Validated by the engine, never trusted. */
export type ScriptAction =
  | { a: "hold" }
  | { a: "move"; dir: string }
  | { a: "moveTo"; x: number; y: number }
  | { a: "attack"; id: string }
  | { a: "flee"; id: string };

export interface UnitRun {
  action: ScriptAction;
  error?: string;
  log?: string;
}

export interface ScriptHost {
  /** Compiles `code` for `kind` (null removes it). Returns a readable error on failure. */
  setScript(kind: string, code: string | null): { ok: true } | { ok: false; error: string };
  hasScript(kind: string): boolean;
  /** Runs the script of each listed unit. Units whose kind has no script hold. */
  run(world: ScriptWorld, unitIds: string[]): Record<string, UnitRun>;
  dispose(): void;
}

/** One isolated VM per player per match. */
export function createScriptHost(limits: ScriptLimits, seed: number): ScriptHost {
  if (!quickjs) throw new Error("call initSandbox() first");
  const runtime: QuickJSRuntime = quickjs.newRuntime();
  runtime.setMemoryLimit(limits.heapBytes);
  runtime.setMaxStackSize(256 * 1024);

  // Gas accounting. `metering` is off while we load the world so only script work counts.
  let metering = false;
  let unitCycles = 0;
  let playerCycles = 0;
  runtime.setInterruptHandler(() => {
    if (!metering) return false;
    unitCycles++;
    playerCycles++;
    return unitCycles > limits.gasPerUnit || playerCycles > limits.gasPerPlayer;
  });

  const ctx: QuickJSContext = runtime.newContext();
  const api = unwrap(ctx, ctx.evalCode(PRELUDE.replace("__SEED__", String(seed >>> 0)).replace("__MEMLIMIT__", String(limits.memoryBytes)), "prelude.js"));
  const loadFn = ctx.getProp(api, "load");
  const runFn = ctx.getProp(api, "run");
  api.dispose();
  const scripts = new Map<string, QuickJSHandle>();

  return {
    setScript(kind, code) {
      scripts.get(kind)?.dispose();
      scripts.delete(kind);
      if (code === null) return { ok: true };
      if (new TextEncoder().encode(code).length > limits.maxBytes) return { ok: false, error: `script over ${limits.maxBytes} bytes` };
      metering = true;
      unitCycles = 0;
      playerCycles = 0;
      const r = ctx.evalCode(`(function (self) {"use strict";\n${code}\n})`, `${kind}.js`);
      metering = false;
      if (r.error) {
        const error = describe(ctx, r.error);
        r.error.dispose();
        return { ok: false, error };
      }
      scripts.set(kind, r.value);
      return { ok: true };
    },

    hasScript: (kind) => scripts.has(kind),

    run(world, unitIds) {
      const out: Record<string, UnitRun> = {};
      if (unitIds.length === 0) return out;
      const json = ctx.newString(JSON.stringify(world));
      const loaded = ctx.callFunction(loadFn, ctx.undefined, json);
      json.dispose();
      if (loaded.error) {
        loaded.error.dispose();
        for (const id of unitIds) out[id] = { action: { a: "hold" }, error: "sandbox out of memory" };
        return out;
      }
      loaded.value.dispose();

      playerCycles = 0;
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
        metering = true;
        const r = ctx.callFunction(runFn, ctx.undefined, idH, fn);
        metering = false;
        idH.dispose();
        if (r.error) {
          const msg = describe(ctx, r.error);
          r.error.dispose();
          out[id] = { action: { a: "hold" }, error: unitCycles > limits.gasPerUnit ? "out of gas" : msg };
          continue;
        }
        out[id] = parseRun(ctx.getString(r.value));
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

/** The VM is untrusted: anything malformed becomes `hold`. */
function parseRun(raw: string): UnitRun {
  let r: any;
  try {
    r = JSON.parse(raw);
  } catch {
    return { action: { a: "hold" }, error: "bad script result" };
  }
  const a = r?.a ?? {};
  const out: UnitRun = { action: { a: "hold" } };
  if (typeof r?.err === "string") out.error = r.err.slice(0, 300);
  if (typeof r?.log === "string") out.log = r.log.slice(0, 200);
  const int = (n: unknown) => typeof n === "number" && Number.isInteger(n);
  if (a.a === "move" && DIRS.has(a.dir)) out.action = { a: "move", dir: a.dir };
  else if (a.a === "moveTo" && int(a.x) && int(a.y)) out.action = { a: "moveTo", x: a.x, y: a.y };
  else if ((a.a === "attack" || a.a === "flee") && typeof a.id === "string") out.action = { a: a.a, id: a.id };
  return out;
}
