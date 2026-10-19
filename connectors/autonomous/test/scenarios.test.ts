import { afterAll, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MAPS, rules, type Order, type Ruleset } from "../../../packages/shared/src/index";
import { AutonomousPlayer } from "../src/player";
import { attachPlayer, createExperiment, type Experiment } from "../validate";

const recorded: { scenario: string; fixture: string; evidence: unknown }[] = [];
afterAll(async () => {
  if (!process.env.CASTELLAN_EVIDENCE_DIR) return;
  await mkdir(process.env.CASTELLAN_EVIDENCE_DIR, { recursive: true });
  await writeFile(resolve(process.env.CASTELLAN_EVIDENCE_DIR, "scenarios.json"), JSON.stringify({ generatedAt: new Date().toISOString(), scenarios: recorded }, null, 2) + "\n");
});

function constructionRules(): Ruleset {
  return { ...rules, startMineral: 3000, map: { ...rules.map, name: "scenario-construction",
    description: "Explicit test fixture: mineral for a chosen expansion and its defenses, remote mineral deposits.",
    deposits: [], sharedDeposits: [{ x: 13, y: 5, amount: 4000 }, { x: 14, y: 6, amount: 4000 }],
    start: [...rules.map.start, { kind: "worker", x: 7, y: 6 }] } };
}

/** Scenario setup only. No private entity, identifier or position is sent to the player. */
function spawnFixture(experiment: Experiment, kind: string, owner: string, x: number, y: number): string {
  const fixture = experiment.match as unknown as { spawn(kind: string, owner: string, x: number, y: number): { id: string }; refreshVision(): void };
  const unit = fixture.spawn(kind, owner, x, y);
  fixture.refreshVision();
  return unit.id;
}

function plan(experiment: Experiment, player: AutonomousPlayer) {
  player.planConstruction(experiment.view("p1"), "expansion", { x: 9, y: 5 }, [
    { kind: "castle", x: 9, y: 5 }, { kind: "tower", x: 11, y: 7 }, { kind: "wall", x: 10, y: 8 }, { kind: "door", x: 11, y: 8 },
  ]);
}

