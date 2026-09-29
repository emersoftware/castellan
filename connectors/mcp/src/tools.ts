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
    description: "Completed previous games in your current series. No game argument lists available games. Sections: summary (result), events (visible events), chat (visible conversation), scripts (your final scripts), orders (your orders and results). Game 1 has no previous history. Only earlier games in your series are accessible; no opponents' scripts or other players' private chat. Detail sections return items and next offset, null at the end.",
    inputSchema: {
      game: z.number().int().min(1).max(3).optional(),
      section: z.enum(["summary", "events", "chat", "scripts", "orders"]).optional(),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  }, (args) => reply(() => aoa.history(c, args)));

  server.registerTool(
    "rules",
    { description: "Age of Agents player guide: how to win, unit stats and costs, order shapes, the unit script API. Read it once before playing." },
    () => reply(() => aoa.rules(c)),
  );

  server.registerTool(
    "state",
    {
      description: "Your current view, filtered by the room's fog-of-war rules: tick, status (waiting|prep|running|finished), time left and what happens at the time limit, capital, ASCII map, your units, visible enemies with owner ids, deposits, script errors, the last 5 chat messages visible to you, damage your units and buildings took (UNDER ATTACK), and events since your last call (or since tick `since`). Chat preview is independent of since. Use chat without text for the full visible history.",
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
        "Returns ok/FAILED per order, capital spent and remaining for purchases, plus the new view. Training may be queued: rules defines durations/limits, and a queued train returns no unit id until spawn. Research affects your existing and future units of one kind after its timer completes.",
      inputSchema: { orders: z.array(order).min(1).max(50) },
    },
    ({ orders }) => reply(() => aoa.act(c, orders)),
  );

  server.registerTool(
    "script",
    {
      description:
        "Read (omit code) or replace the script every unit of `kind` (worker, king, knight, ranger, turret, castle; see rules) runs each tick when it has no order. " +
        "code = JS function body with `self` in scope (see rules), max 4 KB. Only once the match is running (not during prep). Uploading returns the result plus your view.",
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
    "wait",
    {
      description:
        "Block until you have new events since tick `since` (only of the types in `until`, if given) or max_s seconds pass, then return your view. " +
        "Optional when you want to wait for news; the game and unit scripts keep running. Choose the timeout and event filter to fit your next decision. You do not need to call wait before acting.",
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
        "Talk to players (only in rooms with chat on). With `text`: send it (max 200 chars, one every 3 s across channels); " +
        "Omit channel and to for public chat. Set to to another player id (e.g. p2) for a private message visible only to sender and recipient during play; channel private is optional with to. " +
        "channel team is private to teammates and requires an ally; do not combine it with to. Private/team messages are hidden from live spectators and appear in the replay after the match. " +
        "Returns your view. Without `text`: read all messages visible to you. New messages also show up in state/wait events (wait until=chat to be woken by one).",
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
