import { describe, expect, it } from "vitest";
import { rules, playerGuide, viewToText, type Order, type ReplayFile, type Ruleset } from "@aoa/shared";
import { createMatch, runReplay, type Match, type PlayerOrder } from "../src";

const players = [{ id: "p1", name: "one" }, { id: "p2", name: "two" }];
function setupRules(): Ruleset {
  return { ...rules, startCapital: 2000, matchMs: 60_000,
    // The whole 16x16 map in sight: these tests are about research, not fog.
    kinds: Object.fromEntries(Object.entries(rules.kinds).map(([k, s]) => [k, { ...s, vision: 16 }])),
    defaultScripts: { knight: "self.hold();", ranger: "self.hold();", castle: "self.hold();", worker: "self.hold();" },
    map: { ...rules.map, width: 16, height: 16, walls: [], deposits: [], sharedDeposits: [], start: [
      { kind: "castle", x: 1, y: 1 }, { kind: "king", x: 0, y: 0 },
      { kind: "knight", x: 7, y: 7 }, { kind: "worker", x: 5, y: 5 }, { kind: "ranger", x: 3, y: 5 },
    ] },
  };
}
const make = (r = setupRules()) => createMatch({ ruleset: r, players, seed: 42, tickRate: 10 });
const stepTo = (m: Match, tick: number) => { while (m.tick < tick && !m.outcome) m.step([]); };
const unit = (m: Match, kind: string, player = "p1") => m.view(player).mine.find((u) => u.kind === kind)!;
const stats = (m: Match, player = "p1") => m.view(player).players.find((p) => p.id === player)!;
const buy = (m: Match, upgrade: string) => m.step([{ player: "p1", order: { type: "upgrade", upgrade } }]);

