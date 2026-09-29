import { v8 } from './v8';
import type { Ruleset } from '../ruleset';

/** Worker economy scripts and a weak, slow defensive strike for the King. */
export const v9: Ruleset = {
  ...v8,
  version: 'v9-worker-scripts',
  reactiveScripts: true,
  kinds: {
    ...v8.kinds,
    worker: { ...v8.kinds.worker, scriptable: true },
    king: { ...v8.kinds.king, scriptable: true, atk: 3, range: 1, attackMs: 3000 },
  },
  defaultScripts: {
    ...v8.defaultScripts,
    worker: '// Mine automatically; upload a script to choose combat or escape.\nself.gather();',
    king: '// Defend against a recent attacker in reach; never chase.\nconst enemy = self.lastAttacker();\nif (enemy && self.distanceTo(enemy) <= self.range) self.attack(enemy);\nelse self.hold();',
  },
};
