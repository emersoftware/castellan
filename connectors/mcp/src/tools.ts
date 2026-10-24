/**
 * The MCP tools. Stateless: each tool is one HTTP call in text form, so the
 * server can restart (or the agent reconnect) at any moment without losing anything.
 */
import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";
import * as castellan from "@castellan/cli";
import { API_LIMITS, CHAT_CHANNELS, HISTORY_SECTIONS, RUN_LIMITS, rules, scriptOrigin, type GameTool, type GenericConnector } from "@castellan/shared";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

const reply = async (f: () => Promise<string>): Promise<Result> => {
  try {
    return { content: [{ type: "text", text: await f() }] };
  } catch (e) {
    return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
  }
};

const order = z.object({
  type: z.enum(["move", "attack", "gather", "build", "train", "upgrade", "stop", "heal", "hack", "convert"]),
  unit: z.string().optional().describe("id of the unit (except train and upgrade)"),
  building: z.string().optional().describe("train: id of any completed castle you own"),
  kind: z.string().optional().describe("train: worker|knight|archer|wizard; build: tower|wall|door|castle (see guide for availability and construction time)"),
  upgrade: z.string().optional().describe("upgrade: research id from guide, e.g. knight_damage; buys its next level"),
  target: z.string().optional().describe("attack: enemy id; heal/hack/convert (wizard): target id (see guide)"),
  code: z.string().optional().describe("hack: the script body the target runs (see guide)"),
  deposit: z.string().optional().describe("gather: deposit id (optional, nearest if omitted)"),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
});

/** Calls through this server declare the generic MCP connector unless CASTELLAN_CONNECTOR names the harness. */
const connector: GenericConnector = "mcp";

export function createServer(c: castellan.Client = castellan.client({ connector })): McpServer {
  const server = new McpServer({ name: "castellan", version: "0.1.0" });
  const tool = <A extends undefined | ZodRawShapeCompat = undefined>(config: { description: string; inputSchema?: A }, run: ToolCallback<A>) =>
    (name: string) => server.registerTool(name, config, run);

  // Every game tool, registered in this order (the order clients list them).
  const tools: Record<GameTool, (name: string) => void> = {
    history: tool({
      description: "Completed earlier games of your series. Without game: the list. Sections: summary (result), events and chat (what you could see), scripts (your final ones), orders (yours, with results). Never opponents' scripts or others' private chat. Detail sections page with offset; next is null at the end.",
      inputSchema: {
        game: z.number().int().min(1).max(3).optional(),
        section: z.enum(HISTORY_SECTIONS).optional(),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    }, (args) => reply(() => castellan.history(c, args))),

    guide: tool(
      { description: "How this room's game works: victory conditions, unit stats and costs, research, order shapes and the script APIs." },
      () => reply(() => castellan.guide(c)),
    ),

    state: tool(
      {
        description: "Your view under fog of war: tick, status (waiting|prep|running|finished), time left, mineral, ASCII map, your entities, visible enemies with owner ids, deposits, script errors, the last 5 visible chat messages, damage your entities took (under attack) and events since your last call (or since tick `since`).",
        inputSchema: { since: z.number().int().optional().describe("events from this tick (default: since your last call)") },
      },
      ({ since }) => reply(() => castellan.state(c, { since })),
    ),

    act: tool(
      {
        description:
          `Send a batch of orders (max ${API_LIMITS.orders}), applied next tick;` + " only while running. Shapes: " +
          "{type:'train',building,kind:'worker'|'knight'|'archer'|'wizard'} {type:'build',unit,kind:'tower'|'wall'|'door'|'castle',x,y} {type:'move',unit,x,y} " +
          "{type:'attack',unit,target} {type:'gather',unit,deposit?} {type:'stop',unit} {type:'upgrade',upgrade:'<id from guide>'} " +
          "{type:'heal'|'convert',unit,target} {type:'hack',unit,target,code} (wizard abilities, see guide). " +
          "Returns ok/FAILED per order, mineral spent and remaining, and your view. A queued unit gets its id when it spawns; durations and limits are in guide.",
        inputSchema: { orders: z.array(order).min(1).max(API_LIMITS.orders) },
      },
      ({ orders }) => reply(() => castellan.act(c, orders)),
    ),

    script: tool(
      {
        description:
          "Read (omit code) or replace the script every unit of `kind` (worker, king, knight, archer, wizard, tower, castle; see guide) runs each tick. " +
          `code = JS function body with \`self\` in scope, max ${rules.script.maxBytes / 1024} KB; callbacks and explicit order suspension are available (see guide for this match's precedence). Only while running. Uploading returns the result and your view.`,
        inputSchema: {
          kind: z.string().describe("worker | king | knight | archer | wizard | tower | castle (availability depends on the room; see guide)"),
          code: z.string().optional(),
          lang: z.enum(["js", "ts"]).optional().describe("default js; ts types are stripped"),
        },
      },
      ({ kind, code, lang }) =>
        reply(async () => {
          if (code !== undefined) return castellan.putScript(c, kind, code, { lang });
          const s = await castellan.script(c, kind);
          return `// ${kind}: ${scriptOrigin(s)}\n${s.code}`;
        }),
    ),

    run: tool(
      {
        description:
          "Run a one-shot player script on the server, once, right now. `code` is a JS function body with these in scope: " +
          "`view` = your full state as JSON (players, mine, allies, enemy, deposits, grid, visibility, events since your last call, chat, underAttack, lastSeen, projectiles, timeMs, matchMs...; " +
          "entities carry id, kind, owner, x, y, hp, maxHp, stats, order, doing, training), `game` = the room's settings as JSON (kinds with costs and stats, upgrades, map), " +
          `\`act(order)\` = queue one order (same shapes as act; move/attack/gather/build/train/upgrade/stop; max ${RUN_LIMITS.maxOrders}) and \`log(...)\`. ` +
          "All queued orders are applied together when it returns; if it throws, none are. Its return value (JSON) and logs come back with each order's result. " +
          "Deterministic CPU/memory limits (heavy loops fail with out of gas); no network or timers. It reads your view like state does.",
        inputSchema: {
          code: z.string().min(1).max(RUN_LIMITS.maxBytes).describe("function body; may `return` a JSON value"),
          lang: z.enum(["js", "ts"]).optional().describe("default js; ts types are stripped"),
        },
      },
      ({ code, lang }) => reply(() => castellan.runScript(c, code, { lang })),
    ),

    chat: tool(
      {
        description:
          `Messages, when the room has chat. With \`text\`: send it (max ${API_LIMITS.chatChars} chars, one per ${API_LIMITS.chatEveryMs / 1000} s across channels); public by default, ` +
          "private with `to` (a player id), or to your team with channel team (not with to). Private and team messages are hidden from live spectators and appear in the replay. " +
          "Returns your view. Without `text`: every message you can see. New ones also arrive in subsequent observations.",
        inputSchema: {
          text: z.string().min(1).max(200).optional(),
          channel: z.enum(CHAT_CHANNELS).optional().describe("all = public, team = allies, private = one recipient; omitted with to implies private; ignored when reading"),
          to: z.string().min(1).max(63).optional().describe("Recipient player id from state, e.g. p2. Makes the message private; omit channel or use private. Ignored when reading"),
        },
      },
      ({ text, channel, to }) => reply(() => castellan.chat(c, text, { channel, to })),
    ),
  };
  for (const [name, register] of Object.entries(tools)) register(name);
  return server;
}
