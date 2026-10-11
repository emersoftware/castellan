import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentConfiguration, ExperimentManifest } from "@aoa/shared";

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const unknownAgent = (): AgentConfiguration => ({ model: null, effort: null, connector: null,
  connectorVersion: null, promptSha256: null, memoryPolicy: null, contextPolicy: null });

/** Strict allow-list: accidentally passing an environment/config object must never record secrets. */
export function agentConfiguration(input: unknown): AgentConfiguration {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("agent configuration must be an object");
  const result = unknownAgent();
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(result, key)) throw new Error(`unknown agent configuration field: ${key}`);
    if (value !== null && (typeof value !== "string" || value.length > 256 || /[\r\n]/.test(value))) throw new Error(`invalid agent configuration field: ${key}`);
    if (key === "promptSha256" && value !== null && !/^[a-f0-9]{64}$/.test(value as string)) throw new Error("promptSha256 must be a lowercase SHA-256 digest");
    result[key as keyof AgentConfiguration] = value as string | null;
  }
  return result;
}

let identity: ExperimentManifest["engine"] | undefined;
export function engineIdentity(): ExperimentManifest["engine"] {
  if (identity) return { ...identity };
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  let revision: string | null = null, sourceSha256: string | null = null;
  try { revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* packaged source may not include git */ }
  try {
    const files: string[] = [];
    const visit = (dir: string) => { for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules") visit(path); else if (/\.(?:[cm]?[jt]s|sh|md|json|toml)$/.test(entry.name)) files.push(path);
    } };
    for (const name of ["engine", "sandbox", "shared", "server", "sim"]) visit(resolve(root, "packages", name, "src"));
    for (const name of ["cli/src", "mcp/src", "loop-keepers"]) visit(resolve(root, "connectors", name));
    const hash = createHash("sha256");
    for (const file of files.sort()) hash.update(relative(root, file)).update("\0").update(readFileSync(file)).update("\0");
    hash.update(readFileSync(resolve(root, "pnpm-lock.yaml")));
    sourceSha256 = hash.digest("hex");
  } catch { /* null means unavailable, never pretend revision identifies dirty sources */ }
  identity = { revision, sourceSha256, runtime: process.version };
  return { ...identity };
}
