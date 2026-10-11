import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import type { ScriptLimits } from "@aoa/shared";
import { RUN_LIMITS, type RunLimits, type RunResult, type ScriptHost, type UnitRun } from "@aoa/sandbox";

const STARTING = 0, IDLE = 1, REQUEST = 2, RESPONSE = 3, FAILED = 4, RUNNING = 5;
const HEADER_BYTES = 16;
const TRANSPORT_BYTES = 1024 * 1024;
const WORKER_URL = new URL("./script-worker.mjs", import.meta.url);
let workerSource: string | undefined;

/** A timeout result is advisory: the notifying worker may have completed while
 * this thread was descheduled. Always re-read the shared state before killing it. */
export function waitForStateChange(header: Int32Array, state: number, timeout: number): boolean {
  const deadline = performance.now() + timeout;
  while (Atomics.load(header, 0) === state) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) return Atomics.load(header, 0) !== state;
    Atomics.wait(header, 0, state, remaining);
  }
  return true;
}

export interface IsolationLimits {
  /** Emergency wall-clock deadline; deterministic QuickJS gas remains primary. */
  timeoutMs: number;
  startupTimeoutMs: number;
  /** OS scheduling before trusted worker code starts; not script execution. */
  dispatchTimeoutMs?: number;
}
export const ISOLATION_LIMITS: IsolationLimits = { timeoutMs: 250, startupTimeoutMs: 10_000, dispatchTimeoutMs: 1000 };

