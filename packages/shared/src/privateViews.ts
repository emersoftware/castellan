// What one player may learn of an entity or a hack event, from what an observer sees. The engine filters its player
// views through these, and the viewer reproduces a player's perspective from an observer's frame with them, so the two
// can never disagree. Plain erasable TypeScript: the loop keepers load this package with Node's type stripping.
import type { EntityView, GameEvent, PlayerId } from "./protocol.ts";

/**
 * An observer's view of an entity as `viewer` may see it. Its owner learns its private state: order, training, carried
 * mineral, recharge. What its script did (last action, channel time) goes to whoever runs that script: under hypno the
 * controller, not the owner. The HYPNO mark reaches the owner and the controller; only the controller learns who it is.
 */
export function entityAs(view: EntityView, viewer: PlayerId): EntityView {
  const { controller, hypno, rechargeMs, casting, order, orderSuspended, orderProgress, doing, actionResult, carrying, training, ...rest } = view;
  const own = view.owner === viewer, controls = controller === viewer;
  const decides = (controller ?? view.owner) === viewer;
  const shown: EntityView = {
    ...rest,
    casting: casting && (decides ? casting : { action: casting.action, target: casting.target }),
    ...(own && { order, orderSuspended, orderProgress, carrying, training, rechargeMs }),
    ...(decides && { doing, actionResult }),
    hypno: own || controls ? hypno : undefined,
    controller: controls ? controller : undefined,
  };
  // Absent, not undefined: an absent field and one never sent read the same everywhere.
  const fields = shown as unknown as Record<string, unknown>;
  for (const key of Object.keys(fields)) if (fields[key] === undefined) delete fields[key];
  return shown;
}

/** A hack's start or end as `viewer` receives it: who hacked, and with which Wizard, reaches only that controller. */
export function hypnoEventAs(event: Extract<GameEvent, { type: "hypno" }>, viewer: PlayerId): Extract<GameEvent, { type: "hypno" }> {
  if (event.controller === viewer) return event;
  const { controller, wizard, ...anonymous } = event;
  return anonymous;
}
