/**
 * Every group on screen is monochrome: a ramp from black to a light tone.
 * Art is drawn in grayscale and tinted with the group's pure channel color
 * (its "key"); the dither pass reads the key back and maps brightness onto
 * the group's ramp with ordered dithering.
 */
export interface Ramp {
  /** Pure color the renderer tints with; identifies the ramp. */
  key: number;
  /** Black → light, 4 steps. */
  steps: [string, string, string, string];
}

export const RAMPS = {
  /** Player 1: cold blue steel. */
  teamA: { key: 0x0000ff, steps: ["#000000", "#10205a", "#2d63c8", "#b4dcff"] },
  /** Player 2: embers. */
  teamB: { key: 0xff0000, steps: ["#000000", "#5c1408", "#d24a1c", "#ffcaa0"] },
  /** Player 3: verdigris. */
  teamC: { key: 0x00ffff, steps: ["#000000", "#0b3b3a", "#23a19a", "#b0fff4"] },
  /** Player 4: amethyst. */
  teamD: { key: 0xff00ff, steps: ["#000000", "#35104d", "#8e3fc4", "#eec4ff"] },
  /** Grass barely lit, the black shows through. */
  terrain: { key: 0x00ff00, steps: ["#000000", "#1e4d20", "#3f8a33", "#8fcf5a"] },
  gold: { key: 0xffff00, steps: ["#000000", "#3f2e00", "#b88a12", "#ffe98a"] },
  /** Rock, arrows, dust, text. */
  neutral: { key: 0xffffff, steps: ["#000000", "#3a3a3a", "#8c8c8c", "#ffffff"] },
} satisfies Record<string, Ramp>;

/** One ramp per player, in list order (like AoE's player colours). */
export const PLAYER_RAMPS: Ramp[] = [RAMPS.teamA, RAMPS.teamB, RAMPS.teamC, RAMPS.teamD];

/** A key color darkened (e.g. corpses): same ramp, lower on it. */
export function dim(key: number, k: number): number {
  const r = Math.round(((key >> 16) & 255) * k);
  const g = Math.round(((key >> 8) & 255) * k);
  const b = Math.round((key & 255) * k);
  return (r << 16) | (g << 8) | b;
}
