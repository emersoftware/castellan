import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { runtimeDir, VERSION, verifyRuntime } from "./runtime.mjs";

await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
const child = spawn("npm", ["install", "--prefix", runtimeDir, "--save-exact", "--omit=dev", "--no-audit", "--no-fund", `@deepseek-ai/dsh@${VERSION}`], { stdio: "inherit" });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", async (code) => {
  if (code !== 0) { process.exitCode = code ?? 1; return; }
  await verifyRuntime();
  console.log(`DeepSeek Harness ${VERSION} installed in ${runtimeDir}`);
});