function worker(data: unknown) {
  // Only trusted repository sources are bundled. This removes runtime loader
  // dependencies on the parent event loop while it is in Atomics.wait.
  workerSource ??= buildSync({ entryPoints: [fileURLToPath(WORKER_URL)], bundle: true, write: false,
    platform: "node", format: "cjs", target: "node22", logLevel: "silent",
    // The single-file WASM package uses createRequire(import.meta.url) on Node.
    // Its WASM is embedded; a stable file URL is sufficient in the eval bundle.
    define: { "import.meta.url": JSON.stringify(WORKER_URL.href) } }).outputFiles[0].text;
  const w = new Worker(workerSource, { eval: true, workerData: data,
    execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
  w.unref();
  return w;
}

/** A persistent player VM on another thread. Atomics.wait's timeout is enforced
 * outside QuickJS, so even a native operation with no interrupt checks cannot
 * retain the simulation thread indefinitely. A timed-out VM stays terminated;
 * subsequent decisions explicitly hold with its error, never reset memory.
 */
export function createIsolatedScriptHost(limits: ScriptLimits, seed: number, isolation: IsolationLimits = ISOLATION_LIMITS): ScriptHost {
  const shared = new SharedArrayBuffer(HEADER_BYTES + TRANSPORT_BYTES);
  const header = new Int32Array(shared, 0, 4), bytes = new Uint8Array(shared, HEADER_BYTES);
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const w = worker({ mode: "host", shared, limits, seed });
  const installed = new Set<string>();
  let failure: string | null = null;
  const stop = (reason: string) => {
    failure ??= reason;
    void w.terminate();
  };
  w.on("error", error => stop(`sandbox worker failed: ${error.message.slice(0, 200)}`));
  w.on("exit", code => { if (!failure) failure = `sandbox worker exited (${code})`; });

  function waitWhile(state: number, timeout: number): boolean {
    return waitForStateChange(header, state, timeout);
  }
  function read(): { ok: true; value: unknown } | { ok: false; error: string } {
    const length = Atomics.load(header, 2);
    if (length < 1 || length > bytes.length) return { ok: false, error: "invalid sandbox response length" };
    try { return JSON.parse(decoder.decode(bytes.subarray(0, length))); }
    catch { return { ok: false, error: "invalid sandbox response" }; }
  }
  if (!waitWhile(STARTING, isolation.startupTimeoutMs)) stop("sandbox worker startup timed out");
  else if (Atomics.load(header, 0) === FAILED) {
    const response = read();
    stop(`sandbox worker startup failed: ${response.ok ? "unknown error" : response.error}`);
  } else if (Atomics.load(header, 0) !== IDLE) stop("sandbox worker failed to initialize");
  if (failure) throw new Error(failure);

  function call(request: unknown) {
    if (failure) return { ok: false as const, error: failure };
    const encoded = encoder.encode(JSON.stringify(request));
    if (encoded.length > bytes.length) return { ok: false as const, error: "sandbox request exceeds transport limit" };
    bytes.set(encoded);
    Atomics.store(header, 1, encoded.length);
    Atomics.store(header, 0, REQUEST);
    Atomics.notify(header, 0);
    const dispatchMs = isolation.dispatchTimeoutMs ?? 1000;
    if (!waitWhile(REQUEST, dispatchMs)) {
      stop(`sandbox dispatch timeout after ${dispatchMs}ms; player VM terminated`);
      return { ok: false as const, error: failure! };
    }
    if (Atomics.load(header, 0) === RUNNING && !waitWhile(RUNNING, isolation.timeoutMs)) {
      stop(`sandbox watchdog timeout after ${isolation.timeoutMs}ms; player VM terminated`);
      return { ok: false as const, error: failure! };
    }
    if (Atomics.load(header, 0) !== RESPONSE) {
      stop("sandbox worker stopped unexpectedly");
      return { ok: false as const, error: failure! };
    }
    return read();
  }

  return {
    setScript(kind, code) {
      const response = call({ op: "setScript", kind, code });
      if (!response.ok) return response;
      const result = response.value as ReturnType<ScriptHost["setScript"]>;
      if (result.ok) code === null ? installed.delete(kind) : installed.add(kind);
      return result;
    },
    hasScript: kind => installed.has(kind),
    run(world, unitIds) {
      if (!unitIds.length) return {};
      const response = call({ op: "run", world, unitIds });
      if (response.ok) return response.value as Record<string, UnitRun>;
      return Object.fromEntries(unitIds.map(id => [id, { action: { a: "hold" as const }, error: response.error, gasUsed: 0, operationalFailure: true as const }]));
    },
    dispose() { stop("sandbox disposed"); },
  };
}

function isolatedRequest<T>(request: unknown, isolation: IsolationLimits): Promise<T> {
  return new Promise((resolve, reject) => {
    const w = worker({ mode: "once" });
    let settled = false, ready = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void w.terminate();
      error ? reject(error) : resolve(value!);
    };
    let timer = setTimeout(() => finish(new Error("sandbox worker startup timed out")), isolation.startupTimeoutMs);
    w.on("error", error => finish(error));
    w.on("exit", code => { if (!settled) finish(new Error(`sandbox worker exited (${code})`)); });
    w.on("message", message => {
      if (message.type === "ready" && !ready) {
        ready = true;
        clearTimeout(timer);
        timer = setTimeout(() => finish(new Error(`sandbox watchdog timeout after ${isolation.timeoutMs}ms; request terminated`)), isolation.timeoutMs);
        w.postMessage(request);
      } else if (message.type === "result") finish(undefined, message.value);
      else if (message.type === "error") finish(new Error(message.error));
    });
  });
}

/** /run gets a fresh supervised VM; compilation and result formatting are inside
 * the same worker as evaluation. No orders are returned after a timeout.
 */
export async function runOnceIsolated(code: string, input: { view: unknown; rules: unknown }, limits: RunLimits = RUN_LIMITS, isolation: IsolationLimits = ISOLATION_LIMITS): Promise<RunResult> {
  try { return await isolatedRequest<RunResult>({ op: "runOnce", code, input, limits }, isolation); }
  catch (error) { return { orders: [], logs: [], value: null, error: (error as Error).message, operationalFailure: true }; }
}

export async function validateScriptIsolated(code: string, limits: ScriptLimits, isolation: IsolationLimits = ISOLATION_LIMITS): Promise<ReturnType<ScriptHost["setScript"]>> {
  try { return await isolatedRequest({ op: "validate", code, limits }, isolation); }
  catch (error) { return { ok: false, error: (error as Error).message }; }
}