describe("research upgrades", () => {
  it("charges once, rejects concurrent/unknown research, and applies only at completion to this player's existing and future units", async () => {
    const m = await make();
    try {
      const initial = buy(m, "knight_damage");
      expect(initial.results[0]).toMatchObject({ ok: true, capital: { spent: 150, remaining: 1850 } });
      expect(stats(m).research).toEqual({ upgrade: "knight_damage", level: 1, completesAtMs: 10_000 });
      expect(buy(m, "knight_damage").results[0]).toMatchObject({ ok: false, capital: { spent: 0, remaining: 1850 } });
      expect(buy(m, "__proto__").results[0]).toMatchObject({ ok: false });
      expect(unit(m, "knight").stats?.atk).toBe(12);
      stepTo(m, 100);
      expect(unit(m, "knight").stats?.atk).toBe(12);
      const completion = m.step([]);
      expect(completion.events).toContainEqual({ tick: 100, type: "upgrade_completed", owner: "p1", upgrade: "knight_damage", level: 1 });
      expect(unit(m, "knight").stats?.atk).toBe(14);
      expect(unit(m, "knight", "p2").stats?.atk).toBe(12);
      expect(unit(m, "ranger").stats?.atk).toBe(12);
      expect(rules.kinds.knight.atk).toBe(12);
      expect(stats(m).research).toBeUndefined();
      m.step([{ player: "p1", order: { type: "train", building: unit(m, "castle").id, kind: "knight" } }]);
      stepTo(m, m.tick + rules.kinds.knight.trainMs! / 100 + 1);
      const knights = m.view("p1").mine.filter((e) => e.kind === "knight");
      expect(knights.map((k) => k.stats?.atk)).toEqual([14, 14]);
      const bought = m.tick;
      expect(buy(m, "knight_damage").results[0].capital?.spent).toBe(250);
      stepTo(m, bought + 151); m.step([]);
      expect(unit(m, "knight").stats?.atk).toBe(16);
      expect(buy(m, "knight_damage").results[0]).toMatchObject({ ok: false, reason: "knight_damage is already at maximum level", capital: { spent: 0 } });
    } finally { m.dispose(); }
  });

  it("rejects unaffordable research", async () => {
    for (const r of [{ ...setupRules(), startCapital: 149 }]) {
      const m = await make(r);
      try {
        expect(buy(m, "knight_damage").results[0]).toMatchObject({ ok: false, capital: { spent: 0, remaining: r.startCapital } });
        expect(stats(m).research).toBeUndefined();
      } finally { m.dispose(); }
    }
  });

  it("changes actual melee damage, attack cadence and movement, and exposes effective script stats", async () => {
    const m = await make();
    try {
      buy(m, "knight_damage"); stepTo(m, 101);
      buy(m, "knight_cadence"); stepTo(m, 202);
      buy(m, "knight_mobility"); stepTo(m, 353);
      const knight = unit(m, "knight"), enemy = unit(m, "knight", "p2");
      expect(knight.stats).toMatchObject({ atk: 14, attackMs: 900, moveMs: 300 });
      m.step([{ player: "p1", order: { type: "script", kind: "knight", code: 'self.log([self.atk,self.attackMs,self.moveMs].join(",")); self.hold();' } }]);
      expect(m.events("p1", 353)).toContainEqual(expect.objectContaining({ type: "log", message: "14,900,300" }));
      const first = m.step([{ player: "p1", order: { type: "attack", unit: knight.id, target: enemy.id } }]);
      expect(first.events).toContainEqual(expect.objectContaining({ type: "attack", from: knight.id, dmg: 14 - rules.kinds.knight.def }));
      const hitTick = first.events.find((e) => e.type === "attack")!.tick;
      for (let i = 0; i < 8; i++) expect(m.step([]).events.some((e) => e.type === "attack" && e.from === knight.id)).toBe(false);
      expect(m.step([]).events).toContainEqual(expect.objectContaining({ type: "attack", tick: hitTick + 9, from: knight.id }));
      m.step([{ player: "p1", order: { type: "move", unit: knight.id, x: 7, y: 2 } }]);
      expect(unit(m, "knight").y).toBe(6);
      m.step([]); m.step([]);
      expect(unit(m, "knight").y).toBe(6);
      m.step([]);
      expect(unit(m, "knight").y).toBe(5);
    } finally { m.dispose(); }
  });

  it("upgrades worker melee while preserving manual orders and hides research from the enemy", async () => {
    const m = await make();
    try {
      buy(m, "worker_damage");
      expect(viewToText(m.view("p1"))).toContain("researching worker_damage L1");
      stepTo(m, 101);
      const worker = unit(m, "worker");
      expect(worker.stats?.atk).toBe(5);
      const attack = m.step([{ player: "p1", order: { type: "attack", unit: worker.id, target: unit(m, "worker", "p2").id } }]);
      expect(attack.results[0].ok).toBe(true);
      let dealt = false;
      for (let i = 0; i < 50; i++) dealt ||= m.step([]).events.some((e) => e.type === "attack" && e.from === worker.id && e.dmg === 4);
      expect(dealt).toBe(true);
      expect(m.spectate().players[0].upgrades).toEqual({ worker_damage: 1 });
      expect(viewToText(m.view("p2"))).not.toContain("worker_damage"); // enemies never see research
      const guide = playerGuide(rules);
      expect(guide).toContain('"type":"upgrade"');
      expect(guide).toContain("worker_damage");
      expect(guide).toContain("400ms/tile");
      expect(guide).not.toContain("380ms/tile");
    } finally { m.dispose(); }
  });

  it("replays research deterministically, detects research-state differences, and resets it in a fresh game", async () => {
    const r = { ...setupRules(), matchMs: 20_000 };
    const m = await make(r);
    try {
      const orders: ReplayFile["orders"] = [];
      const hashes: Record<number, string> = {};
      while (!m.outcome) {
        const t = m.tick;
        const input: PlayerOrder[] = t === 0 ? [{ player: "p1", order: { type: "upgrade", upgrade: "knight_damage" } }] : [];
        orders.push(...input.map((o) => ({ tick: t, ...o })));
        m.step(input); hashes[t] = m.hash();
      }
      hashes[m.tick] = m.hash();
      const replay: ReplayFile = { format: 1, id: "research", createdAt: "", ruleset: r, seed: 42, tickRate: 10, players, orders, hashes, finalTick: m.tick, outcome: m.outcome! };
      expect((await runReplay(replay, () => {})).verified).toBe(true);
      const altered = { ...replay, orders: [{ ...orders[0], order: { type: "upgrade", upgrade: "ranger_damage" } as Order }] };
      expect((await runReplay(altered, () => {})).verified).toBe(false);
      const fresh = await make(r);
      expect(stats(fresh).upgrades).toEqual({});
      expect(unit(fresh, "knight").stats?.atk).toBe(12);
      fresh.dispose();
    } finally { m.dispose(); }
  });
});
