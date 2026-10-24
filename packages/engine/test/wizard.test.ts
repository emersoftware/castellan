import { afterEach, expect, it } from "vitest";
import { rules, type EntityKind, type GameEvent, type Order, type PlayerId, type ReplayFile, type Ruleset } from "@castellan/shared";
import { createMatch, playRecording, recordingOf, runReplay, type Match, type PlayerOrder } from "../src";

const live: Match[] = [];
afterEach(() => { for (const m of live.splice(0)) m.dispose(); });

const wizard = rules.kinds.wizard, intrusion = wizard.intrusion!, knightHp = rules.kinds.knight.hp;
/** Ticks of a fixed 3-second channel at 10 Hz. */
const CHANNEL = 30;
const duel = [{ id: "p1", name: "one" }, { id: "p2", name: "two" }];
const ffa = [0, 1, 2].map((i) => ({ id: `p${i + 1}`, name: `p${i + 1}`, side: i, team: i }));

/**
 * A bare 20x20 field (kings only unless `start` says otherwise) where every script holds, so only orders and the
 * scripts a test uploads act. `channelMs` fixes both channel windows; `researchMs` shortens Intrusion.
 */
function field(over: {
  channelMs?: number; researchMs?: number; popCap?: number; seats?: 2 | 4; start?: Ruleset["map"]["start"]; sharedDeposits?: Ruleset["map"]["sharedDeposits"];
} = {}): Ruleset {
  const fixed = over.channelMs === undefined ? {} : { unitChannel: { minMs: over.channelMs, maxMs: over.channelMs }, buildingChannel: { minMs: over.channelMs, maxMs: over.channelMs } };
  const research = rules.upgrades.intrusion;
  return {
    ...rules, startMineral: 5000, popCap: over.popCap ?? rules.popCap,
    defaultScripts: Object.fromEntries(Object.keys(rules.defaultScripts).map((kind) => [kind, "self.hold();"])),
    kinds: { ...rules.kinds, wizard: { ...wizard, intrusion: { ...intrusion, ...fixed } } },
    upgrades: { ...rules.upgrades, intrusion: { ...research, levels: research.levels.map((l) => ({ ...l, researchMs: over.researchMs ?? l.researchMs })) } },
    map: { ...rules.map, width: 20, height: 20, seats: over.seats ?? 2, walls: [], neutralWalls: [], deposits: [], sharedDeposits: over.sharedDeposits ?? [],
      start: over.start ?? [{ kind: "king", x: 0, y: 0 }] },
  };
}

async function play(ruleset: Ruleset, players: { id: string; name: string; side?: number; team?: number }[] = duel, seed = 1): Promise<Match> {
  const m = await createMatch({ ruleset, players, seed, tickRate: 10 });
  live.push(m);
  return m;
}
const put = (m: Match, kind: EntityKind, owner: PlayerId, x: number, y: number) => {
  let id = "";
  m.stage((s) => { id = s.spawn(kind, owner, x, y); });
  return id;
};
const study = (m: Match, player: PlayerId, level: number) => m.stage((s) => s.setResearch(player, "intrusion", level));
const king = (m: Match, owner: PlayerId) => m.spectate().entities.find((e) => e.kind === "king" && e.owner === owner)!.id;
const hp = (m: Match, id: string) => m.inspect(id)?.hp;
const act = (m: Match, player: PlayerId, ...orders: Order[]) => m.step(orders.map((order) => ({ player, order })));
/** Each order's refusal reason, or "ok". */
const answers = (m: Match, player: PlayerId, ...orders: Order[]) => act(m, player, ...orders).results.map((r) => (r.ok ? "ok" : r.reason));
const idle = (m: Match, ticks: number) => {
  const events: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...m.step([]).events);
  return events;
};
function stepUntil(m: Match, found: (e: GameEvent) => boolean, max: number): GameEvent {
  for (let i = 0; i < max; i++) {
    const hit = m.step([]).events.find(found);
    if (hit) return hit;
  }
  throw new Error(`no matching event within ${max} ticks`);
}
const converted = (id: string) => (e: GameEvent) => e.type === "converted" && e.id === id;
const hypno = (id: string) => (e: GameEvent) => e.type === "hypno" && e.id === id;
const logs = (m: Match, player: PlayerId, unit: string, since: number) =>
  m.events(player, since).flatMap((e) => (e.type === "log" && e.unit === unit ? [e.message] : []));
