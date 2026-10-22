/** JSONL journal per match plus a readable summary: what was observed, decided, attempted and what happened. */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { outcomeText } from "@castellan/shared";
import type { ObservedClock } from "./clock";
import type { CastellanBot } from "./core";
import type { JournalEntry } from "./types";

export class Journal {
  readonly file: string;
  private lines = 0;
  constructor(readonly dir: string, readonly name: string, private clock: ObservedClock, private echo: (line: string) => void = () => {}) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, `${name}.jsonl`);
    writeFileSync(this.file, "");
  }

  write(e: JournalEntry) {
    appendFileSync(this.file, JSON.stringify(e) + "\n");
    this.lines++;
    if (NOTABLE.has(e.type)) this.echo(`[${this.clock.seconds(e.tick).toFixed(1)}s] ${e.type} ${describe(e)}`);
  }

  /** Markdown summary from the core's bookkeeping. */
  summary(core: CastellanBot, extra: Record<string, unknown> = {}): string {
    const s = core.summary();
    const t = (tick: number) => `${this.clock.seconds(tick).toFixed(0)}s`;
    const out: string[] = [];
    out.push(`# Castellan Bot ${this.name}`, "");
    const o = s.outcome;
    out.push(`- Outcome: ${o ? `${outcomeText(o)} (${o.reason}) at ${t(s.tick)}` : "unfinished"}; I am ${s.you}`);
    for (const [k, v] of Object.entries(extra)) out.push(`- ${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
    out.push(`- Cycles ${s.stats.cycles}, orders ${s.stats.ordersSent}, rejected ${s.stats.ordersRejected}, script errors ${s.stats.scriptErrors}, chat sent/received ${s.stats.chatSent}/${s.stats.chatReceived}`);
    out.push(`- Built: ${fmt(s.stats.built)}; losses: ${fmt(s.stats.losses)}; kills: ${fmt(s.stats.kills)}`);
    out.push("", "## Episodes (plans with a goal)", "");
    out.push("| id | kind | plan | source | start | end | status | result |", "|---|---|---|---|---|---|---|---|");
    for (const e of s.episodes) out.push(`| ${e.id} | ${e.kind} | ${e.label} | ${e.source} | ${t(e.startedTick)} | ${e.endedTick === undefined ? "" : t(e.endedTick)} | ${e.status} | ${e.result ?? ""} |`);
    out.push("", "## Execution failures", "");
    const rej = Object.entries(s.executorRejected).sort((a, b) => b[1] - a[1]);
    out.push(rej.length ? rej.map(([r, n]) => `- rejected ×${n}: ${r}`).join("\n") : "- no rejected orders");
    const failed = s.plan.builds.filter((b) => b.status === "failed" || b.status === "cancelled");
    for (const b of failed) out.push(`- build ${b.label}: ${b.status}${b.reason ? ` (${b.reason})` : ""}`);
    out.push("", "## Plan at the end", "", "```json", JSON.stringify({ posture: s.posture, expansion: s.plan.expansion, keep: s.plan.keep, truces: s.plan.truces, research: s.plan.research }, null, 1), "```", "");
    out.push(`Journal: ${this.file} (${this.lines} entries)`);
    return out.join("\n");
  }

  save(core: CastellanBot, extra: Record<string, unknown> = {}): string {
    const text = this.summary(core, extra);
    const file = join(this.dir, `${this.name}.md`);
    writeFileSync(file, text);
    return file;
  }
}

const NOTABLE = new Set(["init", "posture", "episode_start", "episode_end", "build_done", "build_failed", "build_interrupted", "expansion_start", "expansion_built", "expansion_lost", "attack_start", "retreat", "chat_sent", "chat_received", "truce", "truce_broken", "script_error", "keep_built", "research", "scout", "endgame", "home_threat_choice", "expansion_defense", "match_end", "runtime"]);

function describe(e: JournalEntry): string {
  const { t, tick, type, ...rest } = e;
  void t; void tick; void type;
  return Object.entries(rest).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" ").slice(0, 220);
}

function fmt(o: Record<string, number>): string {
  const e = Object.entries(o);
  return e.length ? e.map(([k, v]) => `${k} ${v}`).join(", ") : "none";
}
