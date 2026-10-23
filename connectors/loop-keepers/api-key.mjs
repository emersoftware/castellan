// @ts-check
// A provider API key for a keeper: its environment variable, or a private file in ~/.config/castellan.
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { configFile } from "./game.mjs";

/**
 * @param {{ provider: string, variable: string, fileVariable: string, file: string, command: string, prompt: string }} key
 *   `command` is the key script, shown in errors; `prompt` labels the hidden input.
 */
export function apiKey({ provider, variable, fileVariable, file, command, prompt }) {
  const keyFile = (env = process.env) => env[fileVariable] || configFile(file);
  async function loadKey(env = process.env) {
    if (env[variable]?.trim()) return /** @type {string} */ (env[variable]).trim();
    const path = keyFile(env);
    try {
      const info = await stat(path);
      if ((info.mode & 0o077) !== 0) throw new Error(`${provider} key file must be private: chmod 600 ${path}`);
      return (await readFile(path, "utf8")).trim();
    } catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return ""; throw error; }
  }
  /** `--check` reports whether a key is configured; otherwise reads one without echoing it and saves it privately. */
  async function main(args = process.argv.slice(2)) {
    if (args[0] === "--check") {
      if (!await loadKey()) throw new Error(`Set ${variable} or run node ${command}`);
      console.log(`${provider} key configured locally.`); return;
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Run this command in your terminal to enter the key without displaying it.");
    // Readline owns editing/raw-mode cleanup; its output (including typed text) is muted.
    const muted = new Writable({ write(_chunk, _encoding, done) { done(); } });
    const input = createInterface({ input: process.stdin, output: muted, terminal: true });
    process.stdout.write(`${prompt} (hidden input): `);
    let key;
    try { key = await input.question(""); } finally { input.close(); process.stdout.write("\n"); }
    await savePrivateKey(key, keyFile());
    console.log(`Saved with permissions 600 to ${keyFile()}. No API calls were made.`);
  }
  return { loadKey, keyFile, main };
}

/** Writes a key readable only by this user, atomically. */
export async function savePrivateKey(key, path) {
  const value = key.trim();
  if (!value || /\s/.test(value)) throw new Error("The key is empty or contains whitespace; it was not saved.");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const pending = `${path}.${randomUUID()}.tmp`;
  await writeFile(pending, value + "\n", { mode: 0o600, flag: "wx" });
  await rename(pending, path);
}
