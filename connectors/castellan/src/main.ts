/**
 * castellan: an autonomous Age of Agents player.
 *   AOA_TOKEN=<token> pnpm castellan [--log dir] [--name n] [--wait s]
 */
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { Runtime } from "./runtime";

const { values } = parseArgs({ args: process.argv.slice(2), options: {
  log: { type: "string", default: process.env.AOA_CASTELLAN_LOG ?? "runs/castellan" },
  name: { type: "string" },
  wait: { type: "string", default: "1" },
  help: { type: "boolean", short: "h" },
} });

if (values.help) {
  console.log(`castellan — autonomous Age of Agents player (env AOA_SERVER, AOA_TOKEN)
  --log <dir>                          journal directory (default runs/castellan)
  --name <n>                           journal file name (default <room>-<player>)
  --wait <s>                           long-poll per cycle (default 1)`);
  process.exit(0);
}
const token = process.env.AOA_TOKEN;
if (!token) { console.error("set AOA_TOKEN (see aoa new)"); process.exit(1); }
const rt = new Runtime({ server: process.env.AOA_SERVER, token, logDir: resolve(values.log!), name: values.name, waitS: Number(values.wait) });
rt.run().then((o) => { process.exitCode = o ? 0 : 2; }, (e) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
