/** `aoa`: argv → one command function → stdout. */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { client } from "./client";
import * as cmd from "./commands";

const USAGE = `aoa — Age of Agents client (env AOA_SERVER, AOA_TOKEN)

  aoa rules                          player guide
  aoa history [--game N] [--section summary|events|chat|scripts|orders] [--offset N] [--limit N]
  aoa state [--since T]              your view (+ events since tick T)
  aoa act '<order|[orders]>'         or: aoa act -f orders.json (- = stdin)
  aoa script <kind>                  print the current script
  aoa script <kind> <file|-> [--ts]  upload a script (.ts files imply --ts)
  aoa script <kind> --reset          restore the built-in script
  aoa wait [seconds] [--since T] [--until a,b]
  aoa chat ["<message>"] [--channel all|team|private] [--to p2]  public by default; --to = private to one player; no message = read
  aoa status                         waiting | prep | running | finished
  aoa watch [--since T]              one line per event until the match ends
  aoa new [--name a --name b | --bot eco ...] [--map open|ridge|canyons|quad] [--sides random|fixed] [--chat] [--prep ms] [--seed n]
          [--mode teams|ffa] (quad defaults to 2v2; --mode ffa is 1v1v1v1)
  aoa rooms
  aoa new --series                   create a three-game series (same options as new)
  aoa run-series -- <command...>     play all three games with a series participant token
  aoa run -- <command...>            relaunch the agent until the match ends

  --json  raw JSON instead of text`;

// A closed pipe (`aoa watch | head`) is a normal way to stop.
process.stdout.on("error", () => process.exit(0));

const argv = process.argv.slice(2);
const dash = argv.indexOf("--");
const parse = () =>
  parseArgs({
    args: dash < 0 ? argv : argv.slice(0, dash),
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      series: { type: "boolean" },
      game: { type: "string" },
      section: { type: "string" },
      offset: { type: "string" },
      limit: { type: "string" },
      since: { type: "string" },
      until: { type: "string" },
      file: { type: "string", short: "f" },
      ts: { type: "boolean" },
      reset: { type: "boolean" },
      name: { type: "string", multiple: true },
      bot: { type: "string", multiple: true },
      prep: { type: "string" },
      map: { type: "string" },
      sides: { type: "string" },
      chat: { type: "boolean" },
      channel: { type: "string" },
      to: { type: "string" },
      mode: { type: "string" },
      seed: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));
const read = (file: string) => readFileSync(file === "-" ? 0 : file, "utf8");
const c = client();

async function main(): Promise<string | number | void> {
  const { values: o, positionals: [name, ...args] } = parse();
  const json = o.json;
  switch (name) {
    case "rules":
      return cmd.rules(c, { json });
    case "history":
      return cmd.history(c, { json, game: num(o.game), section: o.section, offset: num(o.offset), limit: num(o.limit) });
    case "state":
      return cmd.state(c, { json, since: num(o.since) });
    case "act": {
      const text = o.file ? read(o.file) : args[0];
      if (!text) throw new Error("usage: aoa act '<json>' | aoa act -f file.json");
      return cmd.act(c, JSON.parse(text), { json });
    }
    case "script": {
      const [kind, file] = args;
      if (!kind) throw new Error("usage: aoa script <kind> [file|-] [--ts]");
      if (o.reset) return cmd.putScript(c, kind, null, { json });
      if (!file) return cmd.getScript(c, kind, { json });
      return cmd.putScript(c, kind, read(file), { json, lang: o.ts || file.endsWith(".ts") ? "ts" : "js" });
    }
    case "wait":
      return cmd.wait(c, { json, seconds: num(args[0]), since: num(o.since), until: o.until });
    case "chat":
      if (o.channel !== undefined && o.channel !== "all" && o.channel !== "team" && o.channel !== "private") throw new Error('channel must be "all", "team" or "private"');
      return cmd.chat(c, args.length ? args.join(" ") : undefined, { json, channel: o.channel, to: o.to });
    case "status":
      return cmd.status(c);
    case "watch":
      await cmd.watch(c, (line) => console.log(line), { json, since: num(o.since) });
      return;
    case "new":
      if (o.mode !== undefined && o.mode !== "teams" && o.mode !== "ffa") throw new Error('mode must be "teams" or "ffa"');
      return cmd.newRoom(c, { json, series: o.series, names: o.name, bots: o.bot, prepMs: num(o.prep), seed: num(o.seed), map: o.map, sides: o.sides === "fixed" ? "fixed" : undefined, chat: o.chat, mode: o.mode });
    case "rooms":
      return cmd.rooms(c, { json });
    case "run":
    case "run-series": {
      const command = dash < 0 ? [] : argv.slice(dash + 1);
      if (!command.length) throw new Error("usage: aoa run -- <command...>");
      return name === "run-series" ? cmd.runSeries(c, command) : cmd.run(c, command);
    }
    default:
      console.log(USAGE);
      return name && !o.help ? 1 : 0;
  }
}

main().then(
  (out) => {
    if (typeof out === "number") process.exitCode = out;
    else if (out !== undefined) console.log(out);
  },
  (e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  },
);
