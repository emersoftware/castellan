import { afterEach, expect, it, vi } from "vitest";
import { rules, type GameEvent, type Order, type PlayerView, type Ruleset } from "@castellan/shared";
import { createMatch, resimulate, type Match, type MatchConfig, type PlayerOrder } from "@castellan/engine";
import { Room } from "../src/room";
import { createIsolatedScriptHost } from "../src/script-isolation";

// Each side starts with two Wizards beside the other's knight; research and channels are short so a live room hacks within
// seconds, and every built-in script holds.
const ruleset: Ruleset = {
  ...rules,
  map: { ...rules.map, width: 12, height: 12, sharedDeposits: [], deposits: [], neutralWalls: [], walls: [],
    start: [{ kind: "king", x: 0, y: 0 }, { kind: "wizard", x: 4, y: 5 }, { kind: "wizard", x: 4, y: 3 }, { kind: "knight", x: 6, y: 5 }] },
  upgrades: { ...rules.upgrades, intrusion: { ...rules.upgrades.intrusion, levels: rules.upgrades.intrusion.levels.map((level) => ({ ...level, researchMs: 500 })) } },
  kinds: { ...rules.kinds, wizard: { ...rules.kinds.wizard, intrusion: { ...rules.kinds.wizard.intrusion!, unitChannel: { minMs: 500, maxMs: 1500 } } } },
  startMineral: 2000,
  defaultScripts: Object.fromEntries(Object.keys(rules.defaultScripts).map((kind) => [kind, "self.hold();"])),
};

const live: Match[] = [];
afterEach(() => { for (const m of live.splice(0)) m.dispose(); });

it("runs a hack's payload, its memory and a conversion identically in isolated script workers, and restores them from the recorded orders", async () => {
  const config: MatchConfig = { ruleset, players: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }], seed: 11, tickRate: 10 };
  const inline = await createMatch(config);
  live.push(inline);
  const isolated = await createMatch({ ...config, scriptHostFactory: createIsolatedScriptHost });
  live.push(isolated);
  const at = (owner: string, x: number, y: number) => inline.spectate().entities.find((e) => e.owner === owner && e.x === x && e.y === y)!.id;
  const [caster, converter, target] = [at("p1", 4, 5), at("p1", 4, 3), at("p2", 5, 6)];
  const payload = 'self.memory.n = (self.memory.n || 0) + 1; self.log("n" + self.memory.n); if (self.memory.n === 3) self.move("S"); else self.hold();';
  const schedule: Record<number, Order> = {
    0: { type: "upgrade", upgrade: "intrusion" },
    6: { type: "hack", unit: caster, target, code: payload },
    30: { type: "convert", unit: converter, target },
  };
  const orders: { tick: number; player: string; order: Order }[] = [], hashes: Record<number, string> = {}, events: GameEvent[] = [];
  while (inline.tick < 60) {
    const tick = inline.tick, input: PlayerOrder[] = schedule[tick] ? [{ player: "p1", order: schedule[tick] }] : [];
    const expected = inline.step(input);
    expect(isolated.step(input)).toEqual(expected);
    hashes[tick] = inline.hash();
    expect(isolated.hash()).toBe(hashes[tick]);
    orders.push(...input.map((o) => ({ tick, ...o })));
    events.push(...expected.events);
  }
  expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["upgrade_completed", "hypno", "log", "converted"]));

  // What a room checkpoint does on restart: the recorded orders again, on fresh isolated engines.
  const { match, check } = await resimulate({ config: { ...config, scriptHostFactory: createIsolatedScriptHost }, orders, hashes, until: inline.tick });
  live.push(match);
  expect(check.verified).toBe(true);
  expect(match.hash()).toBe(inline.hash());
});

// The lobby always plays a named map, so this room is created directly with the Wizard field; it runs on isolated engines.
it("tells a hacked player only that its unit is compromised, never by whom or with which code, and refuses its orders to it", async () => {
  const room = await Room.create({ ruleset, players: [{ name: "A" }, { name: "B" }], seed: 5, tickRate: 20, sides: "fixed", prepMs: 0, botLatencyMs: 3000,
    chat: false, onFinish: () => {} });
  try {
    // Everything the victim receives, to search for the payload afterwards.
    const received: string[] = [];
    const state = (player: string) => {
      const view = room.view(player);
      if (player === "p2") received.push(JSON.stringify(view));
      return view;
    };
    const send = async (player: string, order: Order) => (await room.act(player, [order])).results[0];
    room.touch("p1"); room.touch("p2");
    await vi.waitFor(() => expect(room.state).toBe("running"), { timeout: 6000, interval: 20 });
    const opening = state("p1");
    const wizard = opening.mine.find((e) => e.kind === "wizard")!.id, target = opening.enemy.find((e) => e.kind === "knight")!.id;
    const secret = "SECRET-PAYLOAD-4b1";

    expect(await send("p1", { type: "upgrade", upgrade: "intrusion" })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(state("p1").players.find((p) => p.id === "p1")?.upgrades?.intrusion).toBe(1), { timeout: 6000, interval: 50 });
    expect(await send("p1", { type: "hack", unit: wizard, target, code: `// ${secret}\nself.hold();` })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(state("p2").mine.find((e) => e.id === target)?.hypno).toBe(true), { timeout: 6000, interval: 50 });

    expect(await send("p2", { type: "stop", unit: target })).toMatchObject({ ok: false, reason: expect.stringMatching(/under hypno/) });
    expect(state("p1").enemy.find((e) => e.id === target)).toMatchObject({ hypno: true, controller: "p1" });
    const victim = state("p2").mine.find((e) => e.id === target);
    expect(victim).toMatchObject({ hypno: true });
    expect(victim).not.toHaveProperty("controller");

    const notices = received.flatMap((body) => (JSON.parse(body) as PlayerView).events.filter((e) => e.type === "hypno"));
    expect(notices).toContainEqual(expect.objectContaining({ id: target, owner: "p2", active: true }));
    for (const notice of notices) for (const field of ["controller", "wizard"]) expect(notice).not.toHaveProperty(field);
    for (const body of received) expect(body).not.toContain(secret);
    expect(JSON.stringify([room.scripts("p1"), room.scripts("p2"), room.spectate()])).not.toContain(secret);
  } finally {
    await room.close();
  }
});
