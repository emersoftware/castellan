/**
 * A moment of a replay in its address: `t`, whole seconds into the match, and `pov`, the player watched.
 * The viewer keeps it in its address bar, shared links carry it and link previews read it.
 */
export interface Moment {
  seconds?: number;
  player: string | null;
}

/** The moment a query opens at; no `t`, or zero, is the start. */
export function readMoment(query: URLSearchParams): Moment {
  const seconds = Number(query.get("t"));
  return { seconds: seconds > 0 ? seconds : undefined, player: query.get("pov") };
}

/** Parts of a moment to change: `null` removes one, a missing one stays. */
export interface MomentChange {
  seconds?: number | null;
  player?: string | null;
}

/** Writes the given parts of a moment into `query`, in whole seconds. */
export function writeMoment(query: URLSearchParams, moment: MomentChange): void {
  if (moment.seconds === null) query.delete("t");
  else if (moment.seconds !== undefined) query.set("t", String(Math.floor(moment.seconds)));
  if (moment.player === null) query.delete("pov");
  else if (moment.player !== undefined) query.set("pov", moment.player);
}
