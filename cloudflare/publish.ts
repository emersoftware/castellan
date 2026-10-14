import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { collectPublication, publicationSQL } from "./catalog";

const args = process.argv.slice(2);
// `--version v21b`: only games under that set of rules (the engine replays no other), and series made of them.
const versionAt = args.indexOf("--version"), version = versionAt >= 0 ? args.splice(versionAt, 2)[1] : undefined;
if (versionAt >= 0 && !version) throw new Error("--version needs a ruleset version prefix");
// `--only id1,id2`: just these games (and series made only of them).
const onlyAt = args.indexOf("--only"), only = onlyAt >= 0 ? new Set(args.splice(onlyAt, 2)[1]?.split(",").filter(Boolean)) : undefined;
if (onlyAt >= 0 && !only?.size) throw new Error("--only needs comma-separated replay ids");
if (args.some((arg) => !["--local", "--dry-run"].includes(arg))) throw new Error("Usage: pnpm publish:replays [--local] [--dry-run] [--version <prefix>] [--only <id,...>]");
const root = resolve(import.meta.dirname, "..");
const publication = await collectPublication(root);
if (only) {
  const missing = [...only].filter((id) => !publication.replays.some((r) => r.replay.id === id));
  if (missing.length) throw new Error(`Not publishable or not found: ${missing.join(", ")}`);
}
if (version || only) {
  if (version) publication.replays = publication.replays.filter((r) => r.replay.ruleset.version === version || r.replay.ruleset.version.startsWith(`${version}-`));
  if (only) publication.replays = publication.replays.filter((r) => only.has(r.replay.id));
  const kept = new Set(publication.replays.map((r) => r.replay.id));
  publication.series = publication.series.filter((s) => s.summary.games.every((g) => kept.has(g.roomId)));
}
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
