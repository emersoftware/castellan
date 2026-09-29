/**
 * Code evaluated once inside each player's VM. It removes non-deterministic
 * globals and returns `{load, run}`: the host loads the world once per tick and
 * calls `run(unitId, scriptFn)` per unit. Everything a script sees is built here.
 *
 * `__SEED__` and `__MEMLIMIT__` are replaced by the host before evaluation.
 */
export const PRELUDE = String.raw`
(function () {
  "use strict";
  const G = globalThis;
  delete G.Date;
  delete G.WeakRef;
  delete G.FinalizationRegistry;

  let seed = __SEED__ >>> 0;
  function random() {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  Math.random = random;

  const MEMLIMIT = __MEMLIMIT__;
  const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const stringify = JSON.stringify;
  const parse = JSON.parse;
  const freeze = Object.freeze;
  const memory = {};
  let world = null;
  let others = [];
  let tie = {};

  function cheb(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }

  function load(json) {
    world = parse(json);
    tie = {};
    others = world.all.map(function (r) {
      tie[r[0]] = r[9];
      return freeze({ id: r[0], type: r[1], owner: r[2], mine: r[3] === 1, ally: r[3] === 2, x: r[4], y: r[5], hp: r[6], maxHp: r[7], isBuilding: r[8] === 1 });
    });
    const alive = {};
    for (const o of others) alive[o.id] = true;
    for (const k of Object.keys(memory)) if (!alive[k]) delete memory[k];
    return true;
  }

  // Ties break in the player's own reading order (computed by the engine for
  // its seat), so mirrored play stays mirrored.
  function tieKey(o) {
    return tie[o.id];
  }
  function hostile(o) {
    return !o.mine && !o.ally;
  }
  function friendly(o) {
    return o.mine || o.ally;
  }
  function byDistance(u, list) {
    return list.sort(function (a, b) {
      return cheb(u, a) - cheb(u, b) || tieKey(a) - tieKey(b);
    });
  }

  function run(id, fn) {
    const u = world.units[id];
    let action = null;
    let log;
    const act = function (a) { if (action === null) action = a; };
    const idOf = function (t) { return typeof t === "string" ? t : t && t.id; };
    const visible = function (pred) {
      return byDistance(u, others.filter(function (o) { return o.id !== u.id && pred(o) && cheb(u, o) <= u.vision; }));
    };
    if (!memory[id]) memory[id] = {};
    const self = {
      id: u.id, type: u.type, x: u.x, y: u.y, hp: u.hp, maxHp: u.maxHp,
      atk: u.atk, def: u.def, range: u.range, vision: u.vision, tick: world.tick,
      ...(u.attackMs !== undefined ? { attackMs: u.attackMs, moveMs: u.moveMs } : {}),
      memory: memory[id],
      projectiles: function () { return (world.projectiles || []).map(function (p) { return { ...p }; }); },
      nearbyEnemies: function () { return visible(hostile); },
      nearbyAllies: function () { return visible(friendly); },
      nearestEnemy: function () { return visible(hostile)[0] || null; },
      nearestAlly: function () { return visible(friendly)[0] || null; },
      enemiesInRange: function () { return byDistance(u, others.filter(function (o) { return hostile(o) && cheb(u, o) <= u.range; })); },
      distanceTo: function (o) { return cheb(u, o); },
      distanceToPos: function (x, y) { return cheb(u, { x: x, y: y }); },
      enemyBase: function () { return world.enemyBase; },
      myBase: function () { return world.myBase; },
      random: random,
      log: function (m) { if (log === undefined) log = String(m).slice(0, 200); },
      move: function (dir) { if (DIRS.indexOf(dir) >= 0) act({ a: "move", dir: dir }); },
      moveTo: function (x, y) { act({ a: "moveTo", x: Math.round(x), y: Math.round(y) }); },
      attack: function (t) { act({ a: "attack", id: idOf(t) }); },
      flee: function (t) { act({ a: "flee", id: idOf(t) }); },
      hold: function () { act({ a: "hold" }); },
    };
    if (u.lastAttackedTick !== undefined) {
      self.lastAttackedTick = u.lastAttackedTick;
      self.lastAttacker = function () {
        return visible(hostile).find(function (o) { return o.id === u.lastAttacker; }) || null;
      };
    }
    if (u.carrying !== undefined) {
      self.carrying = u.carrying;
      self.carryCapacity = u.carryCapacity;
      self.deposits = function () {
        return (world.deposits || []).slice().sort(function (a,b) {
          return cheb(u,a)-cheb(u,b) || a.tie-b.tie;
        }).map(function (d) { return {id:d.id,x:d.x,y:d.y,amount:d.amount}; });
      };
      self.nearestDeposit = function () { return self.deposits()[0] || null; };
      self.gather = function (d) { act({a:"gather",id:idOf(d)}); };
      self.unload = function () { act({a:"unload"}); };
    }
    let err;
    try {
      fn(self);
    } catch (e) {
      err = String((e && e.message) || e).slice(0, 300);
    }
    let size = 0;
    try {
      size = stringify(self.memory === memory[id] ? memory[id] : (memory[id] = self.memory)).length;
    } catch (e) {
      size = MEMLIMIT + 1;
    }
    if (size > MEMLIMIT) {
      memory[id] = {};
      err = err || "self.memory over " + MEMLIMIT + " bytes, reset";
    }
    return stringify({ a: action || { a: "hold" }, err: err, log: log });
  }

  return { load: load, run: run };
})()
`;
