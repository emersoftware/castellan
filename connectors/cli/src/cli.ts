/** `aoa`: argv → one command function → stdout. */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { client } from "./client";
import * as cmd from "./commands";

const USAGE = `aoa — Age of Agents client (env AOA_SERVER, AOA_TOKEN)

  aoa rules                          player guide
  aoa state [--since T]              your view (+ events since tick T)
  aoa act '<order|[orders]>'         or: aoa act -f orders.json (- = stdin)
  aoa script <kind>                  print the current script
  aoa script <kind> <file|-> [--ts]  upload a script (.ts files imply --ts)
  aoa script <kind> --reset          restore the built-in script
  aoa wait [seconds] [--since T] [--until a,b]
  aoa chat ["<message>"]             talk to the other player; no message = read the conversation
  aoa status                         waiting | prep | running | finished
  aoa watch [--since T]              one line per event until the match ends
  aoa new [--name a --name b | --bot eco ...] [--map open|ridge|canyons] [--sides random|fixed] [--chat] [--prep ms] [--seed n]
  aoa rooms
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
      return cmd.chat(c, args.join(" ") || undefined, { json });
    case "status":
      return cmd.status(c);
    case "watch":
      await cmd.watch(c, (line) => console.log(line), { json, since: num(o.since) });
      return;
    case "new":
      return cmd.newRoom(c, { json, names: o.name, bots: o.bot, prepMs: num(o.prep), seed: num(o.seed), map: o.map, sides: o.sides === "fixed" ? "fixed" : undefined, chat: o.chat });
    case "rooms":
      return cmd.rooms(c, { json });
    case "run": {
      const command = dash < 0 ? [] : argv.slice(dash + 1);
      if (!command.length) throw new Error("usage: aoa run -- <command...>");
      return cmd.run(c, command);
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
