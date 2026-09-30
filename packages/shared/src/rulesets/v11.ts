import { v10 } from './v10';
import type { Ruleset } from '../ruleset';

/** Research that extends ranger and turret range, with the vision to use it. */
export const v11: Ruleset = {
  ...v10,
  version: 'v11-range',
  upgrades: {
    ...v10.upgrades,
    ranger_range: { kind: 'ranger', stat: 'range', levels: [
      { cost: 200, researchMs: 15000, value: 5, vision: 7 },
      { cost: 300, researchMs: 20000, value: 6, vision: 8 },
    ] },
    turret_range: { kind: 'turret', stat: 'range', levels: [
      { cost: 200, researchMs: 15000, value: 6, vision: 7 },
      { cost: 300, researchMs: 20000, value: 7, vision: 8 },
    ] },
  },
};