describe("autonomous player: observable engine scenarios", () => {
  it("completes an explicitly chosen expansion and defenses, unloads at the new castle, and its tower deals real damage", async () => {
    const experiment = await createExperiment({ ruleset: constructionRules() });
    const player = attachPlayer(experiment, "p1");
    try {
      plan(experiment, player);
      // Probe as soon as construction and a real delivery have completed.
      // Waiting a fixed 100s lets a cheaper expansion produce an army that wins
      // the match before the stationary target is even introduced.
      while (experiment.match.tick < 1000 && !experiment.match.outcome) {
        experiment.tick();
        const completed = [...experiment.completedBuildings.values()].filter(e => e.owner === "p1");
        const castle = completed.find(e => e.kind === "castle" && e.x === 9 && e.y === 5);
        if (["castle", "tower", "wall", "door"].every(kind => completed.some(e => e.kind === kind))
          && castle && experiment.unloads.some(e => e.dropoff === castle.id)) break;
      }
      expect(experiment.match.outcome).toBeNull();
      const built = [...experiment.completedBuildings.values()].filter(e => e.owner === "p1");
      expect(built.map(e => e.kind)).toEqual(expect.arrayContaining(["castle", "tower", "wall", "door"]));
      const expansion = built.find(e => e.kind === "castle" && e.x === 9 && e.y === 5)!;
      expect(experiment.unloads.filter(e => e.dropoff === expansion.id).reduce((n, e) => n + e.amount, 0)).toBeGreaterThan(0);
      const tower = built.find(e => e.kind === "tower" && e.x === 11 && e.y === 7)!;
      // Stationary opponent is introduced only after completion; identify actual landed projectiles, not accepted build orders.
      // Hold other attackers and pause strategic decisions for this isolated
      // firing check so army size cannot decide which unit gets the damage.
      const pause = new Set(["p1"]);
      const heldKinds = ["worker", "knight", "archer", "castle", "king"];
      const intruder = spawnFixture(experiment, "knight", "p2", 16, 7);
      const input: Order = { type: "script", kind: "knight", code: "self.hold();" };
      experiment.tick([
        ...heldKinds.map(kind => ({ player: "p1", order: { type: "script", kind, code: "self.hold();" } as Order })),
        ...experiment.view("p1").mine.filter(e => heldKinds.includes(e.kind)).map(e => ({ player: "p1", order: { type: "stop", unit: e.id } as Order })),
        { player: "p2", order: input },
      ], pause);
      experiment.advanceTo(experiment.match.tick * 1000 / experiment.match.tickRate + 20_000, undefined, pause);
      expect(experiment.damage.get(tower.id) ?? 0).toBeGreaterThan(0);
      const target = experiment.entities.get(intruder);
      expect(target!.hp).toBeLessThan(rules.kinds.knight.hp);
      recorded.push({ scenario: "completed-expansion-and-working-defense", fixture: "3000 starting mineral, moved deposits, seeded construction strategy; default costs, build times, combat and fog; other attackers held and decisions paused during the tower firing probe", evidence: experiment.summary() });
    } finally { player.close(); experiment.match.dispose(); }
  });

  it("constructs a door in a forced corridor and a friendly worker actually crosses it", async () => {
    const ruleset: Ruleset = { ...rules, startMineral: 1000, map: {
      name: "scenario-door", description: "A one-tile corridor forces passage through the newly built door.", width: 32, height: 32,
      walls: Array.from({ length: 32 }, (_, x) => [{ x, y: 3 }, { x, y: 5 }]).flat(),
      start: [{ kind: "castle", x: 1, y: 1 }, { kind: "king", x: 0, y: 0 }, { kind: "worker", x: 1, y: 4 }],
      deposits: [], sharedDeposits: [],
    } };
    const experiment = await createExperiment({ ruleset });
    const player = attachPlayer(experiment, "p1");
    try {
      player.planConstruction(experiment.view("p1"), "defense", { x: 2, y: 4 }, [{ kind: "door", x: 2, y: 4 }]);
      experiment.advanceTo(6_000);
      const door = [...experiment.completedBuildings.values()].find(e => e.kind === "door" && e.owner === "p1")!;
      expect(door).toBeDefined();
      const worker = experiment.view("p1").mine.find(e => e.kind === "worker" && e.y === 4)!;
      // Once built, exercise the resulting route with a normal player action. Pausing decisions isolates the traversal evidence.
      const pause = new Set(["p1"]);
      experiment.tick([{ player: "p1", order: { type: "move", unit: worker.id, x: 4, y: 4 } }], pause);
      experiment.advanceTo(12_000, undefined, pause);
      expect(experiment.crossings).toContainEqual(expect.objectContaining({ door: door.id, unit: worker.id }));
      expect(experiment.view("p1").mine.find(e => e.id === worker.id)).toMatchObject({ x: 4, y: 4 });
      recorded.push({ scenario: "constructed-friendly-door-passage", fixture: "1000 mineral, forced corridor, seeded defense strategy then a legal movement order", evidence: { door, worker: worker.id, crossings: experiment.crossings, final: experiment.view("p1").mine.find(e => e.id === worker.id) } });
    } finally { player.close(); experiment.match.dispose(); }
  });

  it("chooses and completes its own defenses after finishing an expansion", async () => {
    const experiment = await createExperiment({ ruleset: constructionRules() });
    const player = attachPlayer(experiment, "p1");
    try {
      player.planConstruction(experiment.view("p1"), "expansion", { x: 9, y: 5 }, [{ kind: "castle", x: 9, y: 5 }]);
      experiment.advanceTo(110_000);
      const built = [...experiment.completedBuildings.values()].filter(e => e.owner === "p1");
      expect(built.map(e => e.kind)).toEqual(expect.arrayContaining(["castle", "tower", "door", "wall"]));
      expect(player.memory.plans.some(p => p.purpose === "defense" && p.status === "completed")).toBe(true);
      recorded.push({ scenario: "locally-chosen-expansion-defense", fixture: "Only the initial castle plan is seeded; the player chooses and completes all follow-up defenses itself", evidence: experiment.summary() });
    } finally { player.close(); experiment.match.dispose(); }
  });

  it("chooses retreat locally when a healthy forward unit observes a superior force", async () => {
    const ruleset: Ruleset = { ...rules, map: { ...rules.map, start: [...rules.map.start, { kind: "archer", x: 12, y: 8 }] } };
    const experiment = await createExperiment({ ruleset });
    const player = attachPlayer(experiment, "p1", { strategicIntervalMs: 60_000 });
    try {
      player.memory.stance = "attack";
      player.memory.goal = { x: 18, y: 8 };
      spawnFixture(experiment, "knight", "p2", 16, 8);
      spawnFixture(experiment, "knight", "p2", 17, 8);
      const archer = experiment.view("p1").mine.find(e => e.kind === "archer")!;
      experiment.advanceTo(6000);
      const after = experiment.view("p1").mine.find(e => e.id === archer.id)!;
      expect(after.hp).toBe(after.maxHp);
      expect(after.x).toBeLessThan(archer.x - 3);
      expect(experiment.traces.some(t => {
        const event = t.event as { type?: string; stance?: string };
        return event.type === "decision" && event.stance === "evacuate";
      })).toBe(true);
      recorded.push({ scenario: "locally-chosen-retreat", fixture: "Forward healthy archer sees two normal enemy knights; the local strategic policy decides to retreat", evidence: { before: archer, after } });
    } finally { player.close(); experiment.match.dispose(); }
  });

  it("has a passive negative control: the same funded expansion fixture completes no structures or expansion income", async () => {
    const experiment = await createExperiment({ ruleset: constructionRules() });
    try {
      experiment.advanceTo(100_000);
      expect([...experiment.completedBuildings.values()]).toEqual([]);
      expect(experiment.unloads.some(e => e.builtDuringMatch)).toBe(false);
      recorded.push({ scenario: "passive-construction-negative-control", fixture: "Identical funded construction fixture, no player controller and no seeded orders", evidence: experiment.summary() });
    } finally { experiment.match.dispose(); }
  });

  it("a completed gate and tower prevent the worker loss and King damage suffered under the same knight raid without defense", async () => {
    const ruleset: Ruleset = { ...rules, startMineral: 600, popCap: 4, map: {
      name: "scenario-defended-corridor", description: "A narrow attack corridor with a tower alcove; no production slots isolate completed defense from army production.",
      width: 32, height: 32, deposits: [], sharedDeposits: [],
      walls: Array.from({ length: 32 }, (_, x) => [{ x, y: 8 }, ...([3, 4, 5].includes(x) ? [] : [{ x, y: 6 }])]).flat(),
      start: [{ kind: "castle", x: 4, y: 4 }, { kind: "king", x: 4, y: 7 }, { kind: "worker", x: 6, y: 7 }, { kind: "worker", x: 5, y: 5 }, { kind: "worker", x: 3, y: 5 }],
    } };
    const results: { defended: boolean; kingAlive: boolean; kingHp: number; originalWorkersAlive: number; raidersKilled: number; towerDamage: number; summary: unknown }[] = [];
    for (const defended of [false, true]) {
      const experiment = await createExperiment({ ruleset });
      const player = defended ? attachPlayer(experiment, "p1") : undefined;
      try {
        const initial = experiment.view("p1").mine;
        const king = initial.find(e => e.kind === "king")!;
        const workers = initial.filter(e => e.kind === "worker").map(e => e.id);
        if (player) player.planConstruction(experiment.view("p1"), "defense", { x: 5, y: 7 }, [{ kind: "door", x: 7, y: 7 }, { kind: "tower", x: 5, y: 6 }]);
        experiment.advanceTo(25_000);
        if (defended) expect([...experiment.completedBuildings.values()].map(e => e.kind)).toEqual(expect.arrayContaining(["door", "tower"]));
        // Restore the same default King/worker reactions for both branches after construction.
        experiment.controllers.delete("p1");
        experiment.tick([{ player: "p1", order: { type: "script", kind: "king", code: null } }, { player: "p1", order: { type: "script", kind: "worker", code: null } }]);
        const raiders = [spawnFixture(experiment, "knight", "p2", 11, 7), spawnFixture(experiment, "knight", "p2", 12, 7)];
        experiment.advanceTo(100_000);
        const final = experiment.view("p1").mine;
        const tower = [...experiment.completedBuildings.values()].find(e => e.kind === "tower");
        results.push({ defended, kingAlive: final.some(e => e.id === king.id), kingHp: final.find(e => e.id === king.id)?.hp ?? 0,
          originalWorkersAlive: final.filter(e => workers.includes(e.id)).length,
          raidersKilled: experiment.events.filter(e => e.event.type === "death" && raiders.includes(e.event.id)).length,
          towerDamage: tower ? experiment.damage.get(tower.id) ?? 0 : 0, summary: experiment.summary() });
      } finally { player?.close(); experiment.match.dispose(); }
    }
    // Contrasts, not absolute HP: the undefended branch must suffer what the defense prevents.
    expect(results[0].kingHp).toBeLessThan(results[1].kingHp);
    expect(results[0].originalWorkersAlive).toBeLessThan(results[1].originalWorkersAlive);
    expect(results[1].kingAlive).toBe(true);
    expect(results[1].kingHp).toBe(rules.kinds.king.hp);
    expect(results[1].originalWorkersAlive).toBe(3);
    expect(results[1].raidersKilled).toBe(2);
    expect(results[1].towerDamage).toBeGreaterThan(0);
    recorded.push({ scenario: "paired-working-defense-vs-knight-raid", fixture: "Same narrow corridor, normal two-knight attackers, same restored reactions and no production slots; only seeded construction differs", evidence: results });
  });

  it("recovers from a real rejected build caused by mineral changing after its observation", async () => {
    const ruleset = constructionRules();
    ruleset.startMineral = rules.kinds.tower.cost;
    ruleset.map = { ...ruleset.map, deposits: [{ x: 10, y: 2, amount: 2000 }] };
    const experiment = await createExperiment({ ruleset });
    const player = attachPlayer(experiment, "p1");
    try {
      const chosen = player.planConstruction(experiment.view("p1"), "defense", { x: 9, y: 5 }, [{ kind: "tower", x: 9, y: 5 }]);
      const orders = player.step(experiment.view("p1"));
      expect(orders.some(o => o.type === "build")).toBe(true);
      const castle = experiment.view("p1").mine.find(e => e.kind === "castle")!;
      // Another allowed command spends mineral after the snapshot used for the build decision.
      experiment.tick([{ player: "p1", order: { type: "train", building: castle.id, kind: "worker" } }], new Set(["p1"]));
      experiment.tick(orders.map(order => ({ player: "p1", order })), new Set(["p1"]));
      player.feedback(orders, experiment.lastResults, experiment.view("p1"));
      expect(experiment.rejected.some(r => r.order.type === "build")).toBe(true);
      // Routine resource deliveries recover the missing budget, then the executor retries.
      experiment.advanceTo(45_000);
      expect(chosen.status).toBe("completed");
      expect(chosen.tasks[0].attempts).toBeGreaterThan(0);
      expect([...experiment.completedBuildings.values()].some(e => e.kind === "tower" && e.x === 9 && e.y === 5)).toBe(true);
      recorded.push({ scenario: "rejected-order-recovery", fixture: "A legal worker training order spends 50 mineral between observation and build submission; normal gathering replenishes the budget", evidence: { plan: chosen, rejections: experiment.rejected, summary: experiment.summary() } });
    } finally { player.close(); experiment.match.dispose(); }
  });

  it("abandons an expansion made unsafe by a new force and releases the builder", async () => {
    const experiment = await createExperiment({ ruleset: constructionRules() });
    const player = attachPlayer(experiment, "p1");
    try {
      const chosen = player.planConstruction(experiment.view("p1"), "expansion", { x: 9, y: 5 }, [{ kind: "castle", x: 9, y: 5 }]);
      experiment.advanceTo(5_000);
      const builder = chosen.tasks[0].worker!;
      expect(experiment.view("p1").mine.find(e => e.id === builder)?.construction).toBeDefined();
      for (const point of [{ x: 11, y: 5 }, { x: 11, y: 6 }, { x: 12, y: 6 }]) spawnFixture(experiment, "knight", "p2", point.x, point.y);
      experiment.advanceTo(7_000);
      expect(chosen.status).toBe("abandoned");
      expect(experiment.view("p1").mine.find(e => e.id === builder)?.construction).toBeUndefined();
      expect(experiment.traces.some(t => (t.event as { type?: string }).type === "strategic-failure")).toBe(true);
      expect([...experiment.completedBuildings.values()].some(e => e.kind === "castle")).toBe(false);
      recorded.push({ scenario: "unsafe-expansion-abandoned", fixture: "Three normal enemy knights enter sight during a seeded expansion build; no combat or construction stats changed", evidence: { plan: chosen, builder: experiment.view("p1").mine.find(e => e.id === builder), summary: experiment.summary() } });
    } finally { player.close(); experiment.match.dispose(); }
  });

  it("detects a builder killed between observations and completes the interrupted build with a replacement", async () => {
    const experiment = await createExperiment({ ruleset: constructionRules() });
    const player = attachPlayer(experiment, "p1");
    try {
      const chosen = player.planConstruction(experiment.view("p1"), "expansion", { x: 9, y: 5 }, [{ kind: "castle", x: 9, y: 5 }]);
      experiment.advanceTo(5_000);
      const builder = experiment.view("p1").mine.find(e => e.id === chosen.tasks[0].worker)!;
      expect(builder.construction).toBeDefined();
      const intruder = spawnFixture(experiment, "knight", "p2", builder.x, builder.y - 1);
      const pause = new Set(["p1"]);
      experiment.tick([{ player: "p2", order: { type: "attack", unit: intruder, target: builder.id } }], pause);
      // An explicit observation gap permits a lethal ambush; engine combat remains unchanged.
      experiment.advanceTo(9_000, undefined, pause);
      expect(experiment.events.some(e => e.event.type === "death" && e.event.id === builder.id)).toBe(true);
      experiment.tick([{ player: "p2", order: { type: "move", unit: intruder, x: 22, y: 15 } }], pause);
      experiment.advanceTo(19_000, undefined, pause);
      experiment.advanceTo(65_000);
      expect(chosen.status).toBe("completed");
      const rebuilt = [...experiment.completedBuildings.values()].find(e => e.owner === "p1" && e.kind === "castle" && e.x === 9 && e.y === 5)!;
      expect(rebuilt).toBeDefined();
      expect(rebuilt.builder).not.toBe(builder.id);
      expect(experiment.traces.some(t => (t.event as { type?: string; reason?: string }).type === "execution-interrupted" && (t.event as { reason?: string }).reason === "builder lost")).toBe(true);
      recorded.push({ scenario: "builder-death-recovery", fixture: "Normal knight ambush during a deliberate observation gap, then a legal enemy retreat; no direct damage/stat mutation", evidence: { formerBuilder: builder.id, replacement: rebuilt.builder, plan: chosen, summary: experiment.summary() } });
    } finally { player.close(); experiment.match.dispose(); }
  });

  it("adopts authenticated teammate coordination and physically redirects an existing army", async () => {
    const ruleset: Ruleset = { ...rules, map: { ...MAPS.quad, start: [...MAPS.quad.start, { kind: "knight", x: 6, y: 7 }, { kind: "archer", x: 7, y: 7 }] } };
    const players = [
      { id: "p1", name: "receiver", side: 0, team: 0 }, { id: "p2", name: "sender", side: 2, team: 0 },
      { id: "p3", name: "enemy-a", side: 1, team: 1 }, { id: "p4", name: "enemy-b", side: 3, team: 1 },
    ];
    const experiment = await createExperiment({ ruleset, players });
    const player = attachPlayer(experiment, "p1");
    try {
      // Warm up scripts, then issue the teammate's chat through the engine, including its real channel/from identity.
      experiment.advanceTo(1000);
      const army = experiment.view("p1").mine.filter(e => e.kind === "knight" || e.kind === "archer");
      const before = new Map(army.map(e => [e.id, e.x]));
      experiment.tick([{ player: "p2", order: { type: "chat", channel: "team", text: "[AOA1] attack 20,8" } }]);
      experiment.advanceTo(15_000);
      expect(player.memory.coordination).toMatchObject({ from: "p2", action: "attack", point: { x: 20, y: 8 } });
      const redirected = experiment.view("p1").mine.filter(e => before.has(e.id) && e.x > before.get(e.id)! + 5);
      expect(redirected.length).toBeGreaterThan(0);
      expect(experiment.traces.some(t => (t.event as { type?: string }).type === "coordination-adopted")).toBe(true);
      recorded.push({ scenario: "team-coordination-changes-movement", fixture: "Quad with one existing knight and archer per player; sender is engine-authenticated same-team seat", evidence: { before: army.map(({ id, x, y }) => ({ id, x, y })), after: redirected.map(({ id, x, y }) => ({ id, x, y })), coordination: player.memory.coordination, chats: experiment.summary().chats } });
    } finally { player.close(); experiment.match.dispose(); }
  });

  it("an FFA truce suppresses distant targeting until expiry without creating a mechanical alliance", async () => {
    const ruleset: Ruleset = { ...rules, startMineral: 0, map: { ...MAPS.quad, deposits: [], sharedDeposits: [], start: [...MAPS.quad.start, { kind: "archer", x: 20, y: 12 }] } };
    const players = Array.from({ length: 4 }, (_, side) => ({ id: `p${side + 1}`, name: `seat-${side}`, side, team: side }));
    const experiment = await createExperiment({ ruleset, players });
    const player = attachPlayer(experiment, "p1", { strategicIntervalMs: 100_000 });
    try {
      player.memory.goal = { x: 20, y: 12 };
      player.memory.lastDecisionMs = 0;
      player.memory.cooldowns.scout = 100_000;
      const archer = experiment.view("p1").mine.find(e => e.kind === "archer")!;
      const target = spawnFixture(experiment, "knight", "p2", 24, 12);
      experiment.tick([{ player: "p1", order: { type: "script", kind: "archer", code: "self.hold();" } },
        { player: "p2", order: { type: "script", kind: "knight", code: "self.hold();" } },
        { player: "p2", order: { type: "chat", to: "p1", text: "[AOA1] truce 60" } }], new Set(["p1"]));
      experiment.advanceTo(55_000);
      expect(player.memory.treaties.p2).toBeGreaterThan(55_000);
      expect(experiment.damage.get(archer.id) ?? 0).toBe(0);
      expect(experiment.view("p1").enemy.some(e => e.id === target)).toBe(true);
      expect(experiment.view("p1").allies).toEqual([]);
      experiment.advanceTo(67_000);
      expect(experiment.damage.get(archer.id) ?? 0).toBeGreaterThan(0);
      recorded.push({ scenario: "ffa-truce-targeting-and-expiry", fixture: "One held archer in range of a stationary distant knight; explicit campaign position, no new production, 60s negotiated promise", evidence: { treatyUntilMs: player.memory.treaties.p2, archerDamageAfterExpiry: experiment.damage.get(archer.id), target: experiment.entities.get(target), chats: experiment.summary().chats } });
    } finally { player.close(); experiment.match.dispose(); }
  });
});
