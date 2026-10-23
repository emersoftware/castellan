// @ts-check
// A harness CLI installed from npm at a pinned version into ~/.cache/castellan/<dir>/<version>.
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * @param {{ name: string, pkg: string, version: string, dir: string, bin: string, setup: string }} harness
 *   `bin` is the CLI's path inside the package; `setup` is the install script, shown in errors.
 */
export function npmRuntime({ name, pkg, version, dir, bin, setup }) {
  const runtimeDir = join(homedir(), ".cache", "castellan", dir, version);
  const packageDir = join(runtimeDir, "node_modules", ...pkg.split("/"));
  async function verifyRuntime() {
    let installed;
    try { installed = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8")); }
    catch { throw new Error(`${name} is not installed. Run node ${setup}`); }
    if (installed.version !== version) throw new Error(`Expected ${name} ${version}, found ${installed.version}`);
  }
  /** Installs the pinned package and checks it; a failure sets the process exit code. */
  async function install() {
    await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
    const child = spawn("npm", ["install", "--prefix", runtimeDir, "--save-exact", "--omit=dev", "--no-audit", "--no-fund", `${pkg}@${version}`], { stdio: "inherit" });
    child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
    child.on("exit", async (code) => {
      if (code !== 0) { process.exitCode = code ?? 1; return; }
      await verifyRuntime();
      console.log(`${name} ${version} installed in ${runtimeDir}`);
    });
  }
  return { VERSION: version, runtimeDir, cli: join(packageDir, bin), verifyRuntime, install };
}
