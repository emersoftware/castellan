import { describe, expect, it } from "vitest";
import { MAPS, v0, type GameEvent, type ReplayFile, type Ruleset } from "@aoa/shared";
import { createMatch, runReplay } from "../src";

/** 2v2: p1 and p2 (team 0) against p3 and p4 (team 1), one per seat. */
const players = [
  { id: "p1", name: "a", side: 0, team: 0 },
  { id: "p2", name: "b", side: 1, team: 0 },
  { id: "p3", name: "c", side: 2, team: 1 },
  { id: "p4", name: "d", side: 3, team: 1 },
];
const quad: Ruleset = { ...v0, map: MAPS.quad };

/** A 16×16 4-seat arena where the four Agents start next to each other, each with a knight. */
const arena: Ruleset = {
  ...v0,
  kinds: { ...v0.kinds, agent: { ...v0.kinds.agent, hp: 30 } },
  map: {
    name: "arena", description: "", width: 16, height: 16, seats: 4, walls: [],
    start: [{ kind: "nexus", x: 1, y: 1 }, { kind: "agent", x: 7, y: 7 }, { kind: "knight", x: 5, y: 5 }],
    deposits: [], sharedDeposits: [],
  },
};

describe("2v2", () => {
  it("supports four independent sides and waits for a single FFA survivor", async () => {
    const m = await createMatch({ ruleset: quad, players: players.map((p, team) => ({ ...p, team })), seed: 1, tickRate: 10 });
    try {
      for (const p of players) {
        expect(m.view(p.id).allies).toEqual([]);
        expect(new Set(m.view(p.id).enemy.map((e) => e.owner)).size).toBe(3);
      }
      m.forfeit("p1");
      expect(m.outcome).toBeNull();
      m.forfeit("p2");
      expect(m.outcome).toBeNull();
      m.forfeit("p3");
      expect(m.outcome).toMatchObject({ winner: "p4", winners: ["p4"] });
    } finally {
      m.dispose();
    }
  });

  it("puts each seat in its own corner, rotated", async () => {
    const m = await createMatch({ ruleset: quad, players, seed: 1, tickRate: 10 });
    const nexus = (p: string) => m.view(p).mine.find((e) => e.kind === "nexus")!;
    expect([nexus("p1").x, nexus("p1").y]).toEqual([4, 4]);
    expect([nexus("p2").x, nexus("p2").y]).toEqual([59, 59]);
    expect([nexus("p3").x, nexus("p3").y]).toEqual([59, 4]);
    expect([nexus("p4").x, nexus("p4").y]).toEqual([4, 59]);
    const v = m.view("p1");
    expect(v.allies.every((e) => e.owner === "p2")).toBe(true);
    expect(v.enemy.every((e) => e.owner === "p3" || e.owner === "p4")).toBe(true);
    expect(v.grid[59][59]).toBe("=");
    expect(v.grid[4][59]).toBe("n");
    m.dispose();
  });

  it("refuses orders against allies", async () => {
    const m = await createMatch({ ruleset: quad, players, seed: 1, tickRate: 10 });
    const worker = m.view("p1").mine.find((e) => e.kind === "worker")!;
    const allyNexus = m.view("p1").allies.find((e) => e.kind === "nexus")!;
    const r = m.step([{ player: "p1", order: { type: "attack", unit: worker.id, target: allyNexus.id } }]);
    expect(r.results[0]).toMatchObject({ ok: false });
    m.dispose();
  });

  it("is fair to every seat: the same play from all four corners ends level", async () => {
    const m = await createMatch({ ruleset: arena, players, seed: 3, tickRate: 10 });
    while (!m.outcome && m.tick < 3000) m.step([]);
    const deaths = m.spectate(0).events.filter((e) => e.type === "death");
    expect(deaths.map((e) => e.kind)).toEqual(["agent", "agent", "agent", "agent"]);
    expect(m.outcome!.winners).toEqual([]);
    m.dispose();
  });

  it("allies never hurt each other; a fallen player drops out and the last team wins", async () => {
    const m = await createMatch({ ruleset: arena, players, seed: 3, tickRate: 10 });
    const team = new Map(players.map((p) => [p.id, p.team]));
    const owner = new Map<string, string>();
    const events: GameEvent[] = [];
    // Team 0 focuses one enemy Agent: the symmetry breaks and p3 falls first.
    const knight = (p: string) => m.view(p).mine.find((e) => e.kind === "knight")!.id;
    const p3Agent = m.view("p3").mine.find((e) => e.kind === "agent")!.id;
    m.step([
      { player: "p1", order: { type: "attack", unit: knight("p1"), target: p3Agent } },
      { player: "p2", order: { type: "attack", unit: knight("p2"), target: p3Agent } },
    ]);
    while (!m.outcome && m.tick < 3000) {
      for (const e of m.spectate().entities) owner.set(e.id, e.owner);
      events.push(...m.step([]).events);
      for (const e of events.filter((x) => x.type === "eliminated")) {
        expect(m.spectate().entities.some((x) => x.owner === (e as { owner: string }).owner)).toBe(false);
      }
    }
    for (const e of events) if (e.type === "attack") expect(team.get(owner.get(e.from)!)).not.toBe(team.get(owner.get(e.to)!));
    expect(events.some((e) => e.type === "eliminated")).toBe(true);
    const o = m.outcome!;
    expect(o.reason).toBe("vital_lost");
    expect(o.winners).toHaveLength(2);
    expect(new Set(o.winners!.map((w) => team.get(w))).size).toBe(1);
    expect(o.winner).toBeNull();
    m.dispose();
  });

  it("replays re-simulate with teams", async () => {
    const m = await createMatch({ ruleset: arena, players, seed: 3, tickRate: 10 });
    const hashes: Record<number, string> = {};
    while (!m.outcome && m.tick < 3000) {
      const t = m.tick;
      m.step([]);
      if (t % 100 === 0) hashes[t] = m.hash();
    }
    hashes[m.tick] = m.hash();
    const replay: ReplayFile = {
      format: 1, id: "t", createdAt: "", ruleset: arena, seed: 3, tickRate: 10, players, orders: [], hashes, finalTick: m.tick, outcome: m.outcome!,
    };
    m.dispose();
    expect(await runReplay(replay, () => {})).toEqual({ verified: true, desyncAt: undefined });
  });
});
