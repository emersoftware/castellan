// What every keeper knows about the game: where its server is, how a seat
// reads it, and which MCP tools a player may call.

/** The aoa MCP server's game tools, in the order players are shown them. */
export const gameTools = ["rules", "state", "act", "run", "script", "chat", "history", "script_test"];

/** AOA_SERVER without its trailing slash, or the local server. */
export const serverUrl = value => (value || "http://localhost:4400").replace(/\/$/, "");

/** Requests made as this seat. `signal` cancels reads only, so a final report still arrives. */
export function seat({ env = process.env, fetchImpl = fetch, signal, redirect } = {}) {
  const server = serverUrl(env.AOA_SERVER);
  const request = (path, init) => fetchImpl(server + path, { ...init, headers: { authorization: `Bearer ${env.AOA_TOKEN}`, ...init.headers }, redirect });
  const get = async path => {
    const res = await request(path, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`game HTTP ${res.status}`);
    return res;
  };
  return {
    status: async () => (await get("/status")).json(),
    observation: async since => (await get(`/state?format=text${since === undefined ? "" : `&since=${since}`}`)).text(),
    rules: async () => (await get("/rules?format=text")).text(),
    report: (path, body) => request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000) }),
  };
}