const refused = (pattern: RegExp) => expect.stringMatching(pattern);

it("refuses what a Wizard can never do: itself, buildings or enemies to heal, Kings, and intrusion beyond its research", async () => {
  const m = await play(field());
  const w = put(m, "wizard", "p1", 5, 5), ally = put(m, "knight", "p1", 4, 5), home = put(m, "castle", "p1", 2, 8);
  const knight = put(m, "knight", "p2", 8, 5), mage = put(m, "wizard", "p2", 9, 7), castle = put(m, "castle", "p2", 6, 7), far = put(m, "knight", "p2", 17, 12);
  const enemyKing = king(m, "p2");
  m.stage((s) => s.relocate(enemyKing, 7, 3));
  const heal = (target: string): Order => ({ type: "heal", unit: w, target });
  const hack = (target: string, code = "self.hold();"): Order => ({ type: "hack", unit: w, target, code });
  const convert = (target: string): Order => ({ type: "convert", unit: w, target });

  expect(answers(m, "p1", heal(w), heal(home), heal(knight), hack(w), convert(w), convert(knight), hack(knight), convert(far), heal(ally))).toEqual([
    refused(/caster itself/), refused(/buildings cannot be healed/), refused(/your or your allies/), refused(/caster itself/), refused(/caster itself/),
    refused(/requires intrusion research/), refused(/requires intrusion research/), refused(/not visible/), "ok",
  ]);
  study(m, "p1", 1);
  expect(answers(m, "p1", convert(enemyKing), hack(enemyKing), hack(castle), convert(castle), convert(ally), hack(ally), convert(mage))).toEqual([
    refused(/immune/), refused(/immune/), refused(/requires intrusion L2/), refused(/cannot be converted/), refused(/convert targets enemy units/),
    refused(/hack targets enemy entities/), "ok",
  ]);
  study(m, "p1", 2);
  expect(answers(m, "p1", convert(castle), hack(knight, "x".repeat(rules.script.maxBytes + 1)), hack(castle))).toEqual([
    refused(/cannot be converted/), refused(new RegExp(`over ${rules.script.maxBytes} bytes`)), "ok",
  ]);
});

it("heals a teammate's unit 6 HP a second up to its maximum and walks to a wounded King out of reach", async () => {
  const teams = [{ id: "p1", name: "one", side: 0, team: 0 }, { id: "p2", name: "two", side: 1, team: 0 }, { id: "p3", name: "three", side: 2, team: 1 }];
  const m = await play(field({ seats: 4 }), teams);
  const w = put(m, "wizard", "p1", 10, 10), mate = put(m, "knight", "p2", 12, 10), foe = put(m, "knight", "p3", 8, 10), own = king(m, "p1");
  const kingHp = rules.kinds.king.hp;
  m.stage((s) => { s.setHealth(mate, knightHp - 10); s.relocate(own, 10, 15); s.setHealth(own, kingHp - 30); s.setHealth(foe, knightHp - 10); });
  expect(answers(m, "p1", { type: "heal", unit: w, target: foe })).toEqual([refused(/your or your allies/)]);
  act(m, "p1", { type: "heal", unit: w, target: mate });
  idle(m, 9);
  expect(hp(m, mate)).toBe(knightHp - 4);
  idle(m, 10);
  expect(hp(m, mate)).toBe(knightHp);
  act(m, "p1", { type: "heal", unit: w, target: own });
  idle(m, 40);
  const healer = m.inspect(w)!, monarch = m.inspect(own)!;
  expect(Math.max(Math.abs(healer.x - monarch.x), Math.abs(healer.y - monarch.y))).toBeLessThanOrEqual(wizard.heals!.range);
  expect(monarch.hp).toBeGreaterThan(kingHp - 30);
  expect(hp(m, foe)).toBe(knightHp - 10);
});

