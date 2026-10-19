import { describe, expect, it } from "vitest";
import { MAPS, rules, type Ruleset } from "@castellan/shared";
import { playHeadless } from "./harness";

// These are strategy regression fixtures with a known outcome, not a constraint
// that every future balance must make Castellan Bot beat the same reference bots.
// Pin combat and movement: newer rules intentionally change match trajectories.
const strategyFixture: Ruleset = { ...rules, coordinatedMovement: false, tickPathCosts: false,
  kinds: { ...rules.kinds,
    castle: { ...rules.kinds.castle, cost: 600, buildMs: 30000, range: 6 },
    knight: { ...rules.kinds.knight, moveMs: 500 },
    archer: { ...rules.kinds.archer, trainMs: 10000 },
    tower: { ...rules.kinds.tower, cost: 200 },
    wall: { ...rules.kinds.wall, cost: 50 },
    door: { ...rules.kinds.door, cost: 75 },
  },
  upgrades: { ...rules.upgrades,
    knight_mobility: { ...rules.upgrades.knight_mobility, levels: [{ cost: 150, researchMs: 15000, value: 400 }] },
  },
  map: { ...MAPS.open, deposits: MAPS.open.deposits.map(d => ({ ...d, amount: d.x < 13 && d.y < 13 ? 250 : 500 })) },
};

describe("castellan core (headless matches with fixed economy and combat)", () => {
  it("beats the rush bot on the open map, building a tower and losing few workers", async () => {
    const r = await playHeadless({ seats: [{ kind: "castellan" }, { kind: "bot", bot: "rush" }], ruleset: strategyFixture, seed: 100 });
    const core = r.players.p1.core!;
    expect(r.outcome.winners).toContain("p1");
    expect(core.stats.scriptErrors).toBe(0);
    expect(r.players.p1.rejected).toBeLessThan(10);
    expect(core.stats.losses.worker ?? 0).toBeLessThanOrEqual(3);
  }, 120_000);

  it("holds against the eco bot: keep around the king, expansion planned, no loss", async () => {
    const r = await playHeadless({ seats: [{ kind: "bot", bot: "eco" }, { kind: "castellan" }], ruleset: strategyFixture, seed: 101 });
    const core = r.players.p2.core!;
    expect(r.outcome.winner).not.toBe("p1");
    expect(core.plan.keep.status).not.toBe("none");
    expect(core.episodes.some((e) => e.kind === "keep")).toBe(true);
  }, 180_000);
});
