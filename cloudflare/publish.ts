import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { collectPublication, publicationSQL } from "./catalog";

const args = process.argv.slice(2);
if (args.some((arg) => !["--local", "--dry-run"].includes(arg))) throw new Error("Usage: pnpm publish:replays [--local] [--dry-run]");
const root = resolve(import.meta.dirname, "..");
const publication = await collectPublication(root);
const sql = publicationSQL(publication);
console.log(`${publication.replays.length} agent battles, ${publication.series.length} complete series; ${publication.excluded} bot/demo recordings excluded.`);
if (!args.includes("--dry-run")) {
  const dir = await mkdtemp(join(tmpdir(), "aoa-publish-"));
  try {
    const file = join(dir, "replays.sql");
    await writeFile(file, sql, { mode: 0o600 });
    const result = spawnSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", args.includes("--local") ? "--local" : "--remote", "--file", file, "--yes", "--json"], { cwd: root, encoding: "utf8", stdio: ["inherit", "pipe", "inherit"], maxBuffer: 16 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      console.error(result.stdout.slice(-3000));
      throw new Error(`Publication failed (exit ${result.status}); it is safe to retry.`);
    }
    console.log("Published. Public catalogue caches refresh within 60 seconds.");
  } finally { await rm(dir, { recursive: true, force: true }); }
}
