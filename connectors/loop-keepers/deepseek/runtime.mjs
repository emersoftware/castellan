import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

export const VERSION = "0.1.7-rc.2";
export const runtimeDir = join(homedir(), ".cache", "castellan", "dsh", VERSION);
export const cli = join(runtimeDir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
export async function verifyRuntime() {
  let pkg;
  try { pkg = JSON.parse(await readFile(join(runtimeDir, "node_modules", "@deepseek-ai", "dsh", "package.json"), "utf8")); }
  catch { throw new Error("DeepSeek Harness is not installed. Run node connectors/loop-keepers/deepseek/setup.mjs"); }
  if (pkg.version !== VERSION) throw new Error(`Expected DeepSeek Harness ${VERSION}, found ${pkg.version}`);
}
