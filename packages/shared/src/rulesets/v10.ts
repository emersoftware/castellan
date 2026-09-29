import { v9 } from './v9';
import type { Ruleset } from '../ruleset';

/** An eliminated player's buildings remain as inert, destructible ruins. */
export const v10: Ruleset = {
  ...v9,
  version: 'v10-ruins',
  ruins: true,
};
