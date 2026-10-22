/**
 * The game's screen door: one 4×4 ordered-dither pattern for every surface — the canvas
 * filters (GLSL), dithered portraits (CPU) and the interface's SVG filter — so they all
 * break gradients into the same dots.
 */

/** Thresholds 0…15 of the 4×4 cell, row by row; a cell is lit where a level exceeds (t + 0.5) / 16. */
export const BAYER_4X4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** GLSL `bayer4(p)`: the same thresholds as `BAYER_4X4` divided by 16, for a pixel coordinate. */
export const BAYER_GLSL = `float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }`;