it("completes a channel after its time in range despite damage, keeps the target's HP, and waits out the shared recharge while healing", async () => {
  const m = await play(field({ channelMs: 3000 }));
  study(m, "p1", 1);
  const w = put(m, "wizard", "p1", 5, 5), hurt = put(m, "knight", "p1", 4, 6), archer = put(m, "archer", "p2", 9, 5), knight = put(m, "knight", "p2", 6, 8);
  m.stage((s) => s.setHealth(archer, 30));
  const start = m.tick;
  const opened = m.step([{ player: "p1", order: { type: "convert", unit: w, target: archer } }, { player: "p2", order: { type: "attack", unit: archer, target: w } }]);
  expect(opened.results.map((r) => r.ok)).toEqual([true, true]);
  const done = stepUntil(m, converted(archer), CHANNEL + 10);
  expect(done).toEqual({ tick: start + CHANNEL - 1, type: "converted", id: archer, kind: "archer", owner: "p1", from: "p2", x: 9, y: 5, wizard: w });
  expect(hp(m, w)).toBeLessThan(wizard.hp);
  expect(m.inspect(archer)).toMatchObject({ owner: "p1", hp: 30 });

  const ready = done.tick + intrusion.rechargeMs / 100;
  expect(m.view("p1").mine.find((e) => e.id === w)?.rechargeMs).toBe((ready - m.tick) * 100);
  expect(m.view("p2").enemy.find((e) => e.id === w)).not.toHaveProperty("rechargeMs");
  m.stage((s) => s.setHealth(hurt, 50));
  act(m, "p1", { type: "heal", unit: w, target: hurt });
  idle(m, 9);
  expect(hp(m, hurt)).toBe(56);
  // Accepted now; the channel opens only when the recharge ends.
  expect(answers(m, "p1", { type: "convert", unit: w, target: knight })).toEqual(["ok"]);
  expect(stepUntil(m, converted(knight), intrusion.rechargeMs / 100 + CHANNEL).tick).toBe(ready + CHANNEL - 1);
});

it("restarts a channel after an explicit stop or move, even when a script picks the same target, but a repeated order keeps progress and its first code", async () => {
  const m = await play(field({ channelMs: 3000 }));
  study(m, "p1", 1);
  const [w1, w2, w3] = [3, 9, 15].map((y) => put(m, "wizard", "p1", 3, y));
  const [k1, k2, k3] = [3, 9, 15].map((y) => put(m, "knight", "p2", 5, y));
  const hack = (word: string): Order => ({ type: "hack", unit: w1, target: k1, code: `self.log("${word}"); self.hold();` });
  // Uploaded with w2's stop: that tick w2's own script asks for the channel it was just told to drop.
  const pick: Order = { type: "script", kind: "wizard", code: `if (self.id === "${w2}") self.convert("${k2}"); else self.hold();` };
  const start = m.tick;
  const events = act(m, "p1", hack("first"), { type: "convert", unit: w2, target: k2 }, { type: "convert", unit: w3, target: k3 }).events;
  events.push(...idle(m, 14));
  const cut = m.tick;
  const second = act(m, "p1", hack("second"), pick, { type: "stop", unit: w2 }, { type: "move", unit: w3, x: 3, y: 16 });
  expect(second.results.map((r) => r.ok)).toEqual([true, true, true, true]);
  events.push(...second.events, ...idle(m, 4));
  const again = m.tick;
  events.push(...act(m, "p1", { type: "convert", unit: w3, target: k3 }).events, ...idle(m, CHANNEL + 5));
  expect(events.find(hypno(k1))?.tick).toBe(start + CHANNEL - 1);
  expect(events.find(converted(k2))?.tick).toBe(cut + CHANNEL - 1);
  expect(events.find(converted(k3))?.tick).toBe(again + CHANNEL - 1);
  expect(new Set(logs(m, "p1", k1, start))).toEqual(new Set(["first"]));
});

