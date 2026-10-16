// @ts-check
// What every keeper knows about the game: where its server is and how a seat reads it.
import { defaultServer, routes } from "../../packages/shared/src/http.ts";
export { observedSeat, seatOver, seatPlaying } from "../../packages/shared/src/protocol.ts";

/** AOA_SERVER without its trailing slash, or the local server. */
export const serverUrl = value => (value || defaultServer).replace(/\/$/, "");

/**
 * Requests made as this seat. `signal` cancels reads only, so a final report still arrives.
 * @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, signal?: AbortSignal, redirect?: RequestRedirect }} [options]
 */
export function seat({ env = process.env, fetchImpl = fetch, signal, redirect } = {}) {
  const server = serverUrl(env.AOA_SERVER);
  const request = (path, init) => fetchImpl(server + path, { ...init, headers: { authorization: `Bearer ${env.AOA_TOKEN}`, ...init.headers }, redirect });
  const get = async path => {
    const res = await request(path, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`game HTTP ${res.status}`);
    return res;
  };
  return {
    status: async () => (await get(routes.status)).json(),
    observation: async since => (await get(`${routes.state}?format=text${since === undefined ? "" : `&since=${since}`}`)).text(),
    rules: async () => (await get(`${routes.rules}?format=text`)).text(),
    report: (path, body) => request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000) }),
  };
}
