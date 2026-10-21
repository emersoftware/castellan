/** Independent engine harness. Controllers receive only the same PlayerView as a remote player.
 * Observer-only instrumentation below measures results; it is never input to a controller.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { createMatch, type Match, type PlayerOrder } from "../../packages/engine/src/index";
import { MAPS, rules, type EntityView, type GameEvent, type Order, type OrderResult, type PlayerView, type ReplayFile, type Ruleset } from "../../packages/shared/src/index";
import { eco, rush, type Bot } from "../../packages/sim/src/bots";
import { AutonomousPlayer } from "./src/player";

export type Participant = { id: string; name: string; side: number; team: number };
export type Controller = AutonomousPlayer | Bot;
export type ObservedEvent = { timeMs: number; event: GameEvent };
export type Rejection = { tick: number; player: string; order: Order; result: OrderResult };
export type UnloadEvidence = { tick: number; owner: string; worker: string; amount: number; dropoff: string; x: number; y: number; builtDuringMatch: boolean };

async function sourceFingerprints() {
  const paths = ["src/player.ts", "src/scripts.ts", "validate.ts", "../../packages/shared/src/rules.ts", "../../packages/engine/src/match.ts"];
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash("sha256").update(await readFile(new URL(path, import.meta.url))).digest("hex")])));
}

export class Experiment {
  readonly orders: ReplayFile["orders"] = [];
  readonly hashes: ReplayFile["hashes"] = {};
  readonly events: ObservedEvent[] = [];
  readonly rejected: Rejection[] = [];
  readonly unloads: UnloadEvidence[] = [];
  readonly traces: { player: string; event: unknown }[] = [];
  readonly completedBuildings = new Map<string, Extract<GameEvent, { type: "spawn" }>>();
  readonly entities = new Map<string, EntityView>();
  readonly projectileSources = new Map<string, string>();
  readonly damage = new Map<string, number>();
  readonly crossings: { tick: number; door: string; unit: string; owner: string }[] = [];
  lastResults: OrderResult[] = [];
  private readonly cursor = new Map<string, number>();
  private readonly chats = new Map<string, NonNullable<PlayerView["chat"]>["messages"]>();

  constructor(readonly match: Match, readonly players: Participant[], readonly controllers: Map<string, Controller>, readonly seed: number, readonly decisionEveryTicks = 5) {}

  /** Chat is reconstructed from each player's filtered event stream, like a room's /chat response. */
  view(id: string): PlayerView {
    const view = this.match.view(id, this.cursor.get(id) ?? 0);
    const messages = this.chats.get(id) ?? [];
    for (const event of view.events) {
      if (event.type !== "chat" || messages.some(m => m.tick === event.tick && m.from === event.owner && m.text === event.text)) continue;
      messages.push({ tick: event.tick, from: event.owner, name: this.players.find(p => p.id === event.owner)?.name ?? event.owner,
        text: event.text, channel: event.channel, to: event.to });
    }
    this.chats.set(id, messages);
    return { ...view, chat: { enabled: true, messages: messages.slice(-5) } };
  }

  tick(extra: PlayerOrder[] = [], paused = new Set<string>()): GameEvent[] {
    const tick = this.match.tick;
    const input: PlayerOrder[] = [];
    const batches: { id: string; controller: AutonomousPlayer; offset: number; orders: Order[] }[] = [];
    if (tick % this.decisionEveryTicks === 0) for (const [id, controller] of this.controllers) {
      if (paused.has(id)) continue;
      const view = this.view(id);
      const orders = typeof controller === "function" ? controller(view) : controller.step(view);
      if (typeof controller !== "function") batches.push({ id, controller, offset: input.length, orders });
      input.push(...orders.map(order => ({ player: id, order })));
      this.cursor.set(id, tick);
    }
    input.push(...extra);
    for (const item of input) this.orders.push({ tick, ...item });
    const result = this.match.step(input);
    this.lastResults = result.results;
    result.results.forEach((feedback, index) => { if (!feedback.ok) this.rejected.push({ tick, ...input[index], result: feedback }); });
    for (const batch of batches) batch.controller.feedback(batch.orders, result.results.slice(batch.offset, batch.offset + batch.orders.length), this.view(batch.id));
    if (tick % 100 === 0) this.hashes[tick] = this.match.hash();
    this.observe(result.events);
    return result.events;
  }

  advanceTo(timeMs: number, extra?: (experiment: Experiment) => PlayerOrder[], paused?: Set<string>) {
    while (!this.match.outcome && this.match.tick * 1000 / this.match.tickRate < timeMs) this.tick(extra?.(this), paused);
  }

  private observe(events: GameEvent[]) {
    // Test/research observer access is kept on this side of the PlayerView boundary.
    const frame = this.match.spectate();
    for (const entity of frame.entities) this.entities.set(entity.id, entity);
    for (const event of events) {
      this.events.push({ timeMs: event.tick * 1000 / this.match.tickRate, event });
      if (event.type === "spawn" && event.builder) this.completedBuildings.set(event.id, event);
      if (event.type === "attack") {
        if (event.projectile) this.projectileSources.set(event.projectile, event.from);
        else this.damage.set(event.from, (this.damage.get(event.from) ?? 0) + event.dmg);
      }
      if (event.type === "projectile_end" && event.dmg) {
        const source = this.projectileSources.get(event.id);
        if (source) this.damage.set(source, (this.damage.get(source) ?? 0) + event.dmg);
      }
      if (event.type === "unload") {
        const worker = frame.entities.find(e => e.id === event.id);
        const dropoff = worker && frame.entities.find(e => e.owner === event.owner && this.match.ruleset.kinds[e.kind]?.dropoff
          && Math.max(Math.abs(e.x - worker.x), Math.abs(e.y - worker.y)) <= 1);
        if (worker && dropoff) this.unloads.push({ tick: event.tick, owner: event.owner, worker: worker.id, amount: event.amount,
          dropoff: dropoff.id, x: dropoff.x, y: dropoff.y, builtDuringMatch: this.completedBuildings.has(dropoff.id) });
      }
    }
    for (const door of frame.entities.filter(e => e.kind === "door" && e.open)) {
      const unit = frame.entities.find(e => e.id !== door.id && e.x === door.x && e.y === door.y);
      if (unit && !this.crossings.some(c => c.door === door.id && c.unit === unit.id)) this.crossings.push({ tick: frame.tick, door: door.id, unit: unit.id, owner: unit.owner });
    }
  }

  summary() {
    const built = [...this.completedBuildings.values()];
    return { seed: this.seed, map: this.match.ruleset.map.name, rulesVersion: this.match.ruleset.version,
      defaultRules: this.match.ruleset === rules || JSON.stringify({ ...this.match.ruleset, map: rules.map }) === JSON.stringify(rules),
      decisionEveryMs: this.decisionEveryTicks * 1000 / this.match.tickRate, gameTimeMs: this.match.tick * 1000 / this.match.tickRate,
      configuredMatchMs: this.match.maxTicks * 1000 / this.match.tickRate, outcome: this.match.outcome,
      players: this.players.map(p => ({ ...p, controller: typeof this.controllers.get(p.id) === "function" ? p.name : "autonomous" })),
      orderCount: this.orders.length, rejectedCount: this.rejected.length,
      rejectedReasons: Object.fromEntries([...new Set(this.rejected.map(r => r.result.ok ? "" : r.result.reason))].map(reason => [reason, this.rejected.filter(r => !r.result.ok && r.result.reason === reason).length])),
      completedBuildings: built.map(e => ({ owner: e.owner, kind: e.kind, id: e.id, x: e.x, y: e.y, completedAtMs: e.tick * 1000 / this.match.tickRate, damageDealt: this.damage.get(e.id) ?? 0 })),
      mineralUnloadedAtNewCastles: this.unloads.filter(e => e.builtDuringMatch).reduce((n, e) => n + e.amount, 0),
      expansionUnloads: this.unloads.filter(e => e.builtDuringMatch).slice(0, 20),
      doorPassages: this.crossings,
      researchCompleted: this.events.flatMap(({ timeMs, event }) => event.type === "upgrade_completed" ? [{ timeMs, ...event }] : []),
      chats: this.events.flatMap(({ timeMs, event }) => event.type === "chat" ? [{ timeMs, ...event }] : []),
      deaths: this.events.flatMap(({ timeMs, event }) => event.type === "death" ? [{ timeMs, ...event }] : []),
      scriptErrors: this.events.filter(({ event }) => event.type === "script_error"),
      traceKinds: Object.fromEntries([...new Set(this.traces.map(t => (t.event as { type?: string }).type ?? "unknown"))].map(type => [type, this.traces.filter(t => ((t.event as { type?: string }).type ?? "unknown") === type).length])),
    };
  }

  replay(id: string): ReplayFile {
    if (!this.match.outcome) throw new Error("Only a completed game can produce a complete replay");
    return { format: 1, id, createdAt: new Date().toISOString(), ruleset: this.match.ruleset, seed: this.seed, tickRate: this.match.tickRate,
      players: this.players, orders: this.orders, hashes: { ...this.hashes, [this.match.tick]: this.match.hash() },
      finalTick: this.match.tick, outcome: this.match.outcome, chat: true };
  }
}

