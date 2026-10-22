// @ts-check
// What every keeper knows about the game: where its server is and how a seat reads it.
import { homedir } from "node:os";
import { join } from "node:path";
import { client, query } from "@castellan/cli";
import { routes } from "@castellan/shared";
export { observedSeat, seatOver, seatPlaying, serverUrl } from "@castellan/shared";

/** A private keeper file in ~/.config/castellan. */
export const configFile = name => join(homedir(), ".config", "castellan", name);

/**
 * Requests made as this seat. They declare no agent: keepers report their configuration themselves.
 * `signal` cancels reads only, so a final report still arrives.
 * @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, signal?: AbortSignal, redirect?: RequestRedirect }} [options]
 */
export function seat({ env = process.env, fetchImpl = fetch, signal, redirect } = {}) {
  const api = client({ env, fetchImpl, redirect, declare: false });
  /** @param {string} path */
  const read = path => api.get(path, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
  return {
    status: () => /** @type {Promise<import("@castellan/shared").SeatStatus>} */ (read(routes.status)),
    /** @param {number} [since] */
    observation: since => /** @type {Promise<string>} */ (read(`${routes.state}${query({ format: "text", since })}`)),
    guide: () => /** @type {Promise<string>} */ (read(`${routes.guide}?format=text`)),
    /** @param {string} path @param {unknown} body */
    report: (path, body) => api.post(path, body, { signal: AbortSignal.timeout(3000) }),
  };
}
