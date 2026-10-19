import { describe, expect, it } from "vitest";
import { MAPS } from "@castellan/shared";
import { Frame, dist } from "../src/geometry";

describe("geometry", () => {
  it("rounds distances like the rules (a diagonal neighbour is at distance 1)", () => {
    expect(dist({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(1);
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(dist({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(3);
  });

  it("finds every seat from its corner and maps it back and forth", () => {
    for (const map of [MAPS.open, MAPS.quad]) {
      new Frame(map).bases().forEach((base, seat) => {
        const f = new Frame(map, base);
        expect(f.seat).toBe(seat);
        expect(f.toLocal(base)).toEqual({ x: 4, y: 4 });
        expect(f.toMap({ x: 4, y: 4 })).toEqual(base);
        // The king starts next to the castle: off the exact corner, the nearest seat wins.
        expect(new Frame(map, { x: base.x + 1, y: base.y }).seat).toBe(seat);
      });
    }
    expect(new Frame(MAPS.open).bases()).toEqual([{ x: 4, y: 4 }, { x: 27, y: 27 }]);
    expect(new Frame(MAPS.quad).bases()).toHaveLength(4);
  });

  it("labels deposit clusters from the seat's point of view", () => {
    const f = new Frame(MAPS.open, { x: 27, y: 27 });
    const clusters = f.clusters();
    const kinds = clusters.reduce((m: Record<string, number>, c) => ((m[c.kind] = (m[c.kind] ?? 0) + 1), m), {});
    expect(kinds.home).toBeGreaterThanOrEqual(2);
    expect(kinds.flank).toBe(2);
    expect(kinds.center).toBe(1);
    expect(kinds.foreign).toBeGreaterThanOrEqual(3);
    const total = clusters.reduce((n, c) => n + c.mineral, 0);
    expect(total).toBe(9600);
    const home = clusters.filter((c) => c.kind === "home");
    for (const c of home) for (const t of c.tiles) expect(dist(f.toLocal(t), { x: 4, y: 4 })).toBeLessThanOrEqual(8);
  });
});
