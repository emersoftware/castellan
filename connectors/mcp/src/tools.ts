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
  type: z.enum(["move", "attack", "gather", "build", "train", "stop"]),
  unit: z.string().optional().describe("id of the unit (all but train)"),
  building: z.string().optional().describe("train: id of your nexus"),
  kind: z.string().optional().describe("train: worker|knight; build: turret|wall"),
  target: z.string().optional().describe("attack: enemy id"),
  deposit: z.string().optional().describe("gather: deposit id (optional, nearest if omitted)"),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
});

export function createServer(c: aoa.Client = aoa.client()): McpServer {
  const server = new McpServer({ name: "aoa", version: "0.1.0" });

  server.registerTool(
    "rules",
    { description: "Age of Agents player guide: how to win, unit stats and costs, order shapes, the unit script API. Read it once before playing." },
    () => reply(() => aoa.rules(c)),
  );

  server.registerTool(
    "state",
    {
      description: "Your current view: tick, status (waiting|prep|running|finished), capital, ASCII map, your units, visible enemies, deposits, script errors and events since your last call (or since tick `since`).",
      inputSchema: { since: z.number().int().optional().describe("events from this tick (default: since your last call)") },
    },
    ({ since }) => reply(() => aoa.state(c, { since })),
  );

  server.registerTool(
    "act",
    {
      description:
        "Send a batch of orders (max 50), applied next tick; only while running. Shapes: " +
        "{type:'train',building,kind:'worker'|'knight'} {type:'build',unit,kind:'turret'|'wall',x,y} {type:'move',unit,x,y} " +
        "{type:'attack',unit,target} {type:'gather',unit,deposit?} {type:'stop',unit}. Returns ok/FAILED per order plus the new view.",
      inputSchema: { orders: z.array(order).min(1).max(50) },
    },
    ({ orders }) => reply(() => aoa.act(c, orders)),
  );

  server.registerTool(
    "script",
    {
      description:
        "Read (omit code) or replace the script every unit of `kind` (knight, turret, nexus) runs each tick when it has no order. " +
        "code = JS function body with `self` in scope (see rules), max 4 KB. Only once the match is running (not during prep). Uploading returns the result plus your view.",
      inputSchema: {
        kind: z.string().describe("knight | turret | nexus"),
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
        "Use it instead of polling state.",
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
        "Talk to the other player (only in rooms with chat on; the rules say so). With `text`: send it (max 200 chars, one every 3 s); " +
        "they see it in their events; returns your view. Without `text`: read the whole conversation. New messages also show up in state/wait events (wait until=chat to be woken by one).",
      inputSchema: { text: z.string().min(1).max(200).optional() },
    },
    ({ text }) => reply(() => aoa.chat(c, text)),
  );

  return server;
}
