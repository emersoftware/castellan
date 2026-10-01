import { v13 } from './v13';
import type { Ruleset } from '../ruleset';

/**
 * From 20 LLM games on v13: rangers kited knights forever, range-6 rangers outranged
 * turrets, and defenders shot out from behind walls that stopped the attackers' arrows.
 * Rangers now stand still 300 ms after each shot (in scripted 11-knight vs 10-ranger
 * fights, unupgraded kiting stops paying while range or mobility research restores it;
 * 600 ms killed kiting outright), turrets always outrange them, and only castles and
 * turrets (and rock) stop projectiles.
 */
export const v14: Ruleset = {
  ...v13,
  version: 'v14-aim',
  projectiles: { ...v13.projectiles!, flyOver: ['wall', 'door'] },
  kinds: {
    ...v13.kinds,
    ranger: { ...v13.kinds.ranger, aimMs: 300 },
    turret: { ...v13.kinds.turret, range: 6, vision: 7 },
  },
  upgrades: {
    ...v13.upgrades,
    ranger_range: { ...v13.upgrades!.ranger_range, levels: v13.upgrades!.ranger_range.levels.slice(0, 1) },
    turret_range: { kind: 'turret', stat: 'range', levels: [
      { cost: 200, researchMs: 15000, value: 7, vision: 8 },
      { cost: 300, researchMs: 20000, value: 8, vision: 9 },
    ] },
  },
};
