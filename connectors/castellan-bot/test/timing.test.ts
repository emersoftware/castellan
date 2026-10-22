import { afterEach, expect, it } from "vitest";
import { createMatch, type Match } from "@castellan/engine";
import { MAPS, rules } from "@castellan/shared";
import { newMemory, perceive } from "../src/perception";
import { playHeadless } from "./harness";

const matches: Match[] = [];
afterEach(() => matches.splice(0).forEach((m) => m.dispose()));

it("remembers an enemy building at the tick it was last seen", async () => {
  const m = await createMatch({ ruleset: rules, seed: 1, tickRate: 20, players: [{ id: "p1", name: "a" }, { id: "p2", name: "b" }] });
  matches.push(m);
  for (let i = 0; i < 40; i++) m.step([]);
  const view = m.view("p1");
  view.lastSeen = [{ id: "c9", kind: "castle", owner: "p2", x: 20, y: 20, hp: 600, maxHp: 600, seenMs: 1000 }];
  const mem = newMemory();
  perceive(view, rules, mem);
  expect(mem.enemyBuildings.get("c9")?.tick).toBe(20);
});

it("paces its chat by game time at any tick rate, leaving the server's 3 s between messages", async () => {
  const r = await playHeadless({ seats: [{ kind: "castellan" }, { kind: "castellan" }, { kind: "castellan" }], mode: "ffa", chat: true,
    ruleset: { ...rules, map: MAPS.quad }, tickRate: 20, maxTicks: 400 });
  const sent = r.players.p1.entries.filter((e) => e.type === "chat_sent").map((e) => e.tick);
  expect(sent.length).toBeGreaterThan(1);
  const gapsMs = sent.slice(1).map((tick, i) => (tick - sent[i]) * 50);
  expect(Math.min(...gapsMs)).toBeGreaterThanOrEqual(3000);
}, 60_000);
