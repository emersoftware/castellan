import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { configFile } from "../game.mjs";
import { Writable } from "node:stream";

function keyFile(env = process.env) {
  return env.CASTELLAN_DEEPSEEK_KEY_FILE || configFile("deepseek-api-key");
}
export async function loadKey(env = process.env) {
  if (env.DEEPSEEK_API_KEY?.trim()) return env.DEEPSEEK_API_KEY.trim();
  const path = keyFile(env);
  try {
    const info = await stat(path);
    if ((info.mode & 0o077) !== 0) throw new Error(`DeepSeek key file must be private: chmod 600 ${path}`);
    return (await readFile(path, "utf8")).trim();
  } catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}
export async function saveKey(key, path = keyFile()) {
  const value = key.trim();
  if (!value || /\s/.test(value)) throw new Error("The key is empty or contains whitespace; it was not saved.");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const pending = `${path}.${randomUUID()}.tmp`;
  await writeFile(pending, value + "\n", { mode: 0o600, flag: "wx" });
  await rename(pending, path);
}
async function main() {
  if (process.argv[2] === "--check") {
    if (!await loadKey()) throw new Error("Configure DEEPSEEK_API_KEY or run node connectors/loop-keepers/deepseek/key.mjs");
    console.log("DeepSeek key configured locally."); return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Run this command in your terminal to enter the key without displaying it.");
  // Readline owns editing/raw-mode cleanup; its output (including typed text) is muted.
  const muted = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const input = createInterface({ input: process.stdin, output: muted, terminal: true });
  process.stdout.write("DeepSeek API key (hidden input): ");
  let key;
  try { key = await input.question(""); } finally { input.close(); process.stdout.write("\n"); }
  await saveKey(key);
  console.log(`Saved with permissions 600 to ${keyFile()}. No API calls were made.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
