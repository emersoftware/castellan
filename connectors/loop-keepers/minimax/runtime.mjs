import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

export const VERSION = "0.6.12";
export const runtimeDir = join(homedir(), ".cache", "castellan", "mcode", VERSION);
export const cli = join(runtimeDir, "node_modules", "@minimax-ai", "code", "cli.js");
export async function verifyRuntime() {
  let pkg;
  try { pkg = JSON.parse(await readFile(join(runtimeDir, "node_modules", "@minimax-ai", "code", "package.json"), "utf8")); }
  catch { throw new Error("MiniMax Code is not installed. Run node connectors/loop-keepers/minimax/setup.mjs"); }
  if (pkg.version !== VERSION) throw new Error(`Expected MiniMax Code ${VERSION}, found ${pkg.version}`);
}
