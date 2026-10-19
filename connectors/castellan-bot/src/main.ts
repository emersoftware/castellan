/**
 * castellan-bot: an autonomous Castellan player.
 *   CASTELLAN_TOKEN=<token> pnpm castellan-bot [--log dir] [--name n] [--wait s]
 */
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { Runtime } from "./runtime";

const { values } = parseArgs({ args: process.argv.slice(2), options: {
  log: { type: "string", default: process.env.CASTELLAN_BOT_LOG ?? "runs/castellan-bot" },
  name: { type: "string" },
  wait: { type: "string", default: "1" },
  help: { type: "boolean", short: "h" },
} });

if (values.help) {
  console.log(`castellan-bot — autonomous Castellan player (env CASTELLAN_SERVER, CASTELLAN_TOKEN)
  --log <dir>                          journal directory (default runs/castellan-bot)
  --name <n>                           journal file name (default <room>-<player>)
  --wait <s>                           long-poll per cycle (default 1)`);
  process.exit(0);
}
const token = process.env.CASTELLAN_TOKEN;
if (!token) { console.error("set CASTELLAN_TOKEN (see castellan new)"); process.exit(1); }
const rt = new Runtime({ server: process.env.CASTELLAN_SERVER, token, logDir: resolve(values.log!), name: values.name, waitS: Number(values.wait) });
rt.run().then((o) => { process.exitCode = o ? 0 : 2; }, (e) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
