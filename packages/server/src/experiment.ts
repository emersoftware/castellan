import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_ACTIVITY_STATES, isGenericConnector, type AgentActivity, type AgentConfiguration, type ExperimentManifest, type PlayerId, type PlayerTiming, type Ruleset } from "@castellan/shared";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const unknownAgent = (): AgentConfiguration => ({ model: null, effort: null, connector: null,
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
function engineIdentity(): ExperimentManifest["engine"] {
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
    for (const name of ["bots", "engine", "sandbox", "shared", "server", "sim"]) visit(resolve(root, "packages", name, "src"));
    for (const name of ["cli/src", "mcp/src", "loop-keepers"]) visit(resolve(root, "connectors", name));
    const hash = createHash("sha256");
    for (const file of files.sort()) hash.update(relative(root, file)).update("\0").update(readFileSync(file)).update("\0");
    hash.update(readFileSync(resolve(root, "pnpm-lock.yaml")));
    sourceSha256 = hash.digest("hex");
  } catch { /* null means unavailable, never pretend revision identifies dirty sources */ }
  identity = { revision, sourceSha256, runtime: process.version };
  return { ...identity };
}

type CallEntry = ExperimentManifest["calls"][number];
type Timing = PlayerTiming & { answeredAt: number | null };

/** A player's call, from its request to its answer. Its route marks in-game failures and time spent in a long-poll. */
export interface PlayerCall {
  failed: boolean;
  waitedMs: number;
  /** The server answered with this HTTP status. */
  answer(status: number): void;
}

/** What a recorder reads from its room: the match tick and the tick of each player's last view. */
interface RecordedRoom {
  readonly tick: number;
  cursor(player: PlayerId): number;
}

/**
 * One room's experiment record: the agents its players declare, every call they make, their timing, activity
 * and operational failures. Thinking, waiting and action gaps count only while the match runs.
 */
export class ExperimentRecorder {
  private record: ExperimentManifest;
  private timings = new Map<PlayerId, Timing>();
  private lastActionAt = new Map<PlayerId, number>();
  private open = new Set<CallEntry>();
  private phase: "before" | "running" | "finished" = "before";
  private runningSince = 0;

  /**
   * `agents`: each player's declared agent, if its host declared one. `onSettled`: the match has finished
   * and no call is still open, so its record is complete.
   */
  constructor(private room: RecordedRoom, private players: readonly { id: PlayerId; bot?: { name: string } }[],
    setup: { ruleset: Ruleset; guide: string; agents: (AgentConfiguration | undefined)[] }, private onSettled: () => void) {
    this.record = { schema: 1, engine: engineIdentity(), rulesSha256: sha256(JSON.stringify(setup.ruleset)), baseGuideSha256: sha256(setup.guide), mode: "independent",
      players: Object.fromEntries(players.map((p, i) => {
        const configuration = setup.agents[i] ?? { ...unknownAgent(), ...(p.bot ? { model: `bot:${p.bot.name}`, connector: "reference-bot", memoryPolicy: "match-local" } : {}) };
        return [p.id, { configuration, changes: [{ tick: 0, configuration }] }];
      })),
      calls: [], droppedCalls: 0 };
  }

  /** The match runs from now. */
  running() {
    this.phase = "running";
    this.runningSince = Date.now();
  }

  /** The match is over: closes every player's action gap; calls still open complete the record later. */
  finished() {
    for (const p of this.players) this.closeActionGap(p.id);
    this.phase = "finished";
  }

  get settled(): boolean {
    return this.phase === "finished" && this.open.size === 0;
  }

  /** A player's call begins. The gap since its previous answer is its thinking time (model and harness). */
  call(player: PlayerId, tool: string): PlayerCall {
    const t = this.timingOf(player);
    t.calls++;
    const age = Math.max(0, this.room.tick - this.room.cursor(player));
    t.observationAgeTicksTotal = (t.observationAgeTicksTotal ?? 0) + age;
    t.observationAgeTicksMax = Math.max(t.observationAgeTicksMax ?? 0, age);
    if (this.phase === "running" && t.answeredAt !== null) {
      const gap = Date.now() - Math.max(t.answeredAt, this.runningSince);
      t.thinkMs += gap;
      t.thinks++;
      t.maxThinkMs = Math.max(t.maxThinkMs, gap);
    }
    t.answeredAt = null;
    const entry: CallEntry = { player, tool, startedTick: this.room.tick, observationTick: this.room.cursor(player), answeredTick: null, durationMs: null, status: null };
    const startedAt = Date.now();
    const call: PlayerCall = { failed: false, waitedMs: 0, answer: (status) => this.answered(entry, call, startedAt, status) };
    // Calls started after completion belong to replay browsing, not competition.
    if (this.phase === "finished") return call;
    this.open.add(entry);
    if (this.record.calls.length < 20_000) this.record.calls.push(entry);
    else this.record.droppedCalls++;
    return call;
  }

  private answered(entry: CallEntry, call: PlayerCall, startedAt: number, status: number) {
    const t = this.timingOf(entry.player);
    t.answeredAt = Date.now();
    if (this.phase === "running") t.waitMs += call.waitedMs;
    Object.assign(entry, { answeredTick: this.room.tick, durationMs: Date.now() - startedAt, status, failed: status >= 400 || call.failed });
    if (!this.open.delete(entry)) return;
    if (entry.failed) t.toolErrors = (t.toolErrors ?? 0) + 1;
    if (this.settled) this.onSettled();
  }

  /** A player's orders were applied or refused. `at`: when its call made them; `acted`: some took effect in the game. */
  decision(player: PlayerId, { at, orders, rejected, acted }: { at: number; orders: number; rejected: number; acted: boolean }) {
    const t = this.timingOf(player);
    t.decisions++;
    t.orders += orders;
    t.firstActionMs ??= at - this.runningSince;
    t.rejectedOrders = (t.rejectedOrders ?? 0) + rejected;
    if (!acted) return;
    this.closeActionGap(player);
    this.lastActionAt.set(player, Date.now());
  }

  /** The host's declaration of a player's agent, replacing the previous one. */
  configure(player: PlayerId, configuration: AgentConfiguration) {
    const record = this.record.players[player];
    if (JSON.stringify(record.configuration) === JSON.stringify(configuration)) return;
    if (record.changes.length >= 128) throw new Error("too many agent configuration changes");
    record.changes.push({ tick: this.room.tick, configuration });
    record.configuration = configuration;
  }

  /** A connector's declaration on each call: it adds known fields without erasing a host's more complete configuration. */
  declare(player: PlayerId, configuration: AgentConfiguration) {
    const current = this.record.players[player].configuration;
    const merged = { ...current, ...Object.fromEntries(Object.entries(configuration).filter(([, value]) => value !== null)) } as AgentConfiguration;
    if (isGenericConnector(configuration.connector) && current.connector && !isGenericConnector(current.connector)) merged.connector = current.connector;
    this.configure(player, merged);
  }

  /** What a player's harness reports doing; throws on an invalid report. */
  activity(player: PlayerId, body: unknown) {
    const data = body as { state?: unknown; retryAt?: string } | null;
    const state = AGENT_ACTIVITY_STATES.find((s) => s === data?.state);
    if (!data || !state) throw new Error("invalid agent activity");
    if (data.retryAt !== undefined && (typeof data.retryAt !== "string" || !Number.isFinite(Date.parse(data.retryAt)))) throw new Error("invalid retryAt");
    const history = this.record.agentActivity ??= [];
    if (history.length >= 20_000) return;
    const activity: AgentActivity = { state, at: new Date().toISOString(), ...(data.retryAt ? { retryAt: new Date(data.retryAt).toISOString() } : {}) };
    history.push({ player, tick: this.room.tick, activity });
  }

  /** The last activity a player's harness reported. */
  latestActivity(player: PlayerId): AgentActivity | undefined {
    return [...(this.record.agentActivity ?? [])].reverse().find((e) => e.player === player)?.activity;
  }

  /** A failure of the server's own machinery (such as a script engine's watchdog), recorded once per player and message. */
  operationalFailure(player: PlayerId, message: string, tick = this.room.tick) {
    const failures = this.record.operationalFailures ??= [];
    if (!failures.some((failure) => failure.player === player && failure.message === message)) failures.push({ tick, player, message });
  }

  /** Each player's timing; reference bots are not timed. */
  timing(): Record<PlayerId, PlayerTiming> {
    const out: Record<PlayerId, PlayerTiming> = {};
    for (const p of this.players) {
      if (p.bot) continue;
      const { answeredAt: _, ...t } = this.timingOf(p.id);
      if (this.phase === "running") t.maxActionGapMs = Math.max(t.maxActionGapMs ?? 0, Date.now() - (this.lastActionAt.get(p.id) ?? this.runningSince));
      out[p.id] = t;
    }
    return out;
  }

  /** A copy of the record, for a replay (with its series mode) or a checkpoint. */
  manifest(mode?: ExperimentManifest["mode"]): ExperimentManifest {
    const copy = structuredClone(this.record);
    if (mode) copy.mode = mode;
    return copy;
  }

  /** Continues the record a checkpoint kept; a finished match's record takes no more calls. */
  restore(record: ExperimentManifest | undefined, timing: Record<PlayerId, PlayerTiming>, { finished }: { finished: boolean }) {
    if (record) this.record = structuredClone(record);
    for (const [player, t] of Object.entries(timing)) this.timings.set(player, { ...t, answeredAt: null });
    if (finished) this.phase = "finished";
  }

  private closeActionGap(player: PlayerId) {
    const t = this.timingOf(player);
    t.maxActionGapMs = Math.max(t.maxActionGapMs ?? 0, Date.now() - (this.lastActionAt.get(player) ?? this.runningSince));
  }

  private timingOf(player: PlayerId): Timing {
    let t = this.timings.get(player);
    if (!t) {
      t = { calls: 0, decisions: 0, orders: 0, thinkMs: 0, thinks: 0, maxThinkMs: 0, waitMs: 0, firstActionMs: null, answeredAt: null };
      this.timings.set(player, t);
    }
    return t;
  }
}
