import { describe, expect, it } from "vitest";
import { rules, viewToText, type Order, type Ruleset, type ReplayFile } from "@aoa/shared";
import { createMatch, runReplay, type Match, type MatchConfig } from "../src";
const players = [{ id: "p1", name: "one" }, { id: "p2", name: "two" }];
const setupRules = (): Ruleset => ({ ...rules, startMineral: 2000,
  kinds: Object.fromEntries(Object.entries(rules.kinds).map(([id, spec]) => [id, { ...spec, vision: 2, atk: 0 }])),
  map: { ...rules.map, width: 20, height: 20, deposits: [], sharedDeposits: [],
    start: [{ kind: "king", x: 2, y: 2 }, { kind: "castle", x: 2, y: 3 }, { kind: "worker", x: 3, y: 3 }] },
});
const make = (r = setupRules(), ps: MatchConfig["players"] = players) => createMatch({ ruleset: r, players: ps, seed: 7, tickRate: 10 });
const own = (m: Match, player: string, kind: string) => m.view(player).mine.find((e) => e.kind === kind)!;
const next = (m: Match, player: string, orders: Order[]) => m.step(orders.map((order) => ({ player, order })));
const advance = (m: Match, n: number) => { for (let i = 0; i < n && !m.outcome; i++) m.step([]); };

describe("fog of war", () => {
  it("hides enemy entities, economy, unknown deposits and scripts' enemy-base shortcut", async () => {
    const r = setupRules(); r.map.sharedDeposits = [{ x: 10, y: 10, amount: 500 }];
    const m = await make(r);
    try {
      const v = m.view("p1");
      expect(v.enemy).toHaveLength(0); expect(v.deposits).toHaveLength(0);
      expect(v.grid[17][17]).toBe("?");
      // Named by id: display names (often the model) are for observers only.
      expect(v.players[1]).toEqual({ id: "p2", name: "p2", team: 1, alive: true, popCap: 30 });
      expect(m.spectate().players[1].name).toBe("two");
      expect(m.spectate().perspectives!.p1.players[1].name).toBe("two");
      expect(viewToText(v)).toContain("mineral hidden");
      const enemy = own(m, "p2", "king");
      expect(next(m, "p1", [{ type: "attack", unit: own(m, "p1", "worker").id, target: enemy.id }]).results[0].ok).toBe(false);
      expect(next(m, "p1", [{ type: "build", unit: own(m, "p1", "worker").id, kind: "wall", x: 15, y: 15 }]).results[0]).toMatchObject({ ok: false, reason: "build site must be visible" });
      next(m, "p1", [{ type: "script", kind: "castle", code: 'self.log(JSON.stringify({base:self.enemyBase(),enemies:self.nearbyEnemies()}));' }]);
      expect(m.spectate().entities).toHaveLength(6);
      expect(m.spectate().perspectives?.p1.entities).toHaveLength(3);
    } finally { m.dispose(); }
    const withScript = setupRules(); withScript.kinds.castle = { ...withScript.kinds.castle, atk: 1 };
    const m2 = await make(withScript);
    try {
      next(m2, "p1", [{ type: "script", kind: "castle", code: 'self.log(JSON.stringify({base:self.enemyBase(),enemies:self.nearbyEnemies()}));' }]);
      expect(m2.events("p1", 0)).toContainEqual(expect.objectContaining({ type: "log", message: '{"base":null,"enemies":[]}' }));
    } finally { m2.dispose(); }
  });

  it("reveals enemies while scouting, remembers explored terrain, and never reveals past hidden events", async () => {
    const m = await make();
    try {
      const nexus = own(m, "p2", "castle");
      next(m, "p2", [{ type: "train", building: nexus.id, kind: "worker" }, { type: "upgrade", upgrade: "worker_damage" }]);
      advance(m, 110);
      expect(m.events("p1", 0).filter((e) => "owner" in e && e.owner === "p2")).toHaveLength(0);
      const scout = own(m, "p1", "king");
      next(m, "p1", [{ type: "move", unit: scout.id, x: 15, y: 15 }]); advance(m, 100);
      expect(m.view("p1").enemy.some((e) => e.id === nexus.id)).toBe(true);
      expect(m.view("p1").visibility?.[16][17]).toBe("2");
      expect(m.events("p1", 0).some((e) => e.type === "spawn" || e.type === "research_started")).toBe(false);
      next(m, "p1", [{ type: "move", unit: scout.id, x: 2, y: 2 }]); advance(m, 100);
      expect(m.view("p1").enemy).toHaveLength(0);
      expect(m.view("p1").visibility?.[16][17]).toBe("1");
      // Explored terrain stays ":"; the enemy building there is drawn as last seen.
      expect(m.view("p1").grid[16][17]).toBe("c");
      expect(m.view("p1").lastSeen).toContainEqual(expect.objectContaining({ id: nexus.id, kind: "castle", owner: "p2" }));
      expect(m.view("p1").grid[16].split("").some((c, x) => x !== 17 && c === ":")).toBe(true);
    } finally { m.dispose(); }
  });

  it("shares allies' vision and keeps private chat independent of fog", async () => {
    const m = await make(setupRules(), [{ ...players[0], team: 0 }, { ...players[1], team: 0 }]);
    try {
      const remote = own(m, "p2", "king");
      expect(m.view("p1").visibility?.[remote.y][remote.x]).toBe("2");
      expect(m.view("p1").allies).toHaveLength(3);
      expect(m.view("p1").players[1].mineral).toBe(2000);
    } finally { m.dispose(); }
    const hostile = await make();
    try {
      next(hostile, "p1", [{ type: "chat", text: "hello", to: "p2", channel: "private" }]);
      expect(hostile.events("p2", 0)).toContainEqual(expect.objectContaining({ type: "chat", text: "hello" }));
      expect(hostile.spectate().perspectives?.p2.events.some((e) => e.type === "chat")).toBe(false);
      expect(hostile.spectate(undefined, { includePrivateChat: true }).perspectives?.p2.events.some((e) => e.type === "chat")).toBe(true);
    } finally { hostile.dispose(); }
  });

  it("preserves visibility and exploration when replayed, independent of how often state is requested", async () => {
    const r = { ...setupRules(), matchMs: 20_000 };
    const m = await make(r);
    try {
      const replay: ReplayFile = { format: 1, id: "fog", createdAt: "", ruleset: r, seed: 7, tickRate: 10, players,
        orders: [], hashes: {}, finalTick: 0, outcome: { winner: null, reason: "timeout", scores: {} } };
      const agent = own(m, "p1", "king").id;
      while (!m.outcome) {
        const tick = m.tick;
        const input = tick === 0 || tick === 100 ? [{ player: "p1", order: { type: "move", unit: agent, x: tick === 0 ? 15 : 2, y: tick === 0 ? 15 : 2 } as Order }] : [];
        replay.orders.push(...input.map((o) => ({ tick, ...o })));
        m.step(input); m.view("p1"); m.view("p2"); replay.hashes[tick] = m.hash();
      }
      replay.finalTick = m.tick; replay.outcome = m.outcome!;
      let last;
      expect((await runReplay(replay, (frame) => { last = frame; })).verified).toBe(true);
      expect(last).toEqual(m.spectate(undefined, { includePrivateChat: true }));
    } finally { m.dispose(); }
  });
});
