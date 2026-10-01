import { v14 } from './v14';
import type { Ruleset } from '../ruleset';

/** Doors cannot form corners, and cannot intercept shots aimed at their occupants. */
export const v15: Ruleset = {
  ...v14,
  version: 'v15-doors',
  straightDoors: true,
  projectiles: { ...v14.projectiles!, flyOverTargetById: true },
};
