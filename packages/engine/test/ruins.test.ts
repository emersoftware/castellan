import { afterEach, describe, expect, it } from "vitest";
import { MAPS, v9, v10, viewToText, type Ruleset } from "@aoa/shared";
import { createMatch, type Match } from "../src";

const live: Match[] = [];
afterEach(() => { for (const m of live.splice(0)) m.dispose(); });
const start = async (ruleset: Ruleset, players: { id: string; name: string; side: number; team: number }[]) => {
  const m = await createMatch({ ruleset, players, seed: 1, tickRate: 10 });
  live.push(m);
  return m;
};
const teams = [
  { id: "p1", name: "a", side: 0, team: 0 }, { id: "p2", name: "b", side: 1, team: 0 },
  { id: "p3", name: "c", side: 2, team: 1 }, { id: "p4", name: "d", side: 3, team: 1 },
];
const advance = (m: Match, n: number) => { for (let i = 0; i < n; i++) m.step([]); };

describe("ruins", () => {
  it("keeps an eliminated player's buildings as inert ruins that give no vision", async () => {
    const m = await start({ ...v10, map: MAPS.quad }, teams);
    const castle = m.spectate().entities.find((e) => e.owner === "p3" && e.kind === "castle")!;
    const seesCastle = () => m.view("p4").visibility![castle.y][castle.x] === "2";
    expect(seesCastle()).toBe(true); // shared team vision
    m.forfeit("p3");
    expect(m.outcome).toBeNull();
    const left = m.spectate().entities.filter((e) => e.owner === "p3");
    expect(left.length).toBeGreaterThan(0);
    expect(left.every((e) => e.kind === "castle" || e.kind === "turret" || e.kind === "wall" || e.kind === "door")).toBe(true);
    const ruin = m.view("p4").allies.find((e) => e.id === castle.id)!;
    expect(ruin.ruin).toBe(true);
    expect(viewToText(m.view("p4"))).toContain(`${castle.id} castle (${castle.x},${castle.y}) hp ${castle.hp}/${castle.maxHp} · RUIN`);
    expect(seesCastle()).toBe(false);
    advance(m, 20);
    expect(m.spectate().entities.find((e) => e.id === castle.id)).toMatchObject({ hp: castle.hp });
  });

  it("still removes everything under older rules", async () => {
    const m = await start({ ...v9, map: MAPS.quad }, teams);
    m.forfeit("p3");
    expect(m.spectate().entities.filter((e) => e.owner === "p3")).toEqual([]);
  });
});

describe("fog memory", () => {
  it("remembers enemy buildings and deposits as last seen, on the map and in state", async () => {
    const ruleset: Ruleset = { ...v10, kinds: { ...v10.kinds, worker: { ...v10.kinds.worker, vision: 6, moveMs: 100 } },
      defaultScripts: { ...v10.defaultScripts, worker: "self.hold();" } };
    const m = await start(ruleset, [{ id: "p1", name: "a", side: 0, team: 0 }, { id: "p2", name: "b", side: 1, team: 1 }]);
    const enemyCastle = m.spectate().entities.find((e) => e.owner === "p2" && e.kind === "castle")!;
    const scout = m.view("p1").mine.find((e) => e.kind === "worker")!;
    expect(m.view("p1").lastSeen).toEqual([]);
    const to = (x: number, y: number) => { m.step([{ player: "p1", order: { type: "move", unit: scout.id, x, y } }]); advance(m, 60); };
    to(enemyCastle.x - 6, enemyCastle.y - 6);
    expect(m.view("p1").enemy.some((e) => e.id === enemyCastle.id)).toBe(true);
    to(10, 10);
    const v = m.view("p1");
    expect(v.enemy.some((e) => e.id === enemyCastle.id)).toBe(false);
    const memory = v.lastSeen!.find((l) => l.id === enemyCastle.id)!;
    expect(memory).toMatchObject({ kind: "castle", owner: "p2", x: enemyCastle.x, y: enemyCastle.y, hp: enemyCastle.hp });
    expect(memory.seenMs).toBeLessThan(v.timeMs);
    expect(v.lastSeen!.some((l) => l.kind === "deposit")).toBe(true);
    expect(v.grid[enemyCastle.y][enemyCastle.x]).toBe("c");
    const text = viewToText(v);
    expect(text).toContain("last seen (outside your vision now; may have changed):");
    expect(text).toMatch(new RegExp(`${enemyCastle.id} castle \\(${enemyCastle.x},${enemyCastle.y}\\) hp \\d+/\\d+ · owner p2 · seen [\\d.]+s ago`));
    // The enemy never saw p1's base: nothing remembered, and memory is per player.
    expect(m.view("p2").lastSeen!.some((l) => l.kind === "castle")).toBe(false);
  });
});
