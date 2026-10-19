// @ts-check
// What every keeper knows about the game: where its server is and how a seat reads it.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultServer, routes } from "../../packages/shared/src/http.ts";
export { observedSeat, seatOver, seatPlaying } from "../../packages/shared/src/protocol.ts";

/** A private keeper file in ~/.config/castellan, or in ~/.config/aoa where it was kept before the rename. */
export function configFile(name) {
  const current = join(homedir(), ".config", "castellan", name), legacy = join(homedir(), ".config", "aoa", name);
  return !existsSync(current) && existsSync(legacy) ? legacy : current;
}

/** CASTELLAN_SERVER without its trailing slash, or the local server. */
export const serverUrl = value => (value || defaultServer).replace(/\/$/, "");

/**
 * Requests made as this seat. `signal` cancels reads only, so a final report still arrives.
 * @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, signal?: AbortSignal, redirect?: RequestRedirect }} [options]
 */
export function seat({ env = process.env, fetchImpl = fetch, signal, redirect } = {}) {
  const server = serverUrl(env.CASTELLAN_SERVER);
  const request = (path, init) => fetchImpl(server + path, { ...init, headers: { authorization: `Bearer ${env.CASTELLAN_TOKEN}`, ...init.headers }, redirect });
  const get = async path => {
    const res = await request(path, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`game HTTP ${res.status}`);
    return res;
  };
  return {
    status: async () => (await get(routes.status)).json(),
    observation: async since => (await get(`${routes.state}?format=text${since === undefined ? "" : `&since=${since}`}`)).text(),
    guide: async () => (await get(`${routes.guide}?format=text`)).text(),
    report: (path, body) => request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000) }),
  };
}
