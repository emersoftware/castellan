import { describe, expect, it } from "vitest";
import { MAPS } from "@aoa/shared";
import { Frame, depositClusters, detectSeat, dist, seatBases, seatToMap, mapToSeat } from "../src/geometry";

describe("geometry", () => {
  it("rounds distances like the rules (a diagonal neighbour is at distance 1)", () => {
    expect(dist(0, 0, 1, 1)).toBe(1);
    expect(dist(0, 0, 3, 4)).toBe(5);
    expect(dist(0, 0, 2, 2)).toBe(3);
  });

  it("maps every seat's corner back and forth", () => {
    for (const map of [MAPS.open, MAPS.quad]) {
      const seats = map.seats ?? 2;
      for (let seat = 0; seat < seats; seat++) {
        const p = seatToMap(4, 4, seat, map.width, map.height);
        const back = mapToSeat(p.x, p.y, seat, map.width, map.height);
        expect(back).toEqual({ x: 4, y: 4 });
        expect(detectSeat(map, p)).toBe(seat);
      }
    }
    expect(seatBases(MAPS.open)).toEqual([{ x: 4, y: 4 }, { x: 27, y: 27 }]);
    expect(seatBases(MAPS.quad)).toHaveLength(4);
  });

  it("labels deposit clusters from the seat's point of view", () => {
    const clusters = depositClusters(MAPS.open, 1);
    const kinds = clusters.reduce((m: Record<string, number>, c) => ((m[c.kind] = (m[c.kind] ?? 0) + 1), m), {});
    expect(kinds.home).toBeGreaterThanOrEqual(2);
    expect(kinds.flank).toBe(2);
    expect(kinds.center).toBe(1);
    expect(kinds.foreign).toBeGreaterThanOrEqual(3);
    const total = clusters.reduce((n, c) => n + c.mineral, 0);
    expect(total).toBe(9600);
    const f = new Frame(1, 32, 32);
    const home = clusters.filter((c) => c.kind === "home");
    for (const c of home) for (const t of c.tiles) { const l = f.toLocal(t); expect(dist(l.x, l.y, 4, 4)).toBeLessThanOrEqual(8); }
  });
});