export async function createExperiment(options: { ruleset?: Ruleset; players?: Participant[]; seed?: number; controllers?: Map<string, Controller>; decisionEveryTicks?: number } = {}) {
  const players = options.players ?? [{ id: "p1", name: "autonomous", side: 0, team: 0 }, { id: "p2", name: "idle", side: 1, team: 1 }];
  const seed = options.seed ?? 17;
  const match = await createMatch({ ruleset: options.ruleset ?? rules, players, seed, tickRate: 10 });
  return new Experiment(match, players, options.controllers ?? new Map(), seed, options.decisionEveryTicks);
}

export function attachPlayer(experiment: Experiment, id: string, options: ConstructorParameters<typeof AutonomousPlayer>[1] = {}) {
  const player = new AutonomousPlayer(experiment.match.ruleset, { ...options, log: event => { experiment.traces.push({ player: id, event: structuredClone(event) }); options?.log?.(event); } });
  experiment.controllers.set(id, player);
  return player;
}

/** A full independent match, never a shortened timeout masquerading as a complete default game. */
async function fullMatch(map: string, opponent: "rush" | "eco" | "team" | "ffa", autonomousSeat = 0, seed = 17) {
  const four = opponent === "team" || opponent === "ffa";
  const players: Participant[] = four
    ? Array.from({ length: 4 }, (_, side) => ({ id: `p${side + 1}`, name: "autonomous", side, team: opponent === "team" ? side % 2 : side }))
    : [{ id: "p1", name: autonomousSeat === 0 ? "autonomous" : opponent, side: 0, team: 0 }, { id: "p2", name: autonomousSeat === 1 ? "autonomous" : opponent, side: 1, team: 1 }];
  const experiment = await createExperiment({ ruleset: { ...rules, map: MAPS[map] }, players, seed });
  for (const player of players) {
    if (four || player.side === autonomousSeat) attachPlayer(experiment, player.id);
    else experiment.controllers.set(player.id, (opponent === "rush" ? rush : eco)(experiment.match.ruleset));
  }
  try {
    // Yield regularly so the validation process remains responsive.
    while (!experiment.match.outcome) {
      experiment.tick();
      if (experiment.match.tick % 100 === 0) await new Promise<void>(resolve => setImmediate(resolve));
    }
    for (const [id, controller] of experiment.controllers) if (typeof controller !== "function") controller.step(experiment.view(id));
    const id = `${map}-${opponent}-seat${autonomousSeat}-seed${seed}`;
    return { id, summary: experiment.summary(), replay: experiment.replay(id), traces: experiment.traces };
  } finally {
    for (const controller of experiment.controllers.values()) if (typeof controller !== "function") controller.close();
    experiment.match.dispose();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag: string) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  const out = resolve(value("--out") ?? "connectors/autonomous/evidence");
  const sources = await sourceFingerprints();
  await mkdir(out, { recursive: true });
  const cases: [string, "rush" | "eco" | "team" | "ffa", number, number][] = [];
  if (args.includes("--quick")) cases.push(["open", "rush", 0, 17]);
  else {
    for (const map of ["open", "fortress"]) for (const opponent of ["rush", "eco"] as const) for (const seat of [0, 1]) cases.push([map, opponent, seat, 17 + seat]);
    cases.push(["quad", "team", 0, 29], ["quad", "ffa", 0, 31]);
  }
  const results: ReturnType<Experiment["summary"]>[] = [];
  for (const parameters of cases) {
    const result = await fullMatch(...parameters);
    results.push(result.summary);
    await writeFile(resolve(out, `${result.id}.replay.json.gz`), gzipSync(JSON.stringify(result.replay)));
    await writeFile(resolve(out, `${result.id}.trace.jsonl.gz`), gzipSync(result.traces.map(event => JSON.stringify(event)).join("\n") + "\n"));
    await writeFile(resolve(out, "matches.json"), JSON.stringify({ generatedAt: new Date().toISOString(), sources, informationBoundary: "Only filtered PlayerView and public Ruleset enter controllers. Observer events are measured separately.", matches: results }, null, 2) + "\n");
    process.stdout.write(`${result.id}: ${JSON.stringify(result.summary.outcome)} at ${result.summary.gameTimeMs}ms; builds=${result.summary.completedBuildings.length}; expansionIncome=${result.summary.mineralUnloadedAtNewCastles}; rejected=${result.summary.rejectedCount}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
