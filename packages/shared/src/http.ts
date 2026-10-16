/** How clients reach the game server: where it listens by default, its routes and how connectors declare themselves. */

export const defaultServer = "http://localhost:4400";

/** Top-level paths the server answers; clients and the web dev proxy build their URLs from these. */
export const routes = {
  health: "/health",
  agentConfig: "/agent-config",
  agentStatus: "/agent-status",
  rooms: "/rooms",
  series: "/series",
  currentSeries: "/series/current",
  maps: "/maps",
  replays: "/replays",
  spectate: "/spectate",
  rules: "/rules",
  status: "/status",
  state: "/state",
  history: "/history",
  act: "/act",
  run: "/run",
  chat: "/chat",
  scripts: "/scripts",
  wait: "/wait",
};

/** The Cloudflare Worker publishes the replay and series catalogues read-only, at the same routes under `publishedApi`. */
export const publishedApi = "/api";
export const publishedRoutes = { replays: publishedApi + routes.replays, series: publishedApi + routes.series };

const AGENT_HEADER = "x-aoa-agent";

/** Sent on every connector call: the agent configuration it declares. */
export const agentHeader = (declared: object) => ({ [AGENT_HEADER]: encodeURIComponent(JSON.stringify(declared)) });

/** What a call declared with `agentHeader`, if anything. Throws on a malformed declaration. */
export function declaredAgent(headers: Record<string, unknown>): unknown {
  const value = headers[AGENT_HEADER];
  return typeof value === "string" ? JSON.parse(decodeURIComponent(value)) : undefined;
}
