// What would a model train under these rules? Shows the real player guide and a short situation, asks for the
// spending decision as JSON, no game played. Measures the composition models lean to before they play.
//   npx tsx src/choice-probe.mts label=replayId|rules.json … [--reps 4] [--models gpt-6.1-sol,gpt-6-astra]
//   → /tmp/aoa-probe/<label>.json and a summary
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { playerGuide, type EntityKind, type Ruleset } from "@aoa/shared";
// @ts-expect-error Plain Node launcher shared with external harnesses.
import { codexBin, isolatedExec, isolatedHome } from "../../../connectors/loop-keepers/codex/agent.mjs";

const OUT = "/tmp/aoa-probe";
const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const REPS = Number(arg("reps", "4")), MODELS = arg("models", "gpt-6.1-sol,gpt-6-astra").split(","), PARALLEL = Number(arg("parallel", "6"));
const targets = process.argv.slice(2).filter((a) => a.includes("="));

/** Situations, stated as facts only. */
const SITUATIONS = [
  "Minute 0:30. You have your castle, your king, 3 workers gathering and 150 mineral. No enemy seen yet.",
  "Minute 2:00. You have 6 workers, 500 mineral and no combat units yet. Seen near your base: 6 enemy archers.",
  "Minute 2:00. You have 6 workers, 500 mineral and no combat units yet. Seen near your base: 6 enemy knights.",
  "Minute 4:00. You have 8 workers, 800 mineral, 4 knights and 4 archers. The enemy has 8 archers with damage and range research, and 2 towers next to its castle.",
];
const ASK = `Decide what you spend on during the next minute. Reply with JSON only, no other text:
{"train":{"worker":0,"knight":0,"archer":0},"build":{"tower":0,"wall":0},"research":["upgrade ids"],"why":"one sentence"}`;

function rulesOf(source: string): Ruleset {
  if (source.endsWith(".json")) return JSON.parse(readFileSync(source, "utf8"));
  return JSON.parse(gunzipSync(readFileSync(`/Users/emersoftware/Documents/projects/aoa/replays/${source}.json.gz`)).toString()).ruleset;
}

/** One isolated, tool-less Codex call (same isolation as the player connector, without the game tools). */
async function ask(model: string, prompt: string): Promise<string> {
  const run = mkdtempSync(join(tmpdir(), "aoa-probe-"));
  const { home, workspace } = await isolatedHome(run);
  const out = join(run, "answer.txt");
  const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: home };
  for (const k of ["OPENAI_API_KEY", "CODEX_API_KEY", "AOA_TOKEN", "AOA_DIRECTIVE"]) delete env[k];
  return new Promise((resolve) => {
    const child = spawn(codexBin(env), [...isolatedExec({ workspace }), "--ephemeral",
      "-m", model, "-c", 'model_reasoning_effort="low"', "-o", out, "-"], { env, stdio: ["pipe", "ignore", "ignore"] });
    child.stdin.end(prompt);
    child.on("exit", () => { const text = existsSync(out) ? readFileSync(out, "utf8") : ""; rmSync(run, { recursive: true, force: true }); resolve(text); });
  });
}

type Answer = { train?: Record<string, number>; build?: Record<string, number>; research?: string[]; why?: string };
const parse = (text: string): Answer | null => { try { return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { return null; } };

mkdirSync(OUT, { recursive: true });
for (const target of targets) {
  const [label, source] = target.split("=");
  const ruleset = rulesOf(source);
  const guide = playerGuide(ruleset, { tickRate: 10 });
  const jobs = MODELS.flatMap((model) => SITUATIONS.flatMap((situation, s) => Array.from({ length: REPS }, (_, rep) => ({ model, s, rep, situation }))));
  const results: (typeof jobs[number] & { answer: Answer | null })[] = [];
  const queue = [...jobs];
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const text = await ask(job.model, `You play Age of Agents, a real-time strategy game. The rules:\n\n${guide}\n\n${job.situation}\n\n${ASK}`);
      results.push({ ...job, answer: parse(text) });
    }
  }));
  writeFileSync(`${OUT}/${label}.json`, JSON.stringify({ version: ruleset.version, results }, null, 1));
  // Share of the combat mineral each model puts in knights, archers and towers.
  const cost = (k: EntityKind) => ruleset.kinds[k]?.cost ?? 0;
  for (const model of MODELS) {
    const spent = { knight: 0, archer: 0, tower: 0 };
    let answered = 0;
    for (const r of results.filter((r) => r.model === model && r.answer)) {
      answered++;
      spent.knight += (r.answer!.train?.knight ?? 0) * cost("knight");
      spent.archer += (r.answer!.train?.archer ?? 0) * cost("archer");
      spent.tower += (r.answer!.build?.tower ?? 0) * cost("tower");
    }
    const total = spent.knight + spent.archer + spent.tower || 1;
    const pct = (x: number) => `${Math.round((100 * x) / total)}%`;
    console.log(`${label} (${ruleset.version}) ${model}: knights ${pct(spent.knight)} · archers ${pct(spent.archer)} · towers ${pct(spent.tower)} (${answered}/${REPS * SITUATIONS.length} answers)`);
  }
}