it("completes nothing and starts no recharge when the caster or target dies on the completing tick or the target is lost from sight", async () => {
  const m = await play(field({ channelMs: 3000 }));
  study(m, "p1", 1);
  const w1 = put(m, "wizard", "p1", 5, 5), k1 = put(m, "knight", "p2", 7, 5), guard = put(m, "knight", "p1", 8, 5);
  const w2 = put(m, "wizard", "p1", 5, 12), k2 = put(m, "knight", "p2", 7, 12), assassin = put(m, "knight", "p2", 4, 12);
  const w3 = put(m, "wizard", "p1", 5, 17), k3 = put(m, "knight", "p2", 7, 17);
  const convert = (unit: string, target: string): Order => ({ type: "convert", unit, target });
  const start = m.tick;
  act(m, "p1", convert(w1, k1), convert(w2, k2), convert(w3, k3));
  idle(m, 9);
  m.stage((s) => s.relocate(k3, 18, 2));
  expect(m.step([]).events).toContainEqual(expect.objectContaining({ type: "order_end", id: w3, reason: "target lost" }));
  idle(m, start + CHANNEL - 1 - m.tick);
  m.stage((s) => { s.setHealth(k1, 1); s.setHealth(w2, 1); });
  const last = m.step([{ player: "p1", order: { type: "attack", unit: guard, target: k1 } }, { player: "p2", order: { type: "attack", unit: assassin, target: w2 } }]);
  expect(last.events.flatMap((e) => (e.type === "death" ? [e.id] : [])).sort()).toEqual([k1, w2].sort());
  expect(idle(m, CHANNEL).some((e) => e.type === "converted") || last.events.some((e) => e.type === "converted")).toBe(false);
  expect(m.view("p1").mine.find((e) => e.id === w1)).not.toHaveProperty("rechargeMs");
});

it("hacks one entity: its payload outlives the Wizard, survives the owner's uploads and blocks its orders, cannot turn it on its owner's side, until the owner's Wizard recovers it", async () => {
  const m = await play(field({ channelMs: 3000 }));
  study(m, "p1", 1);
  study(m, "p2", 1);
  const w1 = put(m, "wizard", "p1", 5, 5), w2 = put(m, "wizard", "p1", 5, 9);
  const k1 = put(m, "knight", "p2", 8, 5), k2 = put(m, "knight", "p2", 8, 7), k3 = put(m, "knight", "p2", 8, 9);
  const z1 = put(m, "wizard", "p2", 11, 5), z2 = put(m, "wizard", "p2", 11, 9);
  // The payload sees its owner's side as allies and tries to strike one anyway.
  const strike = `self.log("hypno"); const own = self.nearbyAllies().find((e) => e.id === "${k2}"); if (own) self.attack(own); else self.hold();`;
  const start = m.tick;
  act(m, "p1", { type: "hack", unit: w1, target: k1, code: strike }, { type: "hack", unit: w2, target: k3, code: "self.hold();" });
  expect(stepUntil(m, hypno(k1), CHANNEL).tick).toBe(start + CHANNEL - 1);
  // The owner learns which entities are compromised, never by whom.
  expect(m.events("p2", start).filter((e) => e.type === "hypno").sort((a, b) => ((a as { y: number }).y - (b as { y: number }).y))).toEqual([
    { tick: start + CHANNEL - 1, type: "hypno", id: k1, kind: "knight", owner: "p2", x: 8, y: 5, active: true },
    { tick: start + CHANNEL - 1, type: "hypno", id: k3, kind: "knight", owner: "p2", x: 8, y: 9, active: true },
  ]);
  expect(m.events("p1", start).find(hypno(k1))).toMatchObject({ active: true, controller: "p1", wizard: w1 });

  m.stage((s) => s.remove(w1));
  const owner = act(m, "p2", { type: "script", kind: "knight", code: 'self.log("own"); self.hold();' }, { type: "move", unit: k1, x: 9, y: 4 });
  expect(owner.results).toMatchObject([{ ok: true }, { ok: false, reason: refused(/under hypno/) }]);
  idle(m, 30);
  // A hack changes who decides, not sides: the owner's knight is not its enemy.
  expect(hp(m, k2)).toBe(knightHp);
  expect(new Set(logs(m, "p1", k1, start))).toEqual(new Set(["hypno"]));
  expect(logs(m, "p2", k1, start)).toEqual([]);
  expect(logs(m, "p2", k2, start)).toContain("own");
  const seenByOwner = m.view("p2").mine.find((e) => e.id === k1)!;
  expect(seenByOwner.hypno).toBe(true);
  for (const secret of ["controller", "doing", "actionResult"]) expect(seenByOwner).not.toHaveProperty(secret);
  expect(m.view("p1").enemy.find((e) => e.id === k1)).toMatchObject({ hypno: true, controller: "p1" });

  // Recovery: empty code restores the kind script; other code installs the owner's own payload. Neither is hypno.
  const back = m.tick;
  act(m, "p2", { type: "hack", unit: z1, target: k1, code: "" }, { type: "hack", unit: z2, target: k3, code: 'self.log("mine"); self.hold();' });
  idle(m, CHANNEL + 2);
  expect(m.events("p1", back).filter((e) => e.type === "hypno").map((e) => [e.id, (e as { active: boolean }).active]).sort()).toEqual([[k1, false], [k3, false]].sort());
  expect(m.view("p2").mine.filter((e) => e.id === k1 || e.id === k3).map((e) => e.hypno)).toEqual([undefined, undefined]);
  expect(logs(m, "p2", k1, back + CHANNEL)).toContain("own");
  expect(logs(m, "p2", k3, back + CHANNEL)).toContain("mine");
  expect(act(m, "p2", { type: "move", unit: k1, x: 9, y: 2 }, { type: "move", unit: k3, x: 9, y: 12 }).results.map((r) => r.ok)).toEqual([true, true]);
});

