import { v11 } from './v11';
import type { Ruleset } from '../ruleset';

const mobility = (kind: 'knight_mobility' | 'ranger_mobility') =>
  ({ ...v11.upgrades![kind], levels: v11.upgrades![kind].levels.map((l) => ({ ...l, cost: 200 })) });

/**
 * v12 let hoarded capital win free-for-alls and left knights unused, so this goes back
 * to v11 and takes half of v12's price cuts: the limit is a draw again, and four-seat
 * games last 15 minutes to give eliminations time to happen.
 */
export const v13: Ruleset = {
  ...v11,
  version: 'v13-long-quad',
  fourSeatMatchMs: 900_000,
  kinds: { ...v11.kinds, ranger: { ...v11.kinds.ranger, cost: 110 } },
  upgrades: { ...v11.upgrades, knight_mobility: mobility('knight_mobility'), ranger_mobility: mobility('ranger_mobility') },
};
