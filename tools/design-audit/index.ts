// Looks for red flags from "A Philosophy of Software Design" (Ousterhout). Every hit is a candidate to review, not a verdict.
// Usage: pnpm design:audit [paths...] [--only=id,id] [--changed] [--all] [--list] [--acknowledged] [--keys] [--sites] [--check]
//   --check exits 1 while any finding is open or an acknowledgment is stale.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { acknowledged } from "./acknowledged.ts";
import { checks, type Source } from "./checks.ts";

const PER_CHECK = 15;
const args = process.argv.slice(2);
const option = (name: string) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))?.split("=")[1] ?? args.includes(`--${name}`);
const paths = args.filter((a) => !a.startsWith("--"));
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const git = (...gitArgs: string[]) => execFileSync("git", gitArgs, { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);

if (option("list")) {
  for (const c of checks) console.log(`${c.id.padEnd(22)} ${c.flag} (ch${c.chapter})`);
  process.exit(0);
}

// connectors/autonomous belongs to another agent; it is only audited when named explicitly.
const files = git("ls-files", "--cached", "--others", "--exclude-standard", "--", ...(paths.length ? paths : ["packages", "connectors", "cloudflare"])).filter(
  (f) =>
    /\.(ts|tsx|mts|mjs|js)$/.test(f) &&
    !/\.d\.ts$|\.test\.|(^|\/)(test|dist|node_modules|public)\//.test(f) &&
    (paths.length > 0 || !f.startsWith("connectors/autonomous/")) &&
    existsSync(`${root}/${f}`),
);

const sources: Source[] = files.map((path) => {
  const text = readFileSync(`${root}/${path}`, "utf8");
  const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : /\.m?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return { path, abs: `${root}/${path}`, pkg: path.split("/").slice(0, path.startsWith("cloudflare/") ? 1 : 2).join("/"), text, ast: ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true, kind) };
});

const only = typeof option("only") === "string" ? new Set((option("only") as string).split(",")) : undefined;
const changed = option("changed") ? new Set([...git("diff", "--name-only", "HEAD"), ...git("ls-files", "--others", "--exclude-standard")]) : undefined;
const limit = option("all") ? Infinity : PER_CHECK;

console.log(`${sources.length} files${changed ? ", reporting only changed ones" : ""}\n`);
const totals: string[] = [];
let failing = false;
for (const check of checks.filter((c) => !only || only.has(c.id))) {
  const all = check.run(sources);
  const kept = acknowledged[check.id] ?? {};
  const stale = Object.keys(kept).filter((key) => !all.some((f) => f.key === key));
  // With --changed, a finding spread over several files is shown at its site in a changed file.
  const found = all
    .filter((f) => !(f.key in kept))
    .flatMap((f) => {
      const site = changed ? (f.sites ?? [f]).find((x) => changed.has(x.file)) : f;
      return site ? [{ ...f, file: site.file, line: site.line }] : [];
    })
    .sort((a, b) => b.score - a.score);
  const known = Object.keys(kept).length - stale.length;
  totals.push(`${check.id.padEnd(22)} ${found.length}${known ? `  (+${known} acknowledged)` : ""}`);
  failing ||= found.length > 0 || stale.length > 0;
  for (const key of stale) console.log(`! stale acknowledgment in ${check.id}: ${key}`);
  if (option("acknowledged") && known) {
    console.log(`■ ${check.flag}: acknowledged`);
    for (const [key, reason] of Object.entries(kept)) if (!stale.includes(key)) console.log(`  ${key}  — ${reason}`);
    console.log();
  }
  if (!found.length) continue;
  console.log(`■ ${check.flag} (ch${check.chapter}) — ${found.length}  [${check.id}]\n  ${check.hint}`);
  for (const f of found.slice(0, limit)) {
    console.log(`  ${f.file}:${f.line}  ${f.message}${option("keys") ? `\n      key: ${f.key}` : ""}`);
    if (option("sites")) for (const x of f.sites ?? []) console.log(`      ${x.file}:${x.line}`);
  }
  if (found.length > limit) console.log(`  … ${found.length - limit} more (--all)`);
  console.log();
}
console.log(totals.join("\n"));
if (option("check") && failing) process.exit(1);
