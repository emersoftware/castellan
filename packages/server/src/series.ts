import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createMatch } from "@castellan/engine";
import type { GameEvent, HistorySection, ReplayFile, SeriesProgress, SeriesReplay, SeriesSummary } from "@castellan/shared";
import { playerResult } from "@castellan/shared";
import { Room, type RoomCheckpoint, type RoomOptions } from "./room";

type Config = Omit<RoomOptions, "onFinish" | "deferredStart">;
interface StoredSeries {
  format: 1;
  id: string;
  createdAt: string;
  config: Config;
  participants: { id: string; name: string; token: string; team: number; bot?: string }[];
  games: RoomCheckpoint[];
}
interface Entry extends Omit<StoredSeries, "games"> {
  games: Room[];
  pending: Promise<void>;
  error?: string;
  readyGames: number;
  committedGames: number;
}

/** Series own progression and durable memory. The game engine remains unaware of series. */
export class SeriesStore {
  private entries = new Map<string, Entry>();
  private memberships = new Map<string, { entry: Entry; gameNumber: number }>();
  private invites = new Map<string, { entry: Entry; player: string }>();
  private historyCache = new Map<string, Promise<Record<string, unknown[]>>>();
  private timer?: NodeJS.Timeout;
  private closing = false;

  constructor(private dir: string, private register: (room: Room) => void, private saveReplay: (replay: ReplayFile) => Promise<void>) {}

