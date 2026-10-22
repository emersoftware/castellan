// @ts-check
// How every keeper plays its seat, whatever harness makes the decisions: one decision in
// flight, each turn built from the observations since the last delivered tick, and the same
// pacing, retries and activity reports. A keeper supplies only how one decision runs.
import { setTimeout as sleep } from "node:timers/promises";
import { reportActivity } from "./metadata.mjs";
import { observedSeat, seat, seatOver } from "./game.mjs";
import { MIN_INTERVAL_MS, turnFor } from "./turns.mjs";

/**
 * How one keeper runs a decision. `decide` resolves with the harness conversation to resume, or rejects
 * with an error that may carry `session` (a partial conversation to keep), `fatal` (stop the seat) or
 * `retryAfterMs` (the provider asked to wait: not a failure). Aborting its `signal` must end the decision.
 * @typedef {{
 *   name: string,
 *   prompt: string,
 *   decide: (turn: string, context: { session: string | undefined, signal: AbortSignal }) => Promise<{ session: string }>,
 *   env?: NodeJS.ProcessEnv,
 *   fetchImpl?: typeof fetch,
 *   signal?: AbortSignal,
 *   minIntervalMs?: number,
 *   pollMs?: number,
 *   maxFailures?: number,
 *   backoffMs?: (failures: number) => number,
 *   warn?: (text: string) => void,
 * }} Keeper
 */

/**
 * Plays the seat until its match ends: 0 when it finished, 1 when stopped first.
 * @param {Keeper} keeper
 */
export async function playSeat({ name, prompt, decide, env = process.env, fetchImpl = fetch, signal, minIntervalMs = MIN_INTERVAL_MS, pollMs = 2000,
  maxFailures = Infinity, backoffMs = failures => Math.min(30_000, 2000 * failures), warn = text => console.error(text) }) {
  /** @type {string | undefined} */
  let session;
  /** @type {NodeJS.Timeout | undefined} */
  let watcher;
  let stopped = false, finished = false, lastDeliveredTick = 0, failures = 0;
  const abort = new AbortController();
  const stop = () => { stopped = true; abort.abort(); };
  const game = seat({ env, fetchImpl, signal: abort.signal });
  const delay = ms => sleep(ms, undefined, { signal: abort.signal });
  // A decision in flight when the match ends would otherwise keep the process alive.
  // The supervisor's status never consumes this seat's observations.
  const watch = async () => {
    if (stopped) return;
    try { if (seatOver(await game.status())) { finished = true; stop(); return; } } catch { /* the next poll retries */ }
    if (!stopped) watcher = setTimeout(watch, pollMs);
  };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  watcher = setTimeout(watch, pollMs);
  try {
    while (!stopped) {
      const started = Date.now();
      try {
        const observation = await game.observation(lastDeliveredTick);
        const seen = observedSeat(observation);
        if (seatOver(seen)) { finished = true; break; }
        const turn = turnFor(observation, { delivered: Boolean(session), prompt, resumed: Boolean(env.CASTELLAN_RESUME) });
        if (!turn) { await delay(1000); continue; }
        await reportActivity("deciding", { env, fetchImpl });
        ({ session } = await decide(turn, { session, signal: abort.signal }));
        if (stopped) break;
        if (Number.isFinite(seen.tick)) lastDeliveredTick = seen.tick;
        failures = 0;
        await reportActivity("between_decisions", { env, fetchImpl });
        await delay(Math.max(0, minIntervalMs - (Date.now() - started)));
      } catch (error) {
        if (stopped) break;
        const failure = /** @type {Error & { session?: string, fatal?: boolean, retryAfterMs?: number }} */ (error);
        session = failure.session ?? session;
        if (failure.retryAfterMs) {
          await reportActivity("provider_wait", { env, fetchImpl, retryAt: new Date(Date.now() + failure.retryAfterMs).toISOString() });
          warn(`castellan ${name}: ${failure.message}; waiting ${failure.retryAfterMs / 1000}s (Retry-After); the match keeps running`);
          await delay(failure.retryAfterMs).catch(() => {});
          continue;
        }
        if (failure.fatal || ++failures >= maxFailures) throw failure;
        const ms = backoffMs(failures);
        warn(`castellan ${name}: ${failure.message}; retry in ${ms / 1000}s, preserving session and observation cursor`);
        await reportActivity("connector_retry", { env, fetchImpl, retryAt: new Date(Date.now() + ms).toISOString() });
        await delay(ms).catch(() => {});
      }
    }
    return finished ? 0 : 1;
  } finally {
    stop(); clearTimeout(watcher);
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
    signal?.removeEventListener("abort", stop);
    await reportActivity("stopped", { env, fetchImpl });
  }
}

/**
 * Splits a stream of chunks into complete lines; `end` delivers a final unterminated one.
 * @param {(line: string) => void} onLine
 */
export function lineReader(onLine) {
  let pending = "";
  return {
    /** @param {string | Buffer} chunk */
    push(chunk) { const lines = (pending + chunk).split("\n"); pending = lines.pop() ?? ""; lines.forEach(onLine); },
    end() { if (pending) onLine(pending); pending = ""; },
  };
}

/**
 * A harness process's exit code. Its stdout is echoed and split into `onLine`; aborting `signal` terminates it.
 * @param {import("node:child_process").ChildProcess} child @param {AbortSignal} signal @param {(line: string) => void} onLine
 * @returns {Promise<number | null>}
 */
export async function exitOf(child, signal, onLine) {
  const lines = lineReader(onLine);
  child.stdout?.on("data", chunk => { process.stdout.write(chunk); lines.push(chunk); });
  const terminate = () => child.kill("SIGTERM");
  signal.addEventListener("abort", terminate, { once: true });
  if (signal.aborted) terminate();
  try {
    return await new Promise((resolveCode, reject) => { child.on("error", reject); child.on("close", resolveCode); });
  } finally {
    signal.removeEventListener("abort", terminate);
    lines.end();
  }
}