it("hacks adjacent buildings with research level 2: a hypno castle cannot train, a hacked wall runs its payload but stays put", async () => {
  const m = await play(field({ channelMs: 3000 }));
  study(m, "p1", 2);
  const w1 = put(m, "wizard", "p1", 5, 5), castle = put(m, "castle", "p2", 6, 6);
  const w2 = put(m, "wizard", "p1", 5, 12), wall = put(m, "wall", "p2", 6, 12);
  const w3 = put(m, "wizard", "p1", 10, 15), worker = put(m, "worker", "p2", 12, 15);
  const start = m.tick;
  act(m, "p1",
    { type: "hack", unit: w1, target: castle, code: 'self.log("castle"); self.hold();' },
    { type: "hack", unit: w2, target: wall, code: 'self.log("wall " + self.type); self.move("N");' },
    { type: "hack", unit: w3, target: worker, code: "self.hold();" });
  idle(m, CHANNEL + 5);
  expect(logs(m, "p1", castle, start)).toContain("castle");
  expect(logs(m, "p1", wall, start)).toContain("wall wall");
  expect(m.inspect(wall)).toMatchObject({ x: 6, y: 12 });

  // What the owner is offered matches what it may actually order.
  const offered = m.view("p2").availableActions!;
  const [train, build] = act(m, "p2", { type: "train", building: castle, kind: "knight" }, { type: "build", unit: worker, kind: "wall", x: 14, y: 15 }).results;
  expect(train).toMatchObject({ ok: false, reason: refused(/under hypno/) });
  expect(build).toMatchObject({ ok: false, reason: refused(/under hypno/) });
  const atCastle = offered.train.filter((a) => a.building === castle);
  expect(atCastle.length).toBeGreaterThan(0);
  for (const option of atCastle) expect(option.blockedBy).toContain(train.ok ? "" : train.reason);
  for (const option of offered.build) expect(option.blockedBy).toContain("no builder");
});

