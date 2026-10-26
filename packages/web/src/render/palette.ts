/**
 * Every group on screen is monochrome: a ramp from black to a light tone.
 * Art is drawn in grayscale and tinted with the group's channel mix
 * (its "key"); the dither pass reads the key back and maps brightness onto
 * the group's ramp with ordered dithering.
 */
export interface Ramp {
  /** Internal color the renderer tints with; identifies the ramp. */
  key: number;
  /** Dark, middle, light; intermediate brightness is spatial dithering. */
  steps: [string, string, string];
}

export const RAMPS = {
  /** Player 1: cold blue steel. */
  teamA: { key: 0x0000ff, steps: ["#000000", "#2d63c8", "#b4dcff"] },
  /** Player 2: embers. */
  teamB: { key: 0xff0000, steps: ["#000000", "#d24a1c", "#ffcaa0"] },
  /** Player 3: verdigris. */
  teamC: { key: 0x00ffff, steps: ["#000000", "#23a19a", "#b0fff4"] },
  /** Player 4: amethyst. */
  teamD: { key: 0xff00ff, steps: ["#000000", "#8e3fc4", "#eec4ff"] },
  /** Player 5: vivid rose pink; its internal half-red key remains separate from terrain. */
  teamE: { key: 0x80ff00, steps: ["#000000", "#e02c83", "#ff8fc5"] },
  /** Player 6: warm golden yellow; the half-blue key separates it from mineral and fire. */
  teamF: { key: 0xff0080, steps: ["#000000", "#d59618", "#ffd36a"] },
  /** Grass barely lit, the black shows through. */
  terrain: { key: 0x00ff00, steps: ["#000000", "#3f8a33", "#8fcf5a"] },
  mineral: { key: 0xffff00, steps: ["#000000", "#b88a12", "#ffe98a"] },
  /** Internal heat key maps to monochrome flame tones, independent of owner tint. */
  fire: { key: 0xff8000, steps: ["#1e1e1e", "#a4a4a4", "#ffffff"] },
  /** Rock, arrows, dust, text. */
  neutral: { key: 0xffffff, steps: ["#000000", "#8c8c8c", "#ffffff"] },
} satisfies Record<string, Ramp>;

/** One ramp per player, in list order (like AoE's player colours). */
export const PLAYER_RAMPS: Ramp[] = [RAMPS.teamA, RAMPS.teamB, RAMPS.teamC, RAMPS.teamD, RAMPS.teamE, RAMPS.teamF];

/** A key color darkened (e.g. corpses): same ramp, lower on it. */
export function dim(key: number, k: number): number {
  const r = Math.round(((key >> 16) & 255) * k);
  const g = Math.round(((key >> 8) & 255) * k);
  const b = Math.round((key & 255) * k);
  return (r << 16) | (g << 8) | b;
}
