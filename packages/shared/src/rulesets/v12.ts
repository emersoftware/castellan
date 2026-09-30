import { v11 } from './v11';
import type { Ruleset } from '../ruleset';

/**
 * Balance from 30 LLM games on v8-v10: free-for-all ended in a draw 86% of the time,
 * rangers dealt 22% less damage per capital than knights, and mobility was rarely bought.
 */
export const v12: Ruleset = {
  ...v11,
  version: 'v12-ffa-score',
  ffaTimeoutOutcome: 'survivorScore',
  kinds: { ...v11.kinds, ranger: { ...v11.kinds.ranger, cost: 100 } },
  upgrades: {
    ...v11.upgrades,
    knight_mobility: { ...v11.upgrades!.knight_mobility, levels: v11.upgrades!.knight_mobility.levels.map((l) => ({ ...l, cost: 150 })) },
    ranger_mobility: { ...v11.upgrades!.ranger_mobility, levels: v11.upgrades!.ranger_mobility.levels.map((l) => ({ ...l, cost: 150 })) },
  },
};