  async load() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    for (const file of await readdir(this.dir)) {
      if (!/^[a-f0-9]+\.json$/.test(file)) continue;
      const saved = JSON.parse(await readFile(join(this.dir, file), "utf8")) as StoredSeries;
      if (saved.format !== 1) throw new Error(`unsupported series format: ${file}`);
      const entry: Entry = { ...saved, games: [], pending: Promise.resolve(), readyGames: saved.games.length, committedGames: 0 };
      this.entries.set(entry.id, entry);
      for (const checkpoint of saved.games) {
        const room = await Room.restore(checkpoint, () => this.schedule(entry, () => this.advance(entry)));
        this.attach(entry, room);
      }
      this.registerInvites(entry);
      entry.committedGames = entry.games.filter((r) => r.state === "finished").length;
      // Repairs a crash between durable game completion and creating the next game.
      await this.advance(entry);
      entry.games.at(-1)?.activate();
    }
    this.timer = setInterval(() => {
      for (const entry of this.entries.values()) {
        if (entry.games.at(-1)?.state !== "finished") this.schedule(entry, () => this.persist(entry));
      }
    }, 1000);
    this.timer.unref();
  }

  async create(config: Config) {
    config = { ...config, spectatorToken: randomBytes(24).toString("hex") };
    const entry: Entry = { format: 1, id: randomBytes(8).toString("hex"), createdAt: new Date().toISOString(), config,
      participants: [], games: [], pending: Promise.resolve(), readyGames: 0, committedGames: 0 };
    this.entries.set(entry.id, entry);
    try {
      entry.pending = this.next(entry);
      await entry.pending;
      return { ...this.summary(entry.id)!, players: entry.participants.map((p) => ({ ...p, token: p.bot ? undefined : p.token })), watch: `/series/${entry.id}/watch#spectator=${config.spectatorToken}`, replay: `/series/${entry.id}/replay` };
    } catch (error) { this.entries.delete(entry.id); for (const room of entry.games) room.close(); throw error; }
  }

  private attach(entry: Entry, room: Room) {
    entry.games.push(room);
    const gameNumber = entry.games.length;
    this.memberships.set(room.id, { entry, gameNumber });
    room.seriesProgress = () => this.progress(room.id)!;
    this.register(room);
  }

  private registerInvites(entry: Entry) {
    for (const p of entry.participants) if (!p.bot) this.invites.set(p.token, { entry, player: p.id });
  }

  private async next(entry: Entry) {
    const room = await Room.create({ ...entry.config, seed: entry.config.seed + entry.games.length, deferredStart: true,
      onFinish: () => this.schedule(entry, () => this.advance(entry)) });
    if (!entry.participants.length) {
      entry.participants = room.players.map(({ id, name, team, bot }) => ({ id, name, team, bot: bot?.name, token: randomBytes(24).toString("hex") }));
    }
    this.attach(entry, room);
    await this.persist(entry);
    entry.readyGames = entry.games.length;
    this.registerInvites(entry);
    if (!this.closing) room.activate();
  }

  private async advance(entry: Entry) {
    const room = entry.games.at(-1);
    if (!room || room.state !== "finished") return;
    await this.saveReplay(room.replay()!);
    await this.persist(entry);
    entry.committedGames = entry.games.length;
    if (!this.closing && entry.games.length < 3) await this.next(entry);
  }

  private schedule(entry: Entry, work: () => Promise<void>) {
    if (this.closing) return;
    entry.pending = entry.pending.then(work).catch((error) => {
      entry.error = String(error);
      entry.games.at(-1)?.suspend();
      console.error(`Series ${entry.id} persistence failed:`, error);
    });
  }

  private async persist(entry: Entry) {
    const snapshot: StoredSeries = { format: 1, id: entry.id, createdAt: entry.createdAt, config: entry.config,
      participants: entry.participants, games: entry.games.map((room) => room.checkpoint()) };
    const path = join(this.dir, `${entry.id}.json`);
    await writeFile(`${path}.tmp`, JSON.stringify(snapshot), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }

  progress(roomId: string): SeriesProgress | undefined {
    const m = this.memberships.get(roomId);
    if (!m) return;
    const s = this.summary(m.entry.id)!;
    return { id: s.id, gameNumber: m.gameNumber, totalGames: 3, status: s.status, score: s.score, losses: s.losses,
      previousGames: s.games.filter((g) => g.number < m.gameNumber && g.status === "finished").map((g) => g.number) };
  }

  summary(id: string): SeriesSummary | undefined {
    const entry = this.entries.get(id);
    if (!entry) return;
    const score = Object.fromEntries(entry.participants.map((p) => [p.id, 0]));
    const losses = Object.fromEntries(entry.participants.map((p) => [p.id, 0]));
    const games = entry.games.map((room, i) => {
      const outcome = room.outcome ?? undefined;
      for (const p of outcome?.winners ?? (outcome?.winner ? [outcome.winner] : [])) score[p]++;
      if (outcome) for (const p of entry.participants) if (playerResult(outcome, p.id) === "loss") losses[p.id]++;
      return { number: i + 1, roomId: room.id, status: room.state, outcome };
    });
    const finished = entry.committedGames === 3 && games.length === 3 && games.every((g) => g.status === "finished");
    const max = Math.max(0, ...Object.values(score));
    const leaders = entry.participants.filter((p) => score[p.id] === max);
    // Teammates win together; tied opposing sides have no series winner.
    const winners = !finished ? undefined : new Set(leaders.map((p) => p.team)).size === 1 ? leaders.map((p) => p.id) : [];
    return { id, createdAt: entry.createdAt, totalGames: 3, currentGame: games.length,
      status: entry.error ? "error" : finished ? "finished" : "running", score, losses, winners,
      ...(finished && !winners?.length && entry.config.ruleset.drawsAreLosses ? { allDefeated: true as const } : {}),
      players: entry.participants.map(({ token: _, ...p }) => p), games };
  }

  list() { return [...this.entries.keys()].map((id) => this.summary(id)!).reverse(); }

  current(token: string) {
    const member = this.invites.get(token);
    if (!member) return;
    const { entry, player } = member;
    const summary = this.summary(entry.id)!;
    const room = entry.games[entry.readyGames - 1];
    if (!room) return;
    // Series tokens are handed to player harnesses: name players by id, as in their game views.
    return { series: { ...summary, players: summary.players.map((p) => ({ ...p, name: p.id })) }, player, game: { id: room.id, number: entry.readyGames,
      token: room.players.find((p) => p.id === player)!.token, status: room.state } };
  }

  replay(id: string): SeriesReplay | undefined {
    const summary = this.summary(id);
    if (!summary || summary.status !== "finished") return;
    return { format: "aoa-series-v1", series: summary, games: this.entries.get(id)!.games.map((r) => r.replay()!) };
  }

  async history(roomId: string, player: string, game: number | undefined, section: HistorySection, offset: number, limit: number) {
    const membership = this.memberships.get(roomId);
    if (!membership) return { series: null, games: [] };
    const progress = this.progress(roomId)!;
    const available = membership.entry.games.filter((r, i) => i + 1 < membership.gameNumber && r.state === "finished");
    if (game === undefined) return { series: progress, games: available.map((r, i) => ({ game: i + 1, roomId: r.id, outcome: r.summary().outcome, durationMs: r.summary().timeMs })) };
    if (!progress.previousGames.includes(game)) throw new Error("only completed previous games in your series are available");
    const replay = available[game - 1].replay()!;
    if (section === "summary") return { game, roomId: replay.id, outcome: replay.outcome, durationMs: replay.finalTick * 1000 / replay.tickRate,
      players: replay.players.map(({ id, side, team }) => ({ id, side, team })), ordersSent: replay.orders.filter((o) => o.player === player).length };
    const key = `${replay.id}:${player}`;
    let cached = this.historyCache.get(key);
    if (!cached) {
      cached = this.buildHistory(replay, player);
      this.historyCache.set(key, cached);
      cached.catch(() => this.historyCache.delete(key));
    }
    const items = (await cached)[section];
    return { game, section, items: items.slice(offset, offset + limit), total: items.length,
      next: offset + limit < items.length ? offset + limit : null };
  }

  private async buildHistory(replay: ReplayFile, player: string): Promise<Record<string, unknown[]>> {
    const match = await createMatch({ ruleset: replay.ruleset, seed: replay.seed, tickRate: replay.tickRate, players: replay.players });
    const events: GameEvent[] = [], chat: GameEvent[] = [], orders: unknown[] = [];
    const byTick = new Map<number, ReplayFile["orders"]>();
    for (const o of replay.orders) { const list = byTick.get(o.tick) ?? []; list.push(o); byTick.set(o.tick, list); }
    try {
      while (match.tick < replay.finalTick && !match.outcome) {
        const tick = match.tick, input = byTick.get(tick) ?? [];
        const step = match.step(input);
        input.forEach((o, i) => { if (o.player === player) orders.push({ tick, order: o.order, result: step.results[i] }); });
        // The engine's player visibility policy filters private/team chat and private logs.
        for (const event of match.events(player, tick)) {
          if (event.type === "chat") chat.push(event);
          else events.push(event);
        }
      }
      const scripts = Object.keys(replay.ruleset.defaultScripts).flatMap((kind) => {
        const script = match.scriptSource(player, kind);
        return script ? [{ kind, ...script }] : [];
      });
      return { events, chat, orders, scripts };
    } finally { match.dispose(); }
  }

  async close() {
    this.closing = true;
    clearInterval(this.timer);
    for (const entry of this.entries.values()) for (const room of entry.games) room.suspend();
    for (const entry of this.entries.values()) {
      await entry.pending;
      for (const room of entry.games) room.suspend();
      await this.persist(entry);
    }
  }
}
