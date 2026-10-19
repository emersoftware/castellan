/**
 * Headless matches for tests and benchmarks: the engine runs as fast as it can,
 * the player decides every N ticks from its own PlayerView (what the API would
 * return), and a tiny room layer adds chat the way the server does.
 */
import { createMatch, type PlayerOrder } from "@castellan/engine";
import { BOTS, type Bot } from "@castellan/sim";
import { MAPS, rules as baseRules, type ChatMessage, type GameEvent, type Order, type Outcome, type PlayerView, type RoomMode, type Ruleset } from "@castellan/shared";
import { CastellanBot } from "../src/core";
import type { JournalEntry } from "../src/types";

export interface Seat {
  kind: "castellan" | "bot";
  bot?: string;
  team?: number;
}

export interface HeadlessOptions {
  seats: Seat[];
  map?: string;
  seed?: number;
  maxTicks?: number;
  everyTicks?: number;
  botEveryTicks?: number;
  chat?: boolean;
  mode?: RoomMode;
  ruleset?: Ruleset;
  onEntry?: (player: string, e: JournalEntry) => void;
}

export interface HeadlessResult {
  outcome: Outcome;
  ticks: number;
  players: Record<string, { core?: CastellanBot; entries: JournalEntry[]; rejected: number; orders: number; chat: ChatMessage[] }>;
  events: GameEvent[];
}

export async function playHeadless(o: HeadlessOptions): Promise<HeadlessResult> {
  const ruleset: Ruleset = o.ruleset ?? { ...baseRules, map: MAPS[o.map ?? "open"] };
  const n = o.seats.length;
  const players = o.seats.map((s, i) => ({ id: `p${i + 1}`, name: s.kind === "bot" ? `bot:${s.bot}` : "castellan", side: n === 4 ? i : i % 2,
    team: o.mode === "ffa" ? i : s.team ?? (n === 4 ? (i < 2 ? 0 : 1) : i) }));
  const m = await createMatch({ ruleset, seed: o.seed ?? 1, tickRate: 10, players });
  const every = o.everyTicks ?? 10, botEvery = o.botEveryTicks ?? 30;
  const result: HeadlessResult = { outcome: { winner: null, winners: [], reason: "timeout", scores: {} }, ticks: 0, players: {}, events: [] };
  const cores = new Map<string, CastellanBot>();
  const bots = new Map<string, Bot>();
  const chatLog: ChatMessage[] = [];
  for (const p of players) {
    const seat = o.seats[players.indexOf(p)];
    result.players[p.id] = { entries: [], rejected: 0, orders: 0, chat: [] };
    if (seat.kind === "bot") bots.set(p.id, BOTS[seat.bot ?? "eco"](ruleset));
    else {
      const core = new CastellanBot({ rules: ruleset, log: (e) => { result.players[p.id].entries.push(e); o.onEntry?.(p.id, e); } });
      cores.set(p.id, core);
      result.players[p.id].core = core;
    }
  }
  const visibleChat = (pid: string) => chatLog.filter((c) => c.channel === "private" ? c.from === pid || c.to === pid : c.channel !== "team" || players.find((x) => x.id === c.from)!.team === players.find((x) => x.id === pid)!.team);
  const lastSeen = new Map<string, number>();
  try {
    while (!m.outcome && m.tick < (o.maxTicks ?? 6000)) {
      const input: PlayerOrder[] = [];
      const sentBy = new Map<string, Order[]>();
      for (const p of players) {
        const core = cores.get(p.id);
        if (core && m.tick % every === 0) {
          const view = m.view(p.id, lastSeen.get(p.id) ?? 0);
          lastSeen.set(p.id, view.tick);
          if (o.chat) view.chat = { enabled: true, messages: visibleChat(p.id).slice(-5) };
          const orders = core.step(view);
          sentBy.set(p.id, orders);
          for (const order of orders) input.push({ player: p.id, order });
          result.players[p.id].orders += orders.length;
        }
        const bot = bots.get(p.id);
        if (bot && m.tick % botEvery === (players.indexOf(p) * 7) % botEvery) for (const order of bot(m.view(p.id, m.tick))) input.push({ player: p.id, order });
      }
      if (m.tick % 300 === 0) for (const [pid, core] of cores) { const w = core.world; if (w) o.onEntry?.(pid, { t: 0, tick: m.tick, type: "status", mineral: w.mineral, workers: w.workers.length, army: w.army.map((u) => u.kind[0]).join(""), enemyVisible: w.enemyVisible.length, posture: core.plan.posture, strength: Math.round(w.myStrength), enemyKnown: Math.round(w.enemyKnownStrength) }); }
      const step = m.step(input);
      result.events.push(...step.events.filter((e) => e.type !== "attack" && e.type !== "projectile_end" && e.type !== "unload"));
      for (const e of step.events) if (e.type === "death" && (cores.has(e.owner) || cores.size)) o.onEntry?.(e.owner, { t: 0, tick: e.tick, type: "death", kind: e.kind, id: e.id, x: e.x, y: e.y, by: e.by });
      for (const e of step.events) if (e.type === "chat") chatLog.push({ tick: e.tick, from: e.owner, name: e.owner, text: e.text, ...(e.channel ? { channel: e.channel } : {}), ...(e.to ? { to: e.to } : {}) });
      for (const [pid, orders] of sentBy) {
        const core = cores.get(pid)!;
        const results = input.map((po, i) => [po, step.results[i]] as const).filter(([po]) => po.player === pid).map(([, r]) => r);
        core.report(orders, results);
        result.players[pid].rejected += results.filter((r) => !r.ok).length;
      }
    }
    result.outcome = m.outcome ?? { winner: null, winners: [], reason: "timeout", scores: {} };
    result.ticks = m.tick;
    for (const p of players) { result.players[p.id].chat = visibleChat(p.id); const core = cores.get(p.id); if (core) core.step(Object.assign(m.view(p.id, lastSeen.get(p.id) ?? 0), o.chat ? { chat: { enabled: true, messages: visibleChat(p.id).slice(-5) } } : {})); }
    return result;
  } finally {
    m.dispose();
  }
}

export const countKind = (core: CastellanBot, kind: string) => core.world?.mine.filter((e) => e.kind === kind).length ?? 0;
