import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { configFile } from "../game.mjs";
import { saveKey as savePrivateKey } from "../deepseek/key.mjs";

const keyFile = (env = process.env) => env.CASTELLAN_MINIMAX_KEY_FILE || configFile("minimax-api-key");
const saveKey = (key, path = keyFile()) => savePrivateKey(key, path);
export async function loadKey(env = process.env) {
  if (env.MINIMAX_API_KEY?.trim()) return env.MINIMAX_API_KEY.trim();
  const path = keyFile(env);
  try {
    const info = await stat(path);
    if ((info.mode & 0o077) !== 0) throw new Error(`MiniMax key file must be private: chmod 600 ${path}`);
    return (await readFile(path, "utf8")).trim();
  } catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}

async function main() {
  if (process.argv[2] === "--check") {
    if (!await loadKey()) throw new Error("Set MINIMAX_API_KEY or run node connectors/loop-keepers/minimax/key.mjs");
    console.log("MiniMax key configured locally."); return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Run this command in your terminal to enter the key without displaying it.");
  const muted = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const input = createInterface({ input: process.stdin, output: muted, terminal: true });
  process.stdout.write("MiniMax API / M Plan key (hidden input): ");
  let key;
  try { key = await input.question(""); } finally { input.close(); process.stdout.write("\n"); }
  await saveKey(key);
  console.log(`Saved with permissions 600 to ${keyFile()}. No API calls were made.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
