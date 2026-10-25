import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { localReplays } from "../packages/shared/src/localData";
import { applyLanding, prepareLanding, verifyLandingBuild, type LandingSelection } from "./landing-release";

const { values } = parseArgs({ options: {
  hero: { type: "string" }, duel: { type: "string" }, teams: { type: "string" },
  "replay-dir": { type: "string" }, "dry-run": { type: "boolean" }, deploy: { type: "boolean" },
  url: { type: "string", default: "https://rts.emersoftware.cl" }, help: { type: "boolean" },
} });
if (values.help) {
  console.log("pnpm landing:update [--hero ID] [--duel ID] [--teams ID] [--replay-dir DIR] [--dry-run | --deploy] [--url URL]\nOmitted slots keep featured.json. Default: verify, prepare local files and hero. --deploy also publishes selected data, deploys and verifies the public result. No games, commits or pushes.");
} else {
  if (values["dry-run"] && values.deploy) throw new Error("Choose --dry-run or --deploy, not both");
  const root = resolve(import.meta.dirname, "..");
  const archive = resolve(values["replay-dir"] ?? localReplays());
  const selection: LandingSelection = JSON.parse(await readFile(resolve(root, "packages/web/src/featured.json"), "utf8"));
  for (const slot of ["hero", "duel", "teams"] as const) if (values[slot]) selection[slot] = values[slot];
  console.log("Verifying selected recordings (no writes yet)…");
  const plan = await prepareLanding(root, archive, selection);
  console.log(JSON.stringify(plan.summaries, null, 2));
  if (!values["dry-run"]) {
    await applyLanding(root, plan);
    const run = (args: string[]) => {
      console.log(`> pnpm ${args.join(" ")}`);
      const result = spawnSync("pnpm", args, { cwd: root, stdio: "inherit", env: { ...process.env, REPLAY_DIR: archive } });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`Stopped at: pnpm ${args.join(" ")} (exit ${result.status}). Prepared files remain available; no automatic retry.`);
    };
    if (values.deploy) {
      // Build before remote writes. Cloudflare output never replaces the live local dist.
      run(["build:cloudflare"]);
      run(["cloud:typecheck"]);
      const ids = [selection.hero, selection.duel, selection.teams].join(",");
      run(["publish:replays", "--only", ids]);
      run(["cloud:verify", values.url!, "--only", ids]);
      run(["exec", "wrangler", "deploy"]);
      await verifyLandingBuild(values.url!, resolve(root, "packages/web/dist-cloudflare"), selection.hero);
      console.log(`Landing published and verified at ${values.url}`);
    } else {
      run(["--filter", "@castellan/web", "showcase:build"]);
      console.log("Landing prepared locally. Review the diff; add --deploy to publish this selection.");
    }
  }
}
