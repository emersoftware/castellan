import { describe, expect, it } from 'vitest';
import { createMatch } from '../../../packages/engine/src/index';
import { rules, type Order, type Ruleset } from '../../../packages/shared/src/index';
import { AutonomousPlayer, type PlayerMemory } from '../src/player';

const participants = [
  { id: 'p1', name: 'player', side: 0, team: 0 },
  { id: 'p2', name: 'opponent', side: 1, team: 1 },
];
const input = (orders: Order[]) => orders.map(order => ({ player: 'p1', order }));

describe('autonomous policy recovery', () => {
  it('drops external decision overrides in older checkpoints and recomputes strategy locally', async () => {
    const match = await createMatch({ ruleset: rules, players: participants, seed: 17, tickRate: 10 });
    const original = new AutonomousPlayer(rules);
    const memory = JSON.parse(JSON.stringify(original.memory));
    Object.assign(memory, { stance: 'attack', lastDecisionMs: 0, lastAdviceMs: 0, advisorCalls: 1,
      campaignChoice: { stance: 'attack', untilMs: 999999 }, defenseChoice: { stance: 'hold', untilMs: 999999 },
      diplomacyChoice: { mode: 'decline-truce', untilMs: 999999 } });
    const resumed = new AutonomousPlayer(rules, { memory });
    try {
      resumed.step(match.view('p1'));
      expect(resumed.memory.stance).toBe('hold');
      for (const field of ['lastAdviceMs', 'advisorCalls', 'campaignChoice', 'defenseChoice', 'diplomacyChoice']) expect(field in resumed.memory).toBe(false);
    } finally { original.close(); resumed.close(); match.dispose(); }
  });

  it('adopts a visible in-progress build after the accepted action response is lost', async () => {
    const ruleset: Ruleset = { ...rules, startMineral: 700 };
    const match = await createMatch({ ruleset, players: participants, seed: 17, tickRate: 10 });
    const player = new AutonomousPlayer(ruleset);
    try {
      player.planConstruction(match.view('p1'), 'defense', { x: 7, y: 7 }, [{ kind: 'tower', x: 7, y: 7 }]);
      const first = player.step(match.view('p1'));
      const requested = first.find((order): order is Extract<Order, { type: 'build' }> => order.type === 'build')!;
      expect(requested).toBeDefined();
      const result = match.step(input(first));
      expect(result.results[first.indexOf(requested)].ok).toBe(true);
      // The server accepted the batch, but no feedback() reaches the process.
      const nextView = match.view('p1');
      expect(nextView.mine.find(e => e.id === requested.unit)?.construction).toMatchObject({ kind: 'tower', x: 7, y: 7 });
      const nextOrders = player.step(nextView);
      expect(nextOrders.filter(order => order.type === 'build')).toEqual([]);
      expect(player.memory.plan?.tasks[0].worker).toBe(requested.unit);
      expect(player.memory.plan?.tasks[0].attempts).toBe(0);
    } finally { player.close(); match.dispose(); }
  });

  it('reconciles construction history after the exact JSON checkpoint round trip and then defends the completed expansion', async () => {
    const ruleset: Ruleset = { ...rules, startMineral: 700 };
    const match = await createMatch({ ruleset, players: participants, seed: 17, tickRate: 10 });
    const original = new AutonomousPlayer(ruleset);
    let resumed: AutonomousPlayer | undefined;
    try {
      const expansion = original.planConstruction(match.view('p1'), 'expansion', { x: 9, y: 5 }, [{ kind: 'castle', x: 9, y: 5 }]);
      const orders = original.step(match.view('p1'));
      const result = match.step(input(orders));
      original.feedback(orders, result.results, match.view('p1'));
      const checkpoint = JSON.parse(JSON.stringify(original.memory)) as PlayerMemory;
      original.close();
      // The real game and installed routines continue during the process outage.
      while (match.tick < 350) match.step([]);
      expect(match.view('p1').mine.some(e => e.kind === 'castle' && e.x === 9 && e.y === 5)).toBe(true);
      resumed = new AutonomousPlayer(ruleset, { memory: checkpoint });
      resumed.step(match.view('p1'));
      expect(resumed.memory.plans.find(plan => plan.id === expansion.id)?.status).toBe('completed');
      expect(resumed.memory.plan).toMatchObject({ purpose: 'defense', anchor: { x: 9, y: 5 }, status: 'active' });
    } finally { resumed?.close(); original.close(); match.dispose(); }
  });

  it('does not override strategic evacuation with an explicit exploration order', async () => {
    const ruleset: Ruleset = { ...rules, map: { ...rules.map, start: [...rules.map.start, { kind: 'knight', x: 7, y: 7 }] } };
    const match = await createMatch({ ruleset, players: participants, seed: 17, tickRate: 10 });
    const player = new AutonomousPlayer(ruleset);
    try {
      const view = match.view('p1');
      player.memory.stance = 'evacuate';
      player.memory.home = { x: 4, y: 4 };
      player.memory.goal = { x: 4, y: 4 };
      player.memory.lastDecisionMs = view.timeMs;
      const knight = view.mine.find(e => e.kind === 'knight')!;
      const orders = player.step(view);
      expect(orders.some(order => order.type === 'move' && order.unit === knight.id)).toBe(false);
      match.step(input(orders));
      expect(match.view('p1').mine.find(e => e.id === knight.id)?.order).toBeUndefined();
      expect(player.memory.stance).toBe('evacuate');
    } finally { player.close(); match.dispose(); }
  });

  it('cancels the former persistent build when a strategic caller replaces its plan between observations', async () => {
    const ruleset: Ruleset = { ...rules, startMineral: 700 };
    const match = await createMatch({ ruleset, players: participants, seed: 17, tickRate: 10 });
    const player = new AutonomousPlayer(ruleset);
    try {
      const former = player.planConstruction(match.view('p1'), 'defense', { x: 7, y: 7 }, [{ kind: 'tower', x: 7, y: 7 }]);
      const orders = player.step(match.view('p1'));
      const result = match.step(input(orders));
      player.feedback(orders, result.results, match.view('p1'));
      const builder = former.tasks[0].worker!;
      expect(match.view('p1').mine.find(e => e.id === builder)?.construction).toBeDefined();
      player.planConstruction(match.view('p1'), 'defense', { x: 8, y: 7 }, [{ kind: 'wall', x: 8, y: 7 }], 'spend less after strategy changes');
      const replacement = player.step(match.view('p1'));
      expect(replacement).toContainEqual({ type: 'stop', unit: builder });
      match.step(input(replacement));
      expect(match.view('p1').mine.find(e => e.id === builder)?.construction).toBeUndefined();
      while (match.tick < 120) match.step([]);
      expect(match.view('p1').mine.some(e => e.kind === 'tower' && e.x === 7 && e.y === 7)).toBe(false);
    } finally { player.close(); match.dispose(); }
  });

  it('persists an undelivered cancellation and its budget, then releases the reserve after observing the stop', async () => {
    const ruleset: Ruleset = { ...rules, startMineral: 250 };
    const match = await createMatch({ ruleset, players: participants, seed: 17, tickRate: 10 });
    const original = new AutonomousPlayer(ruleset);
    let resumed: AutonomousPlayer | undefined;
    try {
      const former = original.planConstruction(match.view('p1'), 'defense', { x: 7, y: 7 }, [{ kind: 'tower', x: 7, y: 7 }]);
      const opening = original.step(match.view('p1'));
      const initial = match.step(input(opening));
      original.feedback(opening, initial.results, match.view('p1'));
      const builder = former.tasks[0].worker!;
      original.planConstruction(match.view('p1'), 'defense', { x: 8, y: 7 }, [{ kind: 'wall', x: 8, y: 7 }]);
      const undelivered = original.step(match.view('p1'));
      expect(undelivered).toContainEqual({ type: 'stop', unit: builder });
      expect(undelivered.some(order => order.type === 'train')).toBe(false);
      // This request fails before delivery, followed by a process restart.
      const saved = JSON.parse(JSON.stringify(original.memory)) as PlayerMemory;
      original.close();
      match.step([]);
      resumed = new AutonomousPlayer(ruleset, { memory: saved });
      const retry = resumed.step(match.view('p1'));
      expect(retry).toContainEqual({ type: 'stop', unit: builder });
      expect(retry.some(order => order.type === 'train')).toBe(false);
      match.step(input(retry)); // Response is lost too; the next view is the only confirmation.
      expect(match.view('p1').mine.find(e => e.id === builder)?.construction).toBeUndefined();
      const confirmed = resumed.step(match.view('p1'));
      expect(confirmed.some(order => order.type === 'stop' && order.unit === builder)).toBe(false);
      expect(confirmed.some(order => order.type === 'train')).toBe(true);
    } finally { resumed?.close(); original.close(); match.dispose(); }
  });
});