it("in FFA turns a hypno unit on a third player, credits the kill to the controller under its owner's name, lends only the unit's sight, keeps its identity from the owner and third parties, and releases it when the controller is out", async () => {
  const m = await play(field({ channelMs: 3000, seats: 4 }), ffa);
  study(m, "p1", 1);
  const w = put(m, "wizard", "p1", 6, 6);
  const archer = put(m, "archer", "p2", 9, 6), remote = put(m, "knight", "p2", 9, 18);
  const witness = put(m, "knight", "p3", 15, 5), victim = put(m, "knight", "p3", 9, 11);
  m.stage((s) => s.setHealth(victim, rules.kinds.archer.atk! - rules.kinds.knight.def));
  const sees = (player: PlayerId, id: string) => m.view(player).enemy.some((e) => e.id === id);
  expect([sees("p1", witness), sees("p1", remote), sees("p3", archer)]).toEqual([false, false, true]);

  const shoot = `const t = self.nearbyEnemies().find((e) => e.id === "${victim}"); if (t) self.attack(t); else self.hold();`;
  const start = m.tick;
  act(m, "p1", { type: "hack", unit: w, target: archer, code: shoot });
  const events = idle(m, CHANNEL + 20);
  expect([sees("p1", witness), sees("p1", remote)]).toEqual([true, false]);

  // The owner's archer kills a third player's knight: the controller decided it and earns the kill; the death names
  // only the owner, for the victim as for everyone.
  expect(events).toContainEqual(expect.objectContaining({ type: "death", id: victim, by: "p2" }));
  expect(m.events("p3", start)).toContainEqual(expect.objectContaining({ type: "death", id: victim, by: "p2" }));
  expect(m.spectate().players.map((p) => p.kills)).toEqual([1, 0, 0]);

  expect(m.events("p2", start).filter((e) => e.type === "hypno")).toEqual([
    { tick: start + CHANNEL - 1, type: "hypno", id: archer, kind: "archer", owner: "p2", x: 9, y: 6, active: true }]);
  expect(m.events("p3", start).some((e) => e.type === "hypno")).toBe(false);
  for (const view of [m.view("p3").enemy.find((e) => e.id === archer), m.spectate(undefined, { includePerspectives: true }).perspectives!.p3.entities.find((e) => e.id === archer)]) {
    expect(view).toBeDefined();
    expect(view).not.toHaveProperty("hypno");
    expect(view).not.toHaveProperty("controller");
  }
  const ownerPerspective = m.spectate(undefined, { includePerspectives: true }).perspectives!.p2.entities.find((e) => e.id === archer);
  expect(ownerPerspective).toMatchObject({ hypno: true });
  expect(ownerPerspective).not.toHaveProperty("controller");

  const out = m.tick;
  m.forfeit("p1");
  expect(m.events("p2", out)).toContainEqual(expect.objectContaining({ type: "hypno", id: archer, active: false }));
  expect(m.view("p2").mine.find((e) => e.id === archer)).not.toHaveProperty("hypno");
});

it("converts with the converter's research and fresh memory, and exceeds the cap without training past it", async () => {
  const m = await play(field({ channelMs: 3000, popCap: 5 }));
  study(m, "p1", 1);
  m.stage((s) => s.setResearch("p1", "knight_damage", 1));
  const [w1, w2] = [4, 8].map((y) => put(m, "wizard", "p1", 5, y)), w3 = put(m, "wizard", "p1", 6, 6), home = put(m, "castle", "p1", 2, 2);
  const knight = put(m, "knight", "p2", 8, 4), prey = put(m, "knight", "p2", 8, 9);
  m.stage((s) => s.setHealth(knight, 37));
  // The payload and p1's knight script share this code: only a memory reset makes the count start over.
  const count = 'self.memory.n = (self.memory.n || 0) + 1; self.log("n" + self.memory.n); self.hold();';
  const start = m.tick;
  expect(act(m, "p1",
    { type: "script", kind: "knight", code: count },
    { type: "train", building: home, kind: "knight" },
    { type: "hack", unit: w1, target: knight, code: count },
    { type: "convert", unit: w2, target: prey }).results.map((r) => r.ok)).toEqual([true, true, true, true]);
  idle(m, CHANNEL + 10);
  act(m, "p1", { type: "convert", unit: w3, target: knight });
  const events = idle(m, CHANNEL + 5);
  const taken = events.find(converted(knight))!;
  expect(m.inspect(prey)).toMatchObject({ owner: "p1" });
  expect(taken).toMatchObject({ owner: "p1", from: "p2", wizard: w3 });
  expect(m.inspect(knight)).toMatchObject({ owner: "p1", hp: 37, stats: { atk: rules.upgrades.knight_damage.levels[0].value } });
  expect(m.inspect(knight)).not.toHaveProperty("hypno");
  expect(logs(m, "p1", knight, start)).toContain("n20");
  expect(logs(m, "p1", knight, taken.tick + 1)[0]).toBe("n1");

  // King, three Wizards and two converts: over the cap of five. The paid knight waits for room.
  expect(m.view("p1").players.find((p) => p.id === "p1")?.pop).toBe(6);
  idle(m, rules.kinds.knight.trainMs! / 100);
  expect(m.view("p1").mine.filter((e) => e.kind === "knight")).toHaveLength(2);
  m.stage((s) => { s.remove(w1); s.remove(w2); });
  expect(m.step([]).events).toContainEqual(expect.objectContaining({ type: "spawn", kind: "knight", owner: "p1" }));
});

