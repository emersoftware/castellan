import { Filter, GlProgram, UniformGroup } from "pixi.js";
import { RAMPS } from "./palette";

const vertex = `in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`;

const vec = (c: string) => {
  const v = parseInt(c.slice(1), 16);
  return `vec3(${(((v >> 16) & 255) / 255).toFixed(4)}, ${(((v >> 8) & 255) / 255).toFixed(4)}, ${((v & 255) / 255).toFixed(4)})`;
};
/** Three discrete tones; semitones are a spatial mix of adjacent tones. */
const pick = (steps: readonly [string, string, string]) =>
  `(level < 0.5 ? ${vec(steps[0])} : level < 1.5 ? ${vec(steps[1])} : ${vec(steps[2])})`;

// Classify the key channel mix, then ordered-dither brightness along that ramp.
const fragment = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
void main(void) {
  vec4 c = texture(uTexture, vTextureCoord);
  if (c.a < 0.01) { finalColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec3 rgb = c.rgb / c.a;
  float L = max(rgb.r, max(rgb.g, rgb.b));
  vec3 n = rgb / max(L, 0.0001);
  float scaled = clamp(L, 0.0, 1.0) * 2.0;
  float level = min(2.0, floor(scaled) + step(bayer4(gl_FragCoord.xy) + 0.5 / 16.0, fract(scaled)));
  vec3 col;
  if (n.r > 0.6 && n.g > 0.6 && n.b > 0.6) col = ${pick(RAMPS.neutral.steps)};
  else if (n.r > 0.6 && n.g > 0.6) col = ${pick(RAMPS.gold.steps)};
  else if (n.g > 0.6 && n.b > 0.6) col = ${pick(RAMPS.teamC.steps)};
  else if (n.r > 0.6 && n.b > 0.6) col = ${pick(RAMPS.teamD.steps)};
  else if (n.b >= n.r && n.b >= n.g) col = ${pick(RAMPS.teamA.steps)};
  else if (n.r >= n.g) col = ${pick(RAMPS.teamB.steps)};
  else col = ${pick(RAMPS.terrain.steps)};
  finalColor = vec4(col, 1.0);
}`;

export function createDitherFilter(): Filter {
  return new Filter({
    glProgram: GlProgram.from({ vertex, fragment, name: "aoa-ramp-dither" }),
    resources: { ditherUniforms: new UniformGroup({ uUnused: { value: 0, type: "f32" } }) },
  });
}
