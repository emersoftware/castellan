/**
 * The MCP tools. Stateless: each tool is one HTTP call in text form, so the
 * server can restart (or the agent reconnect) at any moment without losing anything.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as aoa from "@aoa/cli";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

const reply = async (f: () => Promise<string>): Promise<Result> => {
  try {
    return { content: [{ type: "text", text: await f() }] };
  } catch (e) {
    return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
  }
};

const order = z.object({
  type: z.enum(["move", "attack", "gather", "build", "train", "upgrade", "stop"]),
  unit: z.string().optional().describe("id of the unit (except train and upgrade)"),
  building: z.string().optional().describe("train: id of any completed castle you own"),
  kind: z.string().optional().describe("train: worker|knight|ranger; build: turret|wall|door|castle (see rules for availability and construction time)"),
  upgrade: z.string().optional().describe("upgrade: research id from rules, e.g. knight_damage; buys its next level"),
  target: z.string().optional().describe("attack: enemy id"),
  deposit: z.string().optional().describe("gather: deposit id (optional, nearest if omitted)"),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
});

export function createServer(c: aoa.Client = aoa.client()): McpServer {
  const server = new McpServer({ name: "aoa", version: "0.1.0" });

  server.registerTool("history", {
    description: "Completed earlier games of your series. Without game: the list. Sections: summary (result), events and chat (what you could see), scripts (your final ones), orders (yours, with results). Never opponents' scripts or others' private chat. Detail sections page with offset; next is null at the end.",
    inputSchema: {
      game: z.number().int().min(1).max(3).optional(),
      section: z.enum(["summary", "events", "chat", "scripts", "orders"]).optional(),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  }, (args) => reply(() => aoa.history(c, args)));

  server.registerTool(
    "rules",
    { description: "The rules of this room: victory, unit stats and costs, research, order shapes and the script APIs." },
    () => reply(() => aoa.rules(c)),
  );

  server.registerTool(
    "state",
    {
      description: "Your view under fog of war: tick, status (waiting|prep|running|finished), time left, capital, ASCII map, your entities, visible enemies with owner ids, deposits, script errors, the last 5 visible chat messages, damage your entities took (under attack) and events since your last call (or since tick `since`).",
      inputSchema: { since: z.number().int().optional().describe("events from this tick (default: since your last call)") },
    },
    ({ since }) => reply(() => aoa.state(c, { since })),
  );

  server.registerTool(
    "act",
    {
      description:
        "Send a batch of orders (max 50), applied next tick; only while running. Shapes: " +
        "{type:'train',building,kind:'worker'|'knight'|'ranger'} {type:'build',unit,kind:'turret'|'wall'|'door'|'castle',x,y} {type:'move',unit,x,y} " +
        "{type:'attack',unit,target} {type:'gather',unit,deposit?} {type:'stop',unit} {type:'upgrade',upgrade:'<id from rules>'}. " +
        "Returns ok/FAILED per order, capital spent and remaining, and your view. A queued unit gets its id when it spawns; durations and limits are in rules.",
      inputSchema: { orders: z.array(order).min(1).max(50) },
    },
    ({ orders }) => reply(() => aoa.act(c, orders)),
  );

  server.registerTool(
    "script",
    {
      description:
        "Read (omit code) or replace the script every unit of `kind` (worker, king, knight, ranger, turret, castle; see rules) runs each tick when it has no order. " +
        "code = JS function body with `self` in scope (see rules), max 4 KB; only while running. Uploading returns the result and your view.",
      inputSchema: {
        kind: z.string().describe("worker | king | knight | ranger | turret | castle (availability depends on rules)"),
        code: z.string().optional(),
        lang: z.enum(["js", "ts"]).optional().describe("default js; ts types are stripped"),
      },
    },
    ({ kind, code, lang }) =>
      reply(async () => {
        if (code !== undefined) return aoa.putScript(c, kind, code, { lang });
        const s = await c.get<{ code: string; custom: boolean }>(`/scripts/${encodeURIComponent(kind)}`);
        return `// ${kind}: ${s.custom ? "custom" : "default"}\n${s.code}`;
      }),
  );

  server.registerTool(
    "run",
    {
      description:
        "Run a one-shot player script on the server, once, right now. `code` is a JS function body with these in scope: " +
        "`view` = your full state as JSON (players, mine, allies, enemy, deposits, grid, visibility, events since your last call, chat, underAttack, lastSeen, projectiles, timeMs, matchMs...; " +
        "entities carry id, kind, owner, x, y, hp, maxHp, stats, order, doing, training), `rules` = the full ruleset JSON (kinds with costs and stats, upgrades, map), " +
        "`act(order)` = queue one order (same shapes as act; move/attack/gather/build/train/upgrade/stop; max 50) and `log(...)`. " +
        "All queued orders are applied together when it returns; if it throws, none are. Its return value (JSON) and logs come back with each order's result. " +
        "Deterministic CPU/memory limits (heavy loops fail with out of gas); no network or timers. It reads your view like state does.",
      inputSchema: {
        code: z.string().min(1).max(16384).describe("function body; may `return` a JSON value"),
        lang: z.enum(["js", "ts"]).optional().describe("default js; ts types are stripped"),
      },
    },
    ({ code, lang }) => reply(() => aoa.runScript(c, code, { lang })),
  );

  server.registerTool(
    "wait",
    {
      description:
        "Block until there are new events since tick `since` (only types in `until`, if given) or max_s seconds pass, then return your view. The game and unit scripts keep running meanwhile. Never required: orders can be sent at any time.",
      inputSchema: {
        since: z.number().int().optional().describe("default: since your last call"),
        max_s: z.number().int().min(0).max(30).optional().describe("seconds, ≤30 (default 20)"),
        until: z.string().optional().describe("comma-separated event types, e.g. death,spawn,match_end"),
      },
    },
    ({ since, max_s, until }) => reply(() => aoa.wait(c, { since, seconds: max_s === undefined ? undefined : Math.min(30, max_s), until })),
  );

  server.registerTool(
    "chat",
    {
      description:
        "Messages, when the room has chat. With `text`: send it (max 200 chars, one per 3 s across channels); public by default, " +
        "private with `to` (a player id), or to your team with channel team (not with to). Private and team messages are hidden from live spectators and appear in the replay. " +
        "Returns your view. Without `text`: every message you can see. New ones also arrive as chat events (wait until=chat).",
      inputSchema: {
        text: z.string().min(1).max(200).optional(),
        channel: z.enum(["all", "team", "private"]).optional().describe("all = public, team = allies, private = one recipient; omitted with to implies private; ignored when reading"),
        to: z.string().min(1).max(63).optional().describe("Recipient player id from state, e.g. p2. Makes the message private; omit channel or use private. Ignored when reading"),
      },
    },
    ({ text, channel, to }) => reply(() => aoa.chat(c, text, { channel, to })),
  );

  return server;
}