it("has a controlled Wizard convert only for its owner, with its owner's research", async () => {
  const m = await play(field({ channelMs: 3000 }));
  study(m, "p1", 1);
  const w = put(m, "wizard", "p1", 5, 6), bait = put(m, "knight", "p1", 5, 10), mage = put(m, "wizard", "p2", 8, 8);
  // p1's own code makes the hacked p2 Wizard convert a p1 knight: it can, but for p2, once p2 has the research.
  const lure = `const t = self.nearbyEnemies().find((e) => e.id === "${bait}"); if (t) self.convert(t); else self.hold();`;
  act(m, "p1", { type: "hack", unit: w, target: mage, code: lure });
  idle(m, CHANNEL * 2 + 10);
  expect(m.inspect(bait)).toMatchObject({ owner: "p1" });
  study(m, "p2", 1);
  expect(stepUntil(m, converted(bait), CHANNEL * 2 + 10)).toMatchObject({ owner: "p2", from: "p1", wizard: mage });
});

it("refuses a hack order whose code does not compile, reports the same code from a script and oversized payload memory to the controller only, without starting the recharge", async () => {
  const m = await play(field({ channelMs: 3000 }));
  study(m, "p1", 1);
  const w1 = put(m, "wizard", "p1", 5, 5), k1 = put(m, "knight", "p2", 8, 5);
  const w2 = put(m, "wizard", "p1", 5, 10), k2 = put(m, "knight", "p2", 8, 10);
  const start = m.tick;
  // An order is refused at once; the same code from a script reports why when its channel would start.
  const broken = act(m, "p1", { type: "hack", unit: w1, target: k1, code: "self.hold(" });
  expect(broken.results[0]).toEqual({ ok: false, reason: refused(/^hack code:/) });
  act(m, "p1", { type: "script", kind: "wizard", code: `if (self.id === "${w1}") self.hack("${k1}", "self.hold("); else self.hold();` });
  expect(m.view("p1").mine.find((e) => e.id === w1)?.actionResult).toMatchObject({ source: "script", status: "invalid", reason: refused(/^hack code:/) });
  expect(m.view("p1").mine.find((e) => e.id === w1)).not.toHaveProperty("rechargeMs");

  act(m, "p1", { type: "hack", unit: w2, target: k2, code: `self.memory.big = "x".repeat(${rules.script.memoryBytes * 2}); self.hold();` });
  idle(m, CHANNEL + 3);
  const error = (player: PlayerId) => m.events(player, start).filter((e) => e.type === "script_error" && e.unit === k2);
  expect(error("p1")).toContainEqual(expect.objectContaining({ owner: "p1", message: expect.stringMatching(/memory/) }));
  expect(error("p2")).toEqual([]);
});

it("has a hypno worker unload for its owner only at a dropoff its controller sees, never routing to a hidden one", async () => {
  const m = await play(field({ channelMs: 3000, sharedDeposits: [{ x: 10, y: 10, amount: 500 }] }));
  study(m, "p1", 1);
  const w = put(m, "wizard", "p1", 5, 11), worker = put(m, "worker", "p2", 10, 11);
  // The owner's nearer castle stays outside everything p1 sees, the worker's own sight included.
  const hidden = put(m, "castle", "p2", 15, 11), shown = put(m, "castle", "p2", 3, 13);
  const sees = (id: string) => m.view("p1").enemy.some((e) => e.id === id);
  const minerals = () => m.spectate().players.map((p) => p.mineral);
  const before = minerals();
  act(m, "p1", { type: "hack", unit: w, target: worker, code: "self.gather();" });
  let east = 0;
  // Long enough for one trip to the shown castle (about 9 seconds), short of a second.
  for (let i = 0; i < 120; i++) {
    m.step([]);
    east = Math.max(east, m.inspect(worker)!.x);
    expect(sees(hidden)).toBe(false);
  }
  expect(sees(shown)).toBe(true);
  expect(east).toBe(10);
  expect(minerals()).toEqual([before[0], before[1]! + rules.gather.carry]);
});

