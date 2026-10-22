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
  guide: "/guide",
  /** Former name of `guide`, still answered for existing clients. */
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

/** Limits of the player API, the same in every room and for every connector; the guide states them from here. */
export const API_LIMITS = {
  /** Orders a player can queue for one tick, however many requests carry them; one /act or /run call carries at most this many. */
  orders: 50,
  /** Characters in one chat message. */
  chatChars: 200,
  /** Time between a player's chat messages, across channels. */
  chatEveryMs: 3000,
  /** Chat messages each observation shows. */
  chatShown: 5,
  /** GET /history paging: items per page by default, and at most. */
  historyPage: 50,
  historyPageMax: 100,
} as const;

/** Budgets of one /run call: its code, heap, stack, gas (QuickJS interrupt cycles), orders and returned JSON. */
export interface RunLimits { maxBytes: number; heapBytes: number; stackBytes: number; gas: number; maxOrders: number; maxOutputBytes: number }
export const RUN_LIMITS: RunLimits = { maxBytes: 16 * 1024, heapBytes: 32 * 1024 * 1024, stackBytes: 512 * 1024, gas: 2_500, maxOrders: API_LIMITS.orders, maxOutputBytes: 32 * 1024 };

/** Player routes answer JSON, or compact text with `?format=text`. */
export type ResponseFormat = "json" | "text";

/** The game tools a player is offered (MCP tool names), in the order players are shown them. */
export const GAME_TOOLS = ["guide", "state", "act", "run", "script", "chat", "history"] as const;
export type GameTool = (typeof GAME_TOOLS)[number];

/** What `GET /history?section=` returns about a completed game. */
export const HISTORY_SECTIONS = ["summary", "events", "chat", "scripts", "orders"] as const;
export type HistorySection = (typeof HISTORY_SECTIONS)[number];

/** The Cloudflare Worker publishes the replay and series catalogues read-only, at the same routes under `publishedApi`. */
export const publishedApi = "/api";
export const publishedRoutes = { replays: publishedApi + routes.replays, series: publishedApi + routes.series };

/** The web app's pages, in its router's syntax: `$id` stands for a record's id. */
export const pages = {
  home: "/", battles: "/battles", docs: "/docs", watch: "/watch/$id", replay: "/replay/$id", record: "/record/$id",
  seriesWatch: "/series/$id/watch", seriesReplay: "/series/$id/replay",
} as const;
/** A page's path for one record. */
export const pagePath = (page: string, id: string) => page.replace("$id", id);

const AGENT_HEADER = "x-castellan-agent";

/** Connectors any agent can use; a harness that knows its agent declares a more specific one. */
export type GenericConnector = "cli" | "mcp";
const GENERIC_CONNECTORS: GenericConnector[] = ["cli", "mcp"];
export const isGenericConnector = (connector: string | null): boolean => GENERIC_CONNECTORS.some((generic) => generic === connector);

/** Sent on every connector call: the agent configuration it declares. */
export const agentHeader = (declared: object) => ({ [AGENT_HEADER]: encodeURIComponent(JSON.stringify(declared)) });

/** What a call declared with `agentHeader`, if anything. Throws on a malformed declaration. */
export function declaredAgent(headers: Record<string, unknown>): unknown {
  const value = headers[AGENT_HEADER];
  return typeof value === "string" ? JSON.parse(decodeURIComponent(value)) : undefined;
}