it("replays a recorded hack, conversion and recovery with seeded channel lengths, and desyncs when the payload code changes", async () => {
  const ruleset = field({ researchMs: 1000, start: [{ kind: "king", x: 0, y: 0 }, { kind: "wizard", x: 8, y: 9 }, { kind: "wizard", x: 8, y: 7 }, { kind: "knight", x: 10, y: 9 }] });
  const m = await play(ruleset, duel, 7);
  const at = (owner: PlayerId, x: number, y: number) => m.spectate().entities.find((e) => e.owner === owner && e.x === x && e.y === y)!.id;
  const [w, knight1] = [at("p1", 8, 9), at("p1", 10, 9)], [z1, z2, knight2] = [at("p2", 11, 10), at("p2", 11, 12), at("p2", 9, 10)];
  const payload = 'self.memory.n = (self.memory.n || 0) + 1; if (self.memory.n <= 5) self.move("E"); else self.hold();';
  const replay: ReplayFile = { format: 1, id: "wizard", createdAt: "", ruleset, seed: 7, tickRate: 10, players: duel,
    orders: [], hashes: {}, finalTick: 0, outcome: { winner: null, reason: "timeout", scores: {} } };
  const recorded: GameEvent[] = [];
  const issued: Record<string, number> = {};
  const record = (input: PlayerOrder[]) => {
    const tick = m.tick;
    for (const o of input) replay.orders.push({ tick, ...o });
    recorded.push(...m.step(input).events);
    replay.hashes[tick] = m.hash();
  };
  record([{ player: "p1", order: { type: "upgrade", upgrade: "intrusion" } }, { player: "p2", order: { type: "upgrade", upgrade: "intrusion" } }]);
  while (m.tick < 11) record([]);
  issued.attack = m.tick;
  record([{ player: "p1", order: { type: "hack", unit: w, target: knight2, code: payload } }, { player: "p2", order: { type: "convert", unit: z1, target: knight1 } }]);
  while (!recorded.some(hypno(knight2)) && m.tick < 120) record([]);
  issued.recovery = m.tick + 5;
  while (m.tick < issued.recovery) record([]);
  record([{ player: "p2", order: { type: "hack", unit: z2, target: knight2, code: "" } }]);
  while (!(recorded.some(converted(knight1)) && recorded.filter(hypno(knight2)).length === 2) && m.tick < 240) record([]);
  for (let i = 0; i < 5; i++) record([]);
  replay.finalTick = m.tick;

  const hacked = recorded.find(hypno(knight2))!, recovered = recorded.filter(hypno(knight2))[1];
  const took = (event: GameEvent | undefined, from: number) => (event ? event.tick - from + 1 : undefined);
  const lengths = [took(hacked, issued.attack), took(recorded.find(converted(knight1)), issued.attack), took(recovered, issued.recovery)];
  for (const ticks of lengths) expect([30, 40, 50, 60, 70]).toContain(ticks);
  expect(recovered).toMatchObject({ active: false });

  const replayed: GameEvent[] = [];
  expect((await playRecording(recordingOf(replay), () => {}, {}, (t) => replayed.push(...t.events))).verified).toBe(true);
  expect(replayed).toEqual(recorded);
  const tampered: ReplayFile = { ...replay, orders: replay.orders.map((o) => (o.order.type === "hack" && o.order.code ? { ...o, order: { ...o.order, code: payload.replace('"E"', '"W"') } } : o)) };
  expect((await runReplay(tampered, () => {})).verified).toBe(false);
});
